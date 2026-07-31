import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { canRenderOnCanvas, renderSlideToCanvas } from '../lib/graphics/renderSlide'
import { withTemplateStyle } from '../lib/graphics/templateStyle'
import { useTemplates } from './useTemplates'
import { ndiPushChannelService } from '../services/ndi-output/pushChannel'
import { nativeMultiMonitorService } from '../services/native-multi-monitor'
import type { AlternateOutputConfig } from '../types/alternateOutput'
import type { Slide } from '../types'

/**
 * The alternate output: a second output that either follows the live content or
 * carries its own, landing on a monitor or on the network as its own NDI source.
 *
 * Two destinations, two mechanisms:
 *   - A monitor gets a second window running the same view as the projector, so
 *     it renders everything — backgrounds, media, transitions. Content reaches it
 *     by window label, which is what lets the two outputs differ.
 *   - NDI renders frames here, on a canvas — which is what lets the feed keep its alpha for keying, and means it
 * needs no spare monitor. The trade-off is that the canvas renderer draws text,
 * not image or video backgrounds: such a slide still goes out, as its text alone,
 * with `textOnly` set so the UI can say so. For a keyed feed that is usually the
 * desired result anyway, since the switcher supplies the background.
 */

/** Channel id for the alternate output's NDI source. */
export const ALTERNATE_CHANNEL = 'alternate'

/** Frames are pushed on change plus this heartbeat, so a receiver connecting
 *  between changes still gets a picture without streaming identical frames. */
const HEARTBEAT_MS = 500

interface UseAlternateOutputReturn {
    config: AlternateOutputConfig
    update: (patch: Partial<AlternateOutputConfig>) => void
    /** The slide this output is showing right now, after resolving its source. */
    slide: Slide | null
    /** Set the slide for an 'independent' output. */
    setSlide: (slide: Slide | null) => void
    /** Frames NDI has accepted — 0 while announced but silent. */
    framesSent: number
    error: string | null
    /** Set when the slide has a background this output can't draw, so the feed
     *  carries its text only. Not a failure — for a keyed feed it's often what
     *  you want, since the switcher supplies the background. */
    textOnly: boolean
    enable: () => Promise<string | null>
    disable: () => Promise<void>
    /** Draw the current content into a visible canvas — for the in-app preview
     *  and, once it exists, the mirror window. */
    paintInto: (canvas: HTMLCanvasElement) => void
}

export function useAlternateOutput(): UseAlternateOutputReturn {
    const config = useAppStore((state) => state.alternateOutput)
    const update = useAppStore((state) => state.updateAlternateOutput)
    const independentSlide = useAppStore((state) => state.alternateSlide)
    const setSlide = useAppStore((state) => state.setAlternateSlide)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const defaultFont = useAppStore((state) => state.settings.defaultFont)
    // The operator's verse-reference styling, so the feed cites verses the way
    // the projector does rather than in plain white.
    const slideStyles = useAppStore((state) => state.settings.slideStyles)
    const { templates } = useTemplates()

    const [framesSent, setFramesSent] = useState(0)
    const [error, setError] = useState<string | null>(null)

    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const sendingRef = useRef(false)

    // 'follow' tracks whatever is live; 'independent' shows only what was sent
    // here, which is what lets the projector and this output disagree.
    const contentSlide = useMemo(() => {
        if (config.contentSource === 'independent') return independentSlide
        return activeSlides.find((candidate) => candidate.id === liveSlideId) ?? null
    }, [config.contentSource, independentSlide, activeSlides, liveSlideId])

    /** The output's own template, if it has one. */
    const styleTemplate = useMemo(
        () => (config.styleTemplateId
            ? (templates ?? []).find((template) => template._id === config.styleTemplateId) ?? null
            : null),
        [config.styleTemplateId, templates],
    )

    // The output's styling is applied here, to a copy — the slide on the projector
    // is untouched, which is what "per output" has to mean.
    const slide = useMemo(
        () => (contentSlide ? withTemplateStyle(contentSlide, styleTemplate) : null),
        [contentSlide, styleTemplate],
    )

    const textOnly = config.destination.kind === 'ndi' && !canRenderOnCanvas(slide)

    const renderOptions = useMemo(() => ({
        width: config.format.width,
        height: config.format.height,
        defaultFont,
        // Without alpha the feed needs something behind the text, or a switcher
        // taking it as a full-frame source shows nothing but the words.
        opaqueBackground: !config.alpha,
        forceLowerThird: config.layout === 'lower-third',
        verseRef: {
            color: slideStyles?.verseRefColor,
            bold: slideStyles?.verseRefBold,
            italic: slideStyles?.verseRefItalic,
            sizePercent: slideStyles?.verseRefSizePercent,
        },
    }), [config.format.width, config.format.height, config.alpha, config.layout, defaultFont, slideStyles])

    const getCanvas = useCallback((): HTMLCanvasElement | null => {
        if (typeof document === 'undefined') return null
        if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
        const canvas = canvasRef.current
        if (canvas.width !== config.format.width || canvas.height !== config.format.height) {
            canvas.width = config.format.width
            canvas.height = config.format.height
        }
        return canvas
    }, [config.format.width, config.format.height])

    const paintInto = useCallback((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        renderSlideToCanvas(ctx, slide, { ...renderOptions, width: canvas.width, height: canvas.height })
    }, [slide, renderOptions])

    const pushFrame = useCallback(async () => {
        if (sendingRef.current) return
        const canvas = getCanvas()
        if (!canvas) return
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return

        // Draw the slide even when its background can't be reproduced. Blanking
        // the frame instead meant "Follow main output" sent black for any slide
        // with an image behind it — which is nearly all of them — and looked
        // broken rather than partial.
        renderSlideToCanvas(ctx, slide, renderOptions)

        // getImageData is RGBA with straight alpha, which is NDI's RGBA format —
        // no swizzle, no premultiply correction.
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

        sendingRef.current = true
        try {
            await ndiPushChannelService.sendFrame(ALTERNATE_CHANNEL, {
                pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                width: canvas.width,
                height: canvas.height,
            })
            setError(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            sendingRef.current = false
        }
    }, [getCanvas, slide, renderOptions])

    const enable = useCallback(async (): Promise<string | null> => {
        if (config.destination.kind === 'monitor') {
            try {
                await nativeMultiMonitorService.openAlternateWindow(config.destination.monitorId)
                update({ enabled: true })
                setError(null)
                return null
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e)
                setError(message)
                return message
            }
        }
        try {
            await ndiPushChannelService.open(ALTERNATE_CHANNEL, config.sourceName)
            update({ enabled: true })
            setError(null)
            return null
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            setError(message)
            return message
        }
    }, [config.destination, config.sourceName, update])

    const disable = useCallback(async () => {
        update({ enabled: false })
        // Both are cheap no-ops when that destination was never in use, and
        // switching destination while enabled must not leave the other running.
        await ndiPushChannelService.close(ALTERNATE_CHANNEL)
        await nativeMultiMonitorService.closeAlternateWindow().catch(() => {})
        setFramesSent(0)
    }, [update])

    useEffect(() => {
        if (!config.enabled || config.destination.kind !== 'ndi') return
        void pushFrame()
        const timer = setInterval(() => { void pushFrame() }, HEARTBEAT_MS)
        return () => clearInterval(timer)
    }, [config.enabled, config.destination.kind, pushFrame])

    useEffect(() => {
        if (!config.enabled || config.destination.kind !== 'ndi') return
        const timer = setInterval(async () => {
            setFramesSent(await ndiPushChannelService.framesSent(ALTERNATE_CHANNEL))
        }, 2000)
        return () => clearInterval(timer)
    }, [config.enabled, config.destination.kind])

    // The window destination receives the same events the projector window does,
    // addressed to its own label — so the view it runs needs no special casing.
    useEffect(() => {
        if (!config.enabled || config.destination.kind !== 'monitor') return

        const send = async () => {
            try {
                if (slide) {
                    // The layout override is applied to the slide handed over,
                    // rather than needing the window to know about outputs:
                    // LiveView already renders the lower-third layout.
                    // Already carries the output's template styling; the layout
                    // override is the last word.
                    const outgoing = config.layout === 'lower-third'
                        ? { ...slide, layout: 'lower-third' }
                        : slide
                    await nativeMultiMonitorService.emitToAlternateWindow('slide-update', {
                        slideId: slide.id,
                        slideData: outgoing,
                    })
                } else {
                    await nativeMultiMonitorService.emitToAlternateWindow('clear-output', { mode: 'blank' })
                }
                setError(null)
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
            }
        }

        // A newly opened window isn't listening yet, so the first send is delayed
        // enough for its view to mount and subscribe.
        const timer = setTimeout(() => { void send() }, 400)
        return () => clearTimeout(timer)
    }, [config.enabled, config.destination.kind, config.layout, slide])

    return {
        config,
        update,
        slide,
        setSlide,
        framesSent,
        error,
        textOnly,
        enable,
        disable,
        paintInto,
    }
}
