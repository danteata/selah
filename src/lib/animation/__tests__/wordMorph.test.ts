import { describe, expect, it } from 'vitest'
import { arrivingAt, fitAffine, leavingAt, matchTokens, pairedAt, smoothstep, tokenKey, wrapWords, type WordBox } from '../wordMorph'

const box = (key: string, x: number, y: number, fontSize = 40): WordBox => ({ key, x, y, width: 50, height: fontSize, fontSize })

describe('wrapWords', () => {
    const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent

    it('wraps each word, keeping tags, spacing and the visible text', () => {
        const html = '<p>Amazing <strong>grace</strong>, how sweet</p><p>the sound</p>'
        const wrapped = wrapWords(html)
        expect(text(wrapped)).toBe(text(html))
        // The comma after </strong> is its own text node, so its own token.
        expect(wrapped.match(/data-mw/g)).toHaveLength(7)
        expect(wrapped).toContain('<strong><span data-mw="">grace</span></strong>')
    })

    it('leaves empty content alone', () => {
        expect(wrapWords('')).toBe('')
    })
})

describe('matchTokens', () => {
    it('pairs words in reading order, each once', () => {
        expect(matchTokens(['Hello', 'wide', 'world'], ['world', 'says', 'Hello'])).toEqual([2, null, 0])
    })

    it('pairs repeated words in order', () => {
        expect(matchTokens(['Holy', 'holy', 'Holy'], ['Holy', 'Holy', 'Holy'])).toEqual([0, 2, null])
    })

    it('is case-sensitive unless keys are normalised', () => {
        expect(matchTokens(['Grace,'], ['grace'])).toEqual([null])
        expect(matchTokens([tokenKey('Grace,', true)], [tokenKey('grace', true)])).toEqual([0])
    })
})

describe('fitAffine', () => {
    it('recovers a uniform scale and shift', () => {
        const from = [box('a', 10, 20), box('b', 110, 20), box('c', 10, 80)]
        const to = from.map((b) => box(b.key, b.x * 2 + 5, b.y * 2 - 3, 80))
        const f = fitAffine(from.map((b, i) => ({ from: b, to: to[i] })))
        expect(f?.s).toBeCloseTo(2)
        expect(f?.cx).toBeCloseTo(5)
        expect(f?.cy).toBeCloseTo(-3)
    })

    it('is null with nothing shared', () => {
        expect(fitAffine([])).toBeNull()
    })
})

describe('placements', () => {
    const from = box('grace', 100, 50, 40)
    const to = box('grace', 300, 200, 80)

    it('carries a shared word from its old box to its new one', () => {
        expect(pairedAt(from, to, 0)).toEqual({ dx: -200, dy: -150, scale: 0.5, opacity: 1 })
        expect(pairedAt(from, to, 1)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 1 })
    })

    it('fades an unshared old word out along the fitted map', () => {
        const f = { s: 2, cx: 10, cy: 0 }
        expect(leavingAt(from, f, 0)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 1 })
        // At t = 1 it sits at F(p) = 2p + c: 210, 100.
        const end = leavingAt(from, f, 1)
        expect(from.x + end.dx).toBe(210)
        expect(from.y + end.dy).toBe(100)
        expect(end.opacity).toBe(0)
    })

    it('fades an unshared new word in from where the map says it came from', () => {
        const f = { s: 2, cx: 10, cy: 0 }
        const start = arrivingAt(to, f, 0)
        expect(to.x + start.dx).toBe(145) // F⁻¹(300) = (300 - 10) / 2
        expect(start.scale).toBe(0.5)
        expect(start.opacity).toBe(0)
        expect(arrivingAt(to, f, 1)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 1 })
    })

    it('crossfades in place when nothing is shared', () => {
        expect(leavingAt(from, null, 0.25)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 0.75 })
        expect(arrivingAt(to, null, 0.25)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 0.25 })
    })

    it('eases with smoothstep', () => {
        expect(smoothstep(0)).toBe(0)
        expect(smoothstep(0.5)).toBe(0.5)
        expect(smoothstep(1)).toBe(1)
        expect(smoothstep(2)).toBe(1)
    })
})
