import { describe, expect, it } from 'vitest'
import { buildInDuration, isTextBuildInPreset, selectionAt, TEXT_BUILD_INS, unitStyle, wrapUnits, type TextBuildInPreset } from '../textBuildIn'

const presets = Object.keys(TEXT_BUILD_INS) as TextBuildInPreset[]

describe('text build-in presets', () => {
    it.each(presets)('%s starts with every unit hidden and ends with every unit arrived', (preset) => {
        const anim = { preset }
        const end = buildInDuration(anim)
        for (let i = 0; i < 6; i++) {
            expect(selectionAt(anim, 0, i, 6)).toBeCloseTo(1, 6)
            expect(selectionAt(anim, end, i, 6)).toBeCloseTo(0, 6)
        }
    })

    it.each(presets)('%s brings units in from the first to the last', (preset) => {
        const anim = { preset }
        const mid = buildInDuration(anim) / 2
        const s = Array.from({ length: 6 }, (_, i) => selectionAt(anim, mid, i, 6))
        s.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(s[i]))
        expect(s[0]).toBeLessThan(s[5])
    })

    it('honours a custom duration', () => {
        expect(buildInDuration({ preset: 'typewriter', duration: 3 })).toBe(3)
        expect(selectionAt({ preset: 'typewriter', duration: 3 }, 1.2, 5, 6)).toBe(1)
    })

    it('fades and moves a unit by its selection', () => {
        expect(unitStyle('word-rise', 1)).toEqual({ opacity: '0', transform: 'translate(0em, 0.6em)' })
        expect(unitStyle('word-rise', 0)).toEqual({ opacity: '', transform: '' })
        expect(unitStyle('typewriter', 0.5)).toEqual({ opacity: '0.5', transform: '' })
    })

    it('recognises stored presets', () => {
        expect(isTextBuildInPreset('slide-in')).toBe(true)
        expect(isTextBuildInPreset('spin')).toBe(false)
        expect(isTextBuildInPreset(undefined)).toBe(false)
    })
})

describe('wrapUnits', () => {
    const text = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent

    it('wraps words, keeping tags and the visible text', () => {
        const html = '<p>Pastor <b>Ama</b> Mensah</p>'
        const wrapped = wrapUnits(html, 'word-rise')
        expect(text(wrapped)).toBe(text(html))
        expect(wrapped).toContain('<b><span data-u="1"')
        expect(wrapped.match(/data-u=/g)).toHaveLength(3)
    })

    it('starts every unit in its before state, so nothing flashes up', () => {
        const wrapped = wrapUnits('<p>Hi</p>', 'word-rise')
        expect(wrapped).toContain('display:inline-block;opacity:0;transform:translate(0em, 0.6em);')
    })

    it('counts characters, leaving spaces out when the preset says so', () => {
        expect(wrapUnits('<p>a b</p>', 'typewriter').match(/data-u=/g)).toHaveLength(3)
        expect(wrapUnits('<p>a b</p>', 'letter-fade').match(/data-u=/g)).toHaveLength(2)
    })

    it('splits characters by code point, not UTF-16 unit', () => {
        expect(wrapUnits('<p>Ɔ😀</p>', 'typewriter').match(/data-u=/g)).toHaveLength(2)
    })

    it('escapes text it rewraps', () => {
        expect(wrapUnits('<p>a &lt;b&gt;</p>', 'word-rise')).toContain('&lt;b&gt;')
    })
})
