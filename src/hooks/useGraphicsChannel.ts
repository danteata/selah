import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { renderLowerThird } from '../lib/graphics/renderLowerThird'
import { ndiPushChannelService, GRAPHICS_CHANNEL } from '../services/ndi-output/pushChannel'
import type { Slide } from '../types'

/**
 * The graphics channel: an alternate output carrying its own slide — a lower
 * third, typically — sent as its own NDI source while the program output keeps
 * showing whatever is live.
 *
 * Frames are drawn to an offscreen canvas here and pushed straight to NDI, so the
 * feed carries real alpha for keying over camera video. Nothing captures a window
 * in this path, which is also why it behaves identically on all three platforms.
 */

/** NDI feed resolution. Fixed rather than inherited from a display, because this
 *  output need not correspond to any monitor. */
export const GRAPHICS_WIDTH = 1920
export const GRAPHICS_HEIGHT = 1080

export const GRAPHICS_SOURCE_NAME = 'Selah Graphics'

/**
 * Frames are pushed when the content changes, plus this heartbeat. A lower third
 * is static for minutes at a time, so streaming 30 fps of identical 8 MB frames
 * would burn the IPC for nothing — but a receiver that connects between changes
 * has to get a picture, which is the same trap that made the Windows capture send
 * black. Two per second is plenty for a still graphic.
 */
const HEARTBEAT_MS = 500

interface UseGraphicsChannelReturn {
    /** Whether the channel is announced on the network. */
    isEnabled: boolean
    /** The slide currently on the graphics channel. */
    slide: Slide | null
    /** Frames NDI has accepted — 0 while announced but silent. */
    framesSent: number
    error: string | null
    enable: () => Promise<string | null>
    disable: () => Promise<void>
    /** Draw the current content into a visible canvas (the mirror window and the
     *  in-app preview both use this). */
    paintInto: (canvas: HTMLCanvasElement) => void
}

export function useGraphicsChannel(): UseGraphicsChannelReturn {
    const slide = useAppStore((state) => state.graphicsSlide)
    const isEnabled = useAppStore((state) => state.graphicsChannelEnabled)
    const setEnabled = useAppStore((state) => state.setGraphicsChannelEnabled)
    const defaultFont = useAppStore((state) => state.settings.defaultFont)

    const [framesSent, setFramesSent] = useState(0)
    const [error, setError] = useState<string | null>(null)

    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const sendingRef = useRef(false)

    /** The offscreen surface the NDI frames come from. */
    const getCanvas = useCallback((): HTMLCanvasElement | null => {
        if (typeof document === 'undefined') return null
        if (!canvasRef.current) {
            const canvas = document.createElement('canvas')
            canvas.width = GRAPHICS_WIDTH
            canvas.height = GRAPHICS_HEIGHT
            canvasRef.current = canvas
        }
        return canvasRef.current
    }, [])

    const paintInto = useCallback((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        if (!slide) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            return
        }
        renderLowerThird(ctx, slide, {
            width: canvas.width,
            height: canvas.height,
            defaultFont,
        })
    }, [slide, defaultFont])

    /** Render the current content and hand the pixels to NDI. */
    const pushFrame = useCallback(async () => {
        if (sendingRef.current) return
        const canvas = getCanvas()
        if (!canvas) return

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return

        if (slide) {
            renderLowerThird(ctx, slide, { width: canvas.width, height: canvas.height, defaultFont })
        } else {
            // Nothing on the channel: send a fully transparent frame rather than
            // stopping, so the switcher sees the graphic disappear.
            ctx.clearRect(0, 0, canvas.width, canvas.height)
        }

        // getImageData is RGBA with straight alpha, which is NDI's RGBA format —
        // no channel swizzling or premultiply correction needed.
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

        sendingRef.current = true
        try {
            await ndiPushChannelService.sendFrame(GRAPHICS_CHANNEL, {
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
    }, [getCanvas, slide, defaultFont])

    const enable = useCallback(async (): Promise<string | null> => {
        try {
            await ndiPushChannelService.open(GRAPHICS_CHANNEL, GRAPHICS_SOURCE_NAME)
            setEnabled(true)
            setError(null)
            return null
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            setError(message)
            return message
        }
    }, [setEnabled])

    const disable = useCallback(async () => {
        setEnabled(false)
        await ndiPushChannelService.close(GRAPHICS_CHANNEL)
        setFramesSent(0)
    }, [setEnabled])

    // Push immediately on any content change, then keep a slow heartbeat going.
    useEffect(() => {
        if (!isEnabled) return

        void pushFrame()
        const timer = setInterval(() => { void pushFrame() }, HEARTBEAT_MS)
        return () => clearInterval(timer)
    }, [isEnabled, pushFrame])

    // Poll the real count so the UI can tell "announced" from "sending".
    useEffect(() => {
        if (!isEnabled) return
        const timer = setInterval(async () => {
            setFramesSent(await ndiPushChannelService.framesSent(GRAPHICS_CHANNEL))
        }, 2000)
        return () => clearInterval(timer)
    }, [isEnabled])

    return { isEnabled, slide, framesSent, error, enable, disable, paintInto }
}
