import { useEffect, useRef } from 'react'
import { audioFeatures } from '../../services/visualizer/audioFeatures'

interface KineticTextProps {
    enabled: boolean
    children: React.ReactNode
    /**
     * Applied to the wrapper div — pass the flex-sizing classes the wrapped
     * content used to carry itself (e.g. `flex-1 min-h-0`), since this
     * wrapper now takes over that layout role. The wrapped content should
     * keep its own visual classes (text color/alignment/etc.) and add
     * `w-full h-full` so it fills this wrapper's box.
     */
    className?: string
}

/**
 * Whole-block "kinetic typography" motion for the live-output lyric/verse
 * text — the entire text block punches/scales in sync with the song's beat,
 * layered as a pure CSS `transform` on a wrapper *outside* `AutoFitText`.
 * Never touches `AutoFitText`'s own binary-search font-fit measurement: a
 * transform doesn't affect layout/reflow, so the fit algorithm sees exactly
 * the same box it always would.
 *
 * Reads the shared `audioFeatures` bus in its own requestAnimationFrame loop,
 * the same shape as `AudioReactiveBackground` — decoupled from the
 * transcription/lyrics pipeline, writes directly to the DOM (no React state)
 * so it never thrashes re-renders.
 */
export function KineticText({ enabled, children, className }: KineticTextProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!enabled) return
        const el = wrapperRef.current
        if (!el) return

        let sRms = 0
        let sScale = 1
        let last = performance.now()
        let raf = 0
        // Alternates so consecutive beats don't skew the same direction every time.
        let skewSign = 1

        const frame = (t: number) => {
            const dt = Math.min((t - last) / 1000, 0.05)
            last = t

            const active = !audioFeatures.isStale()
            const f = audioFeatures.current
            const beatPulse = audioFeatures.beatPulse
            const ease = (cur: number, target: number, rate: number) =>
                cur + (target - cur) * Math.min(dt * rate, 1)

            sRms = ease(sRms, active ? f.rms : 0, 6)

            const targetScale = active ? 1 + sRms * 0.03 + beatPulse * 0.09 : 1
            sScale = ease(sScale, targetScale, 10)

            if (beatPulse > 0.9) skewSign = -skewSign
            const skew = beatPulse * 1.5 * skewSign

            el.style.transform = `scale(${sScale.toFixed(4)}) skewX(${skew.toFixed(3)}deg)`

            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            el.style.transform = ''
        }
    }, [enabled])

    return (
        <div ref={wrapperRef} className={className} style={{ willChange: enabled ? 'transform' : undefined }}>
            {children}
        </div>
    )
}
