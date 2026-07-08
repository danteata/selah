import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { audioFeatures } from '../../services/visualizer/audioFeatures'

/**
 * Audio-reactive motion-graphics layer for the live output (Phase 4).
 *
 * A self-contained Canvas 2D visual — a soft central glow that pulses with the
 * bass/overall energy plus drifting particles that twinkle with the highs.
 * Reads the shared {@link audioFeatures} bus in its own requestAnimationFrame
 * loop, fully decoupled from the transcription/lyrics pipeline. Renders behind
 * the lyric text (pointer-events-none) and eases out when audio goes stale or
 * the visualizer is disabled.
 *
 * Deliberately subtle: worship visuals should enhance, not distract.
 */
export function AudioReactiveBackground({ className }: { className?: string }) {
    const enabled = useAppStore((s) => s.visualizerEnabled)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        if (!enabled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const resize = () => {
            const rect = canvas.getBoundingClientRect()
            canvas.width = Math.max(1, Math.round(rect.width * dpr))
            canvas.height = Math.max(1, Math.round(rect.height * dpr))
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(canvas)

        // Particle field (positions are fractions of the canvas).
        const COUNT = 48
        const particles = Array.from({ length: COUNT }, () => ({
            x: Math.random(),
            y: Math.random(),
            r: Math.random(),
            phase: Math.random() * Math.PI * 2,
            speed: 0.2 + Math.random() * 0.8,
        }))

        // Smoothed signal state, eased each frame to avoid jitter.
        let sBass = 0
        let sRms = 0
        let sTreble = 0
        let sAlpha = 0
        let last = performance.now()
        let raf = 0

        const frame = (t: number) => {
            const dt = Math.min((t - last) / 1000, 0.05)
            last = t

            const f = audioFeatures.current
            const active = !audioFeatures.isStale()
            const ease = (cur: number, target: number, rate: number) =>
                cur + (target - cur) * Math.min(dt * rate, 1)

            sAlpha = ease(sAlpha, active ? 1 : 0, 3)
            sBass = ease(sBass, active ? f.bass : 0, 8)
            sRms = ease(sRms, active ? f.rms : 0, 6)
            sTreble = ease(sTreble, active ? f.treble : 0, 10)

            const W = canvas.width
            const H = canvas.height
            ctx.clearRect(0, 0, W, H)

            if (sAlpha > 0.01) {
                ctx.save()
                ctx.globalAlpha = sAlpha
                ctx.globalCompositeOperation = 'lighter'

                // Central glow — scales with bass, brightens with overall energy.
                const cx = W / 2
                const cy = H * 0.55
                const baseR = Math.min(W, H) * 0.28
                const glowR = baseR * (1 + sBass * 0.8 + sRms * 0.3)
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
                grad.addColorStop(0, `rgba(45,212,191,${0.14 + 0.45 * sRms})`) // teal core
                grad.addColorStop(0.5, `rgba(56,189,248,${0.06 + 0.18 * sBass})`) // sky mid
                grad.addColorStop(1, 'rgba(0,0,0,0)')
                ctx.fillStyle = grad
                ctx.beginPath()
                ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
                ctx.fill()

                // Drifting, twinkling particles.
                for (const p of particles) {
                    p.phase += dt * p.speed * (0.5 + sRms * 2)
                    const px = (p.x * W + Math.sin(p.phase) * 20 * dpr + W) % W
                    const py = (p.y * H + Math.cos(p.phase * 0.7) * 20 * dpr - sRms * 30 * dpr + H) % H
                    const size = (1 + p.r * 2) * dpr * (1 + sBass * 1.5)
                    const twinkle = (0.3 + 0.7 * Math.abs(Math.sin(p.phase * 2))) * (0.4 + sTreble)
                    ctx.fillStyle = `rgba(255,255,255,${0.14 * twinkle})`
                    ctx.beginPath()
                    ctx.arc(px, py, size, 0, Math.PI * 2)
                    ctx.fill()
                }

                ctx.restore()
            }

            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
        }
    }, [enabled])

    if (!enabled) return null
    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            className={`absolute inset-0 w-full h-full pointer-events-none ${className ?? ''}`}
        />
    )
}
