import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { canRenderOnCanvas, renderSlideToCanvas } from '../lib/graphics/renderSlide'
import { ndiPushChannelService } from '../services/ndi-output/pushChannel'
import type { AlternateOutputConfig } from '../types/alternateOutput'
import type { Slide } from '../types'

/**
 * The alternate output: a second output that either follows the live content or
 * carries its own, landing on a monitor or on the network as its own NDI source.
 *
 * The NDI destination renders frames here, on a canvas, rather than capturing a
 * window — which is what lets the feed keep its alpha for keying, and means it
 * needs no spare monitor. The trade-off is that the canvas renderer only draws
 * text content; `unsupportedContent` reports when the current slide needs the
 * window path instead of quietly sending a frame with its background missing.
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
    /** Set when the resolved slide can't be drawn on canvas (media, or an image
     *  or video background) and so needs the window destination. */
    unsupportedContent: boolean
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

    const [framesSent, setFramesSent] = useState(0)
    const [error, setError] = useState<string | null>(null)

    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const sendingRef = useRef(false)

    // 'follow' tracks whatever is live; 'independent' shows only what was sent
    // here, which is what lets the projector and this output disagree.
    const slide = useMemo(() => {
        if (config.contentSource === 'independent') return independentSlide
        return activeSlides.find((candidate) => candidate.id === liveSlideId) ?? null
    }, [config.contentSource, independentSlide, activeSlides, liveSlideId])

    const unsupportedContent = config.destination.kind === 'ndi' && !canRenderOnCanvas(slide)

    const renderOptions = useMemo(() => ({
        width: config.format.width,
        height: config.format.height,
        defaultFont,
        // Without alpha the feed needs something behind the text, or a switcher
        // taking it as a full-frame source shows nothing but the words.
        opaqueBackground: !config.alpha,
    }), [config.format.width, config.format.height, config.alpha, defaultFont])

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

        renderSlideToCanvas(ctx, unsupportedContent ? null : slide, renderOptions)

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
    }, [getCanvas, slide, renderOptions, unsupportedContent])

    const enable = useCallback(async (): Promise<string | null> => {
        if (config.destination.kind === 'monitor') {
            // The window destination needs a second live window, which doesn't
            // exist yet — say so rather than silently doing nothing.
            const message = 'Sending the alternate output to a monitor isn\'t available yet. Choose NDI for now.'
            setError(message)
            return message
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
    }, [config.destination.kind, config.sourceName, update])

    const disable = useCallback(async () => {
        update({ enabled: false })
        await ndiPushChannelService.close(ALTERNATE_CHANNEL)
        setFramesSent(0)
    }, [update])

    useEffect(() => {
        if (!config.enabled || config.destination.kind !== 'ndi') return
        void pushFrame()
        const timer = setInterval(() => { void pushFrame() }, HEARTBEAT_MS)
        return () => clearInterval(timer)
    }, [config.enabled, config.destination.kind, pushFrame])

    useEffect(() => {
        if (!config.enabled) return
        const timer = setInterval(async () => {
            setFramesSent(await ndiPushChannelService.framesSent(ALTERNATE_CHANNEL))
        }, 2000)
        return () => clearInterval(timer)
    }, [config.enabled])

    return {
        config,
        update,
        slide,
        setSlide,
        framesSent,
        error,
        unsupportedContent,
        enable,
        disable,
        paintInto,
    }
}
