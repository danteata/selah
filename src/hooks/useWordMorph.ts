import { useLayoutEffect, useRef } from 'react'
import {
    arrivingAt, fitAffine, leavingAt, matchTokens, pairedAt, smoothstep, tokenKey,
    type Placement, type WordBox,
} from '../lib/animation/wordMorph'

/** The computed styles a clone copies so it looks like the word it stands in for. */
const CLONED_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
    'color', 'textShadow', 'webkitTextStroke', 'textDecorationLine', 'textDecorationColor',
] as const

interface MeasuredWord extends WordBox {
    text: string
    style: Partial<Record<(typeof CLONED_STYLES)[number], string>>
}

function measure(frame: HTMLElement, body: HTMLElement): MeasuredWord[] {
    const origin = frame.getBoundingClientRect()
    return Array.from(body.querySelectorAll<HTMLElement>('[data-mw]')).flatMap((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        const computed = getComputedStyle(el)
        const style: MeasuredWord['style'] = {}
        for (const prop of CLONED_STYLES) style[prop] = computed[prop]
        const text = el.textContent ?? ''
        return [{
            key: text,
            text,
            x: rect.left - origin.left,
            y: rect.top - origin.top,
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(computed.fontSize) || 0,
            style,
        }]
    })
}

function clone(word: MeasuredWord): HTMLSpanElement {
    const el = document.createElement('span')
    el.textContent = word.text
    Object.assign(el.style, word.style, {
        position: 'absolute',
        left: `${word.x}px`,
        top: `${word.y}px`,
        height: `${word.height}px`,
        lineHeight: `${word.height}px`,
        whiteSpace: 'pre',
        transformOrigin: '0 0',
        willChange: 'transform, opacity',
    })
    return el
}

function place(el: HTMLElement, p: Placement) {
    el.style.transform = `translate(${p.dx}px, ${p.dy}px) scale(${p.scale})`
    el.style.opacity = String(p.opacity)
}

interface WordMorphOptions {
    /** Morph into this slide. Off: the hook only keeps its snapshot current. */
    enabled: boolean
    slideId: string
    seconds: number
    /** Pair words ignoring case and edge punctuation. */
    normalize?: boolean
}

/**
 * Morph the words of the outgoing slide into the incoming one (see
 * lib/animation/wordMorph).
 *
 * Keeps a snapshot of where the current slide's words sit — retaken after
 * layout, after web fonts load and on resize — because by the time the next
 * slide mounts the old one's DOM is gone. When `body` changes to a new slide,
 * the new words are measured, paired with the snapshot, and drawn as clones in
 * an overlay on `frame` while the real text stays hidden; the clones are
 * removed and the text revealed when it ends. A slide that arrives mid-morph
 * cuts the running one short and morphs from where its slide settled.
 *
 * `frame` and `body` come from callback refs held in state, so the effects run
 * when the elements appear, not only when the slide id changes. That state
 * lags a render behind the DOM: on the render that swaps slides, `body` is
 * still the outgoing slide's element, already detached. Both effects skip a
 * detached body and act on the render after, which React runs before paint.
 */
export function useWordMorph(frame: HTMLElement | null, body: HTMLElement | null, options: WordMorphOptions): void {
    const snapshot = useRef<{ slideId: string; words: MeasuredWord[] } | null>(null)
    const { enabled, slideId, seconds, normalize = false } = options

    // Morph first: it needs the previous slide's snapshot before the effect
    // below replaces it with this one's.
    useLayoutEffect(() => {
        const previous = snapshot.current
        if (!enabled || !frame || !body?.isConnected || seconds <= 0) return
        if (previous?.slideId === slideId) return
        const incoming = measure(frame, body)
        if (incoming.length === 0) return

        const outgoing = previous?.words ?? []
        const pairs = matchTokens(
            outgoing.map((w) => tokenKey(w.key, normalize)),
            incoming.map((w) => tokenKey(w.key, normalize)),
        )
        const paired = new Set(pairs.filter((i): i is number => i !== null))
        const affine = fitAffine(pairs.flatMap((i, j) => (i === null ? [] : [{ from: outgoing[i], to: incoming[j] }])))

        const overlay = document.createElement('div')
        Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' })
        type Actor = { el: HTMLSpanElement; at: (t: number) => Placement }
        const actors: Actor[] = []
        incoming.forEach((word, j) => {
            const i = pairs[j]
            const from = i === null ? null : outgoing[i]
            actors.push({ el: clone(word), at: from ? (t) => pairedAt(from, word, t) : (t) => arrivingAt(word, affine, t) })
        })
        outgoing.forEach((word, i) => {
            if (!paired.has(i)) actors.push({ el: clone(word), at: (t) => leavingAt(word, affine, t) })
        })
        for (const actor of actors) {
            place(actor.el, actor.at(0))
            overlay.append(actor.el)
        }
        frame.append(overlay)
        body.style.setProperty('visibility', 'hidden')

        let raf = 0
        const started = performance.now()
        const finish = () => {
            cancelAnimationFrame(raf)
            overlay.remove()
            body.style.removeProperty('visibility')
        }
        const step = (now: number) => {
            const linear = (now - started) / 1000 / seconds
            if (linear >= 1) {
                finish()
                return
            }
            const t = smoothstep(linear)
            for (const actor of actors) place(actor.el, actor.at(t))
            raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return finish
    }, [enabled, frame, body, slideId, seconds, normalize])

    // Keep the snapshot of this slide's words current.
    useLayoutEffect(() => {
        if (!frame || !body) {
            snapshot.current = null
            return
        }
        // The outgoing slide's element, a render late: keep its snapshot.
        if (!body.isConnected) return
        const take = () => {
            snapshot.current = { slideId, words: measure(frame, body) }
        }
        take()
        let live = true
        document.fonts?.ready.then(() => { if (live) take() }).catch(() => {})
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(take)
        ro?.observe(body)
        return () => {
            live = false
            ro?.disconnect()
        }
    }, [frame, body, slideId])
}
