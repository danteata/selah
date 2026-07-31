import { describe, it, expect } from 'vitest'
import { resolveVerseRefPx, VERSE_REF_BOUNDS, getVerseRefStyle } from '../verseRefStyle'

const HD_WIDTH = 1920

describe('resolveVerseRefPx', () => {
    it('resolves the same size the projector\'s clamp() would', () => {
        // 1vw is a hundredth of the frame: 2.4vw of 1920 = 46px, inside the
        // lower-third bounds of 20–48.
        expect(resolveVerseRefPx(undefined, undefined, VERSE_REF_BOUNDS.lowerThird, HD_WIDTH)).toBeCloseTo(46.08)
        // 6.4vw of 1920 = 123px, inside the full-slide bounds of 56–160.
        expect(resolveVerseRefPx(undefined, undefined, VERSE_REF_BOUNDS.fullSlide, HD_WIDTH)).toBeCloseTo(122.88)
    })

    it('scales with the percentage and honours the clamp at both ends', () => {
        const bounds = VERSE_REF_BOUNDS.fullSlide
        const at = (percent: number, width = HD_WIDTH) =>
            resolveVerseRefPx({ verseRefSizePercent: percent }, undefined, bounds, width)

        expect(at(200)).toBeCloseTo(245.76)
        expect(at(50)).toBeCloseTo(61.44)
        // On a narrow frame the scaled minimum takes over...
        expect(at(100, 400)).toBeCloseTo(bounds.minPx)
        // ...and on a very wide one, the scaled maximum.
        expect(at(100, 6000)).toBeCloseTo(bounds.maxPx)
    })

    it('prefers the slide over the global default, as the editor does', () => {
        const bounds = VERSE_REF_BOUNDS.fullSlide
        const slideWins = resolveVerseRefPx({ verseRefSizePercent: 50 }, { verseRefSizePercent: 200 }, bounds, HD_WIDTH)
        const globalUsed = resolveVerseRefPx(undefined, { verseRefSizePercent: 200 }, bounds, HD_WIDTH)
        expect(slideWins).toBeLessThan(globalUsed)
    })

    it('keeps the two layouts proportionate to each other', () => {
        // A lower third's citation is smaller than a full slide's at the same
        // percentage, which is why one setting has to resolve per layout.
        const lower = resolveVerseRefPx(undefined, undefined, VERSE_REF_BOUNDS.lowerThird, HD_WIDTH)
        const full = resolveVerseRefPx(undefined, undefined, VERSE_REF_BOUNDS.fullSlide, HD_WIDTH)
        expect(lower).toBeLessThan(full)
    })
})

describe('getVerseRefStyle', () => {
    it('builds a clamp() from the same bounds the pixel resolver uses', () => {
        // The CSS and canvas paths must stay in step; this is the shared source.
        const style = getVerseRefStyle(undefined, undefined, VERSE_REF_BOUNDS.lowerThird)
        expect(style.fontSize).toBe('clamp(20px, 2.4vw, 48px)')
    })

    it('scales the whole clamp by the percentage', () => {
        const style = getVerseRefStyle({ verseRefSizePercent: 200 }, undefined, VERSE_REF_BOUNDS.fullSlide)
        expect(style.fontSize).toBe('clamp(112px, 12.8vw, 320px)')
    })
})
