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
        // Alternates so consecutive beats don't skew the same direction every
        // time. Latched on the bus's beat counter rather than on the pulse
        // level: `beatPulse > 0.9` is true for the ~14 ms after a beat, which is
        // one frame at 60 Hz but two at 120 Hz — so flipping on the level flipped
        // twice on high-refresh displays and cancelled out, leaving every beat
        // skewing the same way on exactly the hardware most likely to be driving
        // a projector.
        let skewSign = 1
        let lastBeat = audioFeatures.beatCount

        const frame = (t: number) => {
            const dt = Math.min((t - last) / 1000, 0.05)
            last = t

            const active = !audioFeatures.isStale()
            const f = audioFeatures.current
            const beatPulse = active ? audioFeatures.beatPulse : 0
            const ease = (cur: number, target: number, rate: number) =>
                cur + (target - cur) * Math.min(dt * rate, 1)

            sRms = ease(sRms, active ? f.rms : 0, 6)

            const beat = audioFeatures.beatCount
            if (beat !== lastBeat) {
                lastBeat = beat
                skewSign = -skewSign
            }

            const targetScale = active ? 1 + sRms * 0.03 + beatPulse * 0.09 : 1
            // Asymmetric easing: snap to the punch, ease out of it. Easing the
            // attack too (the previous single rate of 10 ≈ a 100 ms time
            // constant) delayed the peak of every beat by about a tenth of a
            // second — enough to read as being off the music. The release stays
            // eased so it still feels like a swell rather than a strobe.
            const rate = targetScale > sScale ? 40 : 9
            sScale = ease(sScale, targetScale, rate)

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
