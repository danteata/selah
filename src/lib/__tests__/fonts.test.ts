import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SLIDE_FONTS, cssFontStack } from '../fonts'

describe('cssFontStack', () => {
    it('quotes the family and appends its generic fallback', () => {
        expect(cssFontStack('Inter')).toBe('"Inter", sans-serif')
        expect(cssFontStack('Playfair Display')).toBe('"Playfair Display", serif')
        expect(cssFontStack('Georgia')).toBe('"Georgia", serif')
    })

    it('makes a family that is not a CSS identifier valid', () => {
        // Bare, "Source Sans 3" invalidates the whole declaration.
        expect(cssFontStack('Source Sans 3')).toBe('"Source Sans 3", sans-serif')
    })

    it('falls back to the default font when none is set', () => {
        expect(cssFontStack(undefined)).toBe('"Inter", sans-serif')
        expect(cssFontStack('')).toBe('"Inter", sans-serif')
        expect(cssFontStack('   ')).toBe('"Inter", sans-serif')
    })

    it('leaves stacks and generic families alone', () => {
        expect(cssFontStack('Inter, system-ui, sans-serif')).toBe('Inter, system-ui, sans-serif')
        expect(cssFontStack('monospace')).toBe('monospace')
    })

    it('does not double-quote an already quoted name, and escapes quotes', () => {
        expect(cssFontStack("'Open Sans'")).toBe('"Open Sans", sans-serif')
        expect(cssFontStack('My "Font"')).toBe('"My \\"Font\\"", sans-serif')
    })

    it('matches known families case-insensitively for the fallback', () => {
        expect(cssFontStack('playfair display')).toBe('"playfair display", serif')
    })
})

describe('slide-fonts.css', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/slide-fonts.css'), 'utf8')

    it.each(SLIDE_FONTS.map((f) => f.family))('self-hosts %s at the weights slides render', (family) => {
        for (const weight of [400, 700]) {
            const face = new RegExp(`font-family: '${family}';\\s*font-style: normal;\\s*font-weight: ${weight};`)
            expect(css).toMatch(face)
        }
    })

    it('serves Georgia from an installed copy first, then Gelasio', () => {
        expect(css).toMatch(/font-family: 'Georgia';[\s\S]*?src: local\('Georgia'\), url\('[^']*gelasio[^']*'\)/)
    })
})
