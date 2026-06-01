import { useLayoutEffect, useRef, type CSSProperties } from 'react'

interface AutoFitTextProps {
    html: string
    className?: string
    style?: CSSProperties
    /** Lower bound (px) for the font-size search. */
    minPx?: number
    /** Upper bound (px) for the font-size search. */
    maxPx?: number
    /**
     * Binary-search iterations. 14 ≈ 0.006 % precision on a 720 px range — plenty for
     * pixel-perfect typography without burning frames.
     */
    iterations?: number
    /** Slack pixels reserved on every edge so text never kisses the container. */
    padding?: number
}

/**
 * AutoFitText
 *
 * Renders arbitrary HTML and scales its font-size to the largest value at which
 * the content still fits the parent container without overflow. It re-fits when
 * the HTML changes, when the container resizes, and after web-fonts finish loading
 * (so the search isn't fooled by a fallback font's metrics).
 *
 * Algorithm:
 *   1. Try `maxPx` — if it fits, take it.
 *   2. If `minPx` itself overflows, pin to `minPx` and let `overflow: hidden` clip.
 *   3. Otherwise binary-search between bounds.
 *
 * The chosen size is written directly to the measurement node's `style.fontSize`
 * (no React state) so re-fits never trigger an extra render pass — measurement-driven
 * layout stays a pure DOM concern.
 *
 * Container must have a deterministic width AND height (flex-1, fixed px, aspect-ratio,
 * etc.). Auto-fit cannot work against an auto-sized parent — it would feed back into
 * itself and oscillate.
 */
export function AutoFitText({
    html,
    className,
    style,
    minPx = 12,
    maxPx = 720,
    iterations = 14,
    padding = 0,
}: AutoFitTextProps) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const measureRef = useRef<HTMLDivElement | null>(null)

    useLayoutEffect(() => {
        const container = containerRef.current
        const measure = measureRef.current
        if (!container || !measure) return

        // Treat empty / whitespace-only HTML as zero — pin to minPx and bail.
        const stripped = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
        if (!stripped) {
            measure.style.fontSize = `${minPx}px`
            return
        }

        const fit = () => {
            const availW = container.clientWidth - padding * 2
            const availH = container.clientHeight - padding * 2
            if (availW <= 0 || availH <= 0) return

            const fits = (px: number): boolean => {
                measure.style.fontSize = `${px}px`
                // Reads `scrollWidth`/`scrollHeight` force a layout flush, so the
                // assignment above is observed before the next iteration's write.
                return measure.scrollWidth <= availW && measure.scrollHeight <= availH
            }

            if (fits(maxPx)) return
            if (!fits(minPx)) {
                measure.style.fontSize = `${minPx}px`
                return
            }

            let low = minPx
            let high = maxPx
            for (let i = 0; i < iterations; i++) {
                const mid = (low + high) / 2
                if (fits(mid)) low = mid
                else high = mid
            }
            measure.style.fontSize = `${Math.max(minPx, Math.floor(low))}px`
        }

        fit()

        // Re-fit when web fonts finish loading — fallback metrics lie.
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            document.fonts.ready.then(fit).catch(() => { /* ignore */ })
        }

        // Re-fit on container resize.
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(fit)
            ro.observe(container)
            return () => ro.disconnect()
        }
        return
    }, [html, minPx, maxPx, iterations, padding])

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                ...style,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <div
                ref={measureRef}
                style={{
                    fontSize: `${minPx}px`,
                    width: '100%',
                    maxWidth: '100%',
                    lineHeight: style?.lineHeight ?? 1.2,
                }}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    )
}
