import { describe, it, expect } from 'vitest'
import { isCaptionedSlideType, slideCaptionHtml } from '../slideCaption'
import type { Slide } from '../../types'

const slide = (type: string, contents: string[]) => ({ type, contents }) as Slide

describe('slideCaptionHtml', () => {
    it('returns the reference label of a bible slide', () => {
        expect(slideCaptionHtml(slide('bible', ['<p>body</p>', '<p>John 3:16</p>'])))
            .toBe('<p>John 3:16</p>')
    })

    it('returns the headword label of a dictionary slide', () => {
        expect(slideCaptionHtml(slide('dictionary', ['<p>definition</p>', '<p>Aaron</p>'])))
            .toBe('<p>Aaron</p>')
    })

    it('ignores contents[1] on slide types that use it as body text', () => {
        // A countdown keeps its time string in contents[1]; rendering that as a
        // caption would double it up on screen.
        expect(slideCaptionHtml(slide('countdown', ['Starting soon', '00:05:00']))).toBe('')
        expect(slideCaptionHtml(slide('text', ['line one', 'line two']))).toBe('')
    })

    it('is empty when a captioned slide has no caption', () => {
        expect(slideCaptionHtml(slide('bible', ['<p>body</p>']))).toBe('')
    })

    it('tolerates a missing slide', () => {
        expect(slideCaptionHtml(null)).toBe('')
        expect(slideCaptionHtml(undefined)).toBe('')
    })
})

describe('isCaptionedSlideType', () => {
    it('covers bible and dictionary slides', () => {
        expect(isCaptionedSlideType('bible')).toBe(true)
        expect(isCaptionedSlideType('dictionary')).toBe(true)
    })

    it('excludes everything else', () => {
        for (const type of ['song', 'hymn', 'text', 'media', 'countdown']) {
            expect(isCaptionedSlideType(type)).toBe(false)
        }
        expect(isCaptionedSlideType(undefined)).toBe(false)
    })
})
