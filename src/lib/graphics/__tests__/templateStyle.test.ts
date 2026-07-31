import { describe, it, expect } from 'vitest'
import { isLowerThirdTemplate, templateSlide, withTemplateStyle } from '../templateStyle'
import type { TemplateItem } from '../../../hooks/useTemplates'
import type { Slide } from '../../../types'

const template = (slide: unknown, name = 'Design'): TemplateItem =>
    ({ _id: 't1', name, slideId: slide } as unknown as TemplateItem)

const slide = (overrides: Partial<Slide> = {}): Slide =>
    ({ id: 's1', type: 'bible', layout: 'full_text', contents: ['<p>x</p>'], slideStyle: { font: 'Inter' }, ...overrides } as unknown as Slide)

describe('templateSlide', () => {
    it('reads a template stored either as JSON or as an object', () => {
        // Both shapes exist in saved templates, which is why this isn't a cast.
        expect(templateSlide(template('{"layout":"lower-third"}'))?.layout).toBe('lower-third')
        expect(templateSlide(template({ layout: 'lower-third' }))?.layout).toBe('lower-third')
        expect(templateSlide(template('not json'))).toBeNull()
        expect(templateSlide(null)).toBeNull()
    })
})

describe('isLowerThirdTemplate', () => {
    it('recognises both stored spellings and rejects other layouts', () => {
        expect(isLowerThirdTemplate(template({ layout: 'lower-third' }))).toBe(true)
        expect(isLowerThirdTemplate(template({ layout: 'lower_third' }))).toBe(true)
        expect(isLowerThirdTemplate(template({ layout: 'full_text' }))).toBe(false)
        expect(isLowerThirdTemplate(template({}))).toBe(false)
    })
})

describe('withTemplateStyle', () => {
    it("applies the output's styling over the slide's own", () => {
        const styled = withTemplateStyle(
            slide(),
            template({ layout: 'lower-third', slideStyle: { lowerThirdStyle: 'accent-bar', lowerThirdAccentColor: '#ff0000' } }),
        )

        expect(styled.layout).toBe('lower-third')
        expect(styled.slideStyle?.lowerThirdStyle).toBe('accent-bar')
        expect(styled.slideStyle?.lowerThirdAccentColor).toBe('#ff0000')
        // Values the template doesn't set survive.
        expect(styled.slideStyle?.font).toBe('Inter')
    })

    it('leaves the original slide untouched', () => {
        // It may be the very slide live on the projector: styling one output must
        // not restyle the other.
        const original = slide()
        withTemplateStyle(original, template({ layout: 'lower-third', slideStyle: { lowerThirdStyle: 'gradient-bar' } }))
        expect(original.layout).toBe('full_text')
        expect(original.slideStyle?.lowerThirdStyle).toBeUndefined()
    })

    it('ignores a template with no styling, and no template at all', () => {
        const bare = slide()
        expect(withTemplateStyle(bare, template({ layout: 'lower-third' }))).toBe(bare)
        expect(withTemplateStyle(bare, null)).toBe(bare)
    })

    it('does not carry the template background across', () => {
        // A lower third never shows one, and the live slide's background belongs
        // to the projector.
        const styled = withTemplateStyle(
            slide(),
            template({ layout: 'lower-third', background: 'photo.jpg', slideStyle: { lowerThirdStyle: 'minimalist' } }),
        )
        expect(styled.background).toBeUndefined()
    })
})
