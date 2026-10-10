import { useLayoutEffect } from 'react'
import { buildInDuration, selectionAt, TEXT_BUILD_INS, unitStyle, type TextAnimation } from '../lib/animation/textBuildIn'

/** Whether the viewer has asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Play a text build-in over the units `wrapUnits` marked inside `root`.
 *
 * Takes the element itself (from a callback ref held in state) rather than a
 * ref object: the wrapped units start hidden, so the effect must run whenever
 * the element appears, and a parent that mounts its content a render later
 * (SlideView waits for its width) would otherwise leave the text hidden for good.
 *
 * Writes each unit's opacity and transform straight to the DOM every frame —
 * no React state, so a build-in costs no re-renders. Runs again when
 * `replayKey` changes (a new slide). Units end in their natural state with the
 * inline styles cleared, and are revealed at once if the effect is torn down
 * mid-way, so text is never left hidden.
 */
export function useTextBuildIn(
    root: HTMLElement | null,
    animation: TextAnimation | null,
    replayKey: string,
): void {
    const preset = animation?.preset
    const duration = animation?.duration
    const delay = animation?.delay

    useLayoutEffect(() => {
        if (!root || !preset) return
        const anim: TextAnimation = { preset, duration, delay }
        const units = Array.from(root.querySelectorAll<HTMLElement>('[data-u]'))
        if (units.length === 0) return

        const reveal = () => {
            for (const el of units) {
                el.style.opacity = ''
                el.style.transform = ''
            }
        }

        // Lines exist only once laid out: group the word units by the line
        // box they landed on.
        const groups: HTMLElement[][] = []
        if (TEXT_BUILD_INS[preset].basedOn === 'lines') {
            let lastTop = Number.NEGATIVE_INFINITY
            for (const el of units) {
                const top = el.offsetTop
                if (groups.length === 0 || top > lastTop + el.offsetHeight / 2) {
                    groups.push([])
                    lastTop = top
                }
                groups[groups.length - 1].push(el)
            }
        } else {
            for (const el of units) groups.push([el])
        }

        const total = buildInDuration(anim)
        const wait = Math.max(0, delay ?? 0)
        const n = groups.length
        let raf = 0
        const started = performance.now()

        const frame = (now: number) => {
            const t = (now - started) / 1000 - wait
            if (t >= total) {
                reveal()
                return
            }
            const local = Math.max(0, t)
            groups.forEach((els, i) => {
                const style = unitStyle(preset, selectionAt(anim, local, i, n))
                for (const el of els) {
                    el.style.opacity = style.opacity
                    el.style.transform = style.transform
                }
            })
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            reveal()
        }
    }, [root, preset, duration, delay, replayKey])
}
