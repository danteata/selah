import { useEffect, useRef } from 'react'
import { motionBackgroundFor, seededRandom, type MotionBackground } from './motionBackgrounds'

/** Longest side drawn, in canvas pixels. The scenes are soft, so a 1280-wide
 *  canvas scaled to a 1080p projector looks the same and costs a third. */
const MAX_SIDE = 1280
/** Frames per second drawn. Slow motion needs no more. */
const FPS = 30

interface MotionCanvasProps {
    /** A slide background naming the scene (`motion:galaxy`), or the scene itself. */
    background: string | MotionBackground
    className?: string
    style?: React.CSSProperties
    /** Draw one frame and stop — for thumbnails that shouldn't animate. */
    still?: boolean
}

/**
 * Draws a motion background (see motionBackgrounds.ts) filling its container.
 * Falls back to the scene's poster colours if canvas isn't available.
 */
export function MotionCanvas({ background, className = '', style, still = false }: MotionCanvasProps) {
    const motion = typeof background === 'string' ? motionBackgroundFor(background) : background
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx || !motion) return

        let state: unknown = null
        let width = 0
        let height = 0
        const resize = () => {
            const rect = canvas.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return
            const scale = Math.min(1, MAX_SIDE / Math.max(rect.width, rect.height)) * (motion.scene.renderScale ?? 1)
            const w = Math.max(1, Math.round(rect.width * scale))
            const h = Math.max(1, Math.round(rect.height * scale))
            if (w === width && h === height) return
            width = w
            height = h
            canvas.width = w
            canvas.height = h
            state = motion.scene.setup(w, h, seededRandom(hash(motion.id)))
        }

        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
        observer?.observe(canvas)
        resize()

        let frame = 0
        let last = 0
        const start = performance.now()
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick)
            if (now - last < 1000 / FPS) return
            last = now
            if (width === 0) resize()
            if (width > 0) motion.scene.draw(ctx, width, height, (now - start) / 1000, state)
        }
        if (still) {
            resize()
            if (width > 0) motion.scene.draw(ctx, width, height, 12, state)
        } else {
            frame = requestAnimationFrame(tick)
        }
        return () => {
            cancelAnimationFrame(frame)
            observer?.disconnect()
        }
    }, [motion, still])

    if (!motion) return null
    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={className}
            style={{ backgroundImage: motion.poster, width: '100%', height: '100%', display: 'block', ...style }}
        />
    )
}

function hash(text: string): number {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
    return h >>> 0
}
