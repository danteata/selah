import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../store/appStore'
import { canRenderOnCanvas } from '../lib/graphics/renderSlide'
import { CanvasFeed } from '../services/ndi-output/canvasFeed'
import { useSlideBackgroundUrl } from './useSlideBackgroundUrl'
import { withTemplateStyle } from '../lib/graphics/templateStyle'
import { useTemplates } from './useTemplates'
import { EMPTY_PUSH_STATS, ndiPushChannelService, type PushStats } from '../services/ndi-output/pushChannel'
import { nativeMultiMonitorService } from '../services/native-multi-monitor'
import type { AlternateOutputConfig } from '../types/alternateOutput'
import type { Slide } from '../types'
import { loadSlideFont } from '../lib/fonts'

/**
 * The alternate output: a second output that either follows the live content or
 * carries its own, landing on a monitor or on the network as its own NDI source.
 *
 * Two destinations, two mechanisms:
 *   - A monitor gets a second window running the same view as the projector, so
 *     it renders everything — backgrounds, media, transitions. Content reaches it
 *     by window label, which is what lets the two outputs differ.
 *   - NDI renders frames here, on a canvas — which is what lets the feed keep
 *     its alpha for keying, and means it needs no spare monitor. With alpha the
 *     text goes out on transparency, for a switcher to key over its own
 *     picture. Without it the feed draws the slide's backdrop too — colour,
 *     gradient, image or motion background — with crossfades and running
 *     countdowns, so "Follow main output" over NDI is a program feed that needs
 *     no live window. Media slides (photos, videos) are drawn on either. Only
 *     external players (YouTube, Vimeo) can't be: such a slide goes out as its
 *     text alone, with `textOnly` set so the UI can say so.
 */

/** Channel id for the alternate output's NDI source. */
export const ALTERNATE_CHANNEL = 'alternate'

/*
 * Frames are pushed only when the picture changes. The NDI channel repeats the
 * last one at the output's frame rate (see `push.rs`), so a receiver that
 * connects between changes still gets a picture.
 *
 * Several components use this hook at once (the live panel and Settings), and
 * each used to push its own frames: two of every frame, half of them dropped.
 * Only the first one mounted drives the feed now.
 */
const mounted: symbol[] = []
const driverListeners = new Set<() => void>()
function subscribeDriver(listener: () => void) {
    driverListeners.add(listener)
    return () => { driverListeners.delete(listener) }
}
function useIsFeedDriver(): boolean {
    const [id] = useState(() => Symbol('alternate-output'))
    useEffect(() => {
        mounted.push(id)
        driverListeners.forEach((listener) => listener())
        return () => {
            mounted.splice(mounted.indexOf(id), 1)
            driverListeners.forEach((listener) => listener())
        }
    }, [id])
    return useSyncExternalStore(subscribeDriver, () => mounted[0] === id, () => false)
}

interface UseAlternateOutputReturn {
    config: AlternateOutputConfig
    update: (patch: Partial<AlternateOutputConfig>) => void
    /** The slide this output is showing right now, after resolving its source. */
    slide: Slide | null
    /** Set the slide for an 'independent' output. */
    setSlide: (slide: Slide | null) => void
    /** Frames NDI has accepted — 0 while announced but silent. */
    framesSent: number
    /** The channel's health: sent, dropped, repeated, late. */
    stats: PushStats
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

    const [stats, setStats] = useState<PushStats>(EMPTY_PUSH_STATS)
    const framesSent = stats.sent
    const isDriver = useIsFeedDriver()
    const [error, setError] = useState<string | null>(null)

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
    const backgroundUrl = useSlideBackgroundUrl(slide)
    const animations = useAppStore((state) => state.settings.animations)
    const transitionInterval = useAppStore((state) => state.settings.transitionInterval)
    const transitionSeconds = animations === false ? 0 : transitionInterval ?? 0.7

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

    // The feed draws the picture: backdrop, crossfades, motion and countdowns
    // on its own clock (services/ndi-output/canvasFeed). Every instance keeps
    // one for the in-app preview; only the driver starts it and pushes frames.
    const feed = useMemo(() => new CanvasFeed(async (canvas) => {
        if (sendingRef.current) return false
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return false
        sendingRef.current = true
        try {
            // getImageData is RGBA with straight alpha, which is NDI's RGBA format —
            // no swizzle, no premultiply correction.
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            await ndiPushChannelService.sendFrame(ALTERNATE_CHANNEL, {
                pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                width: canvas.width,
                height: canvas.height,
            })
            setError(null)
            return true
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
            return false
        } finally {
            sendingRef.current = false
        }
    }), [])

    // Draw the slide even when its background can't be reproduced (a video):
    // blanking the frame instead sent black for such slides and looked broken
    // rather than partial.
    useEffect(() => {
        feed.setScene({ slide, options: renderOptions, backgroundUrl, transitionSeconds })
        // A canvas doesn't wait for web fonts the way the DOM does: drawn before
        // the face has loaded, text is measured and painted in a fallback.
        let live = true
        void loadSlideFont(slide?.slideStyle?.font || defaultFont).then(() => { if (live) feed.invalidate() })
        return () => { live = false }
    }, [feed, slide, renderOptions, backgroundUrl, transitionSeconds, defaultFont])

    const paintInto = useCallback((canvas: HTMLCanvasElement) => {
        feed.paintInto(canvas)
    }, [feed])

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
            await ndiPushChannelService.open(ALTERNATE_CHANNEL, config.sourceName, config.format.fps)
            update({ enabled: true })
            setError(null)
            return null
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            setError(message)
            return message
        }
    }, [config.destination, config.sourceName, config.format.fps, update])

    const disable = useCallback(async () => {
        update({ enabled: false })
        // Both are cheap no-ops when that destination was never in use, and
        // switching destination while enabled must not leave the other running.
        await ndiPushChannelService.close(ALTERNATE_CHANNEL)
        await nativeMultiMonitorService.closeAlternateWindow().catch(() => {})
        setStats(EMPTY_PUSH_STATS)
    }, [update])

    // The feed's clock runs while this instance drives an enabled NDI output.
    useEffect(() => {
        if (!isDriver || !config.enabled || config.destination.kind !== 'ndi') return
        feed.start(config.format.fps)
        return () => feed.stop()
    }, [feed, isDriver, config.enabled, config.destination.kind, config.format.fps])

    // A channel opened at another rate (a format change while enabled) is
    // re-announced; the same name and rate is a no-op on the Rust side.
    useEffect(() => {
        if (!isDriver || !config.enabled || config.destination.kind !== 'ndi') return
        void ndiPushChannelService.open(ALTERNATE_CHANNEL, config.sourceName, config.format.fps)
            .then(() => feed.invalidate())
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    }, [feed, isDriver, config.enabled, config.destination.kind, config.sourceName, config.format.fps])

    useEffect(() => {
        if (!config.enabled || config.destination.kind !== 'ndi') return
        const timer = setInterval(async () => {
            setStats(await ndiPushChannelService.stats(ALTERNATE_CHANNEL))
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
        stats,
        error,
        textOnly,
        enable,
        disable,
        paintInto,
    }
}
