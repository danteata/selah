import { describe, it, expect } from 'vitest'
import { appliesToValidator } from '../../../convex/schema'
import {
    normalizeAppliesTo,
    TEMPLATE_SLIDE_TYPE_OPTIONS,
    type SlideType,
} from '../useTemplates'

/** The literal values the Convex `templates.appliesTo` column accepts. */
function schemaValues(): string[] {
    const element = (appliesToValidator as unknown as { element: { members: { value: string }[] } }).element
    return element.members.map((m) => m.value)
}

describe('template appliesTo vocabulary', () => {
    it('offers only values the backend accepts', () => {
        // The bug this pins: SaveAsTemplateModal offered "Sermon" and "Prayer"
        // while the create/update mutations rejected them, so the client stripped
        // them before every write.
        const accepted = new Set(schemaValues())
        for (const option of TEMPLATE_SLIDE_TYPE_OPTIONS) {
            expect(accepted, `"${option.id}" is offered in the UI`).toContain(option.id)
        }
    })

    it('offers no value that no slide can ever have', () => {
        // Slides are created with these types only; anything else can never match
        // in `getTemplatesForSlideType`, so offering it promises a filter that
        // silently does nothing. 'any' is the explicit no-restriction sentinel.
        const realSlideTypes = new Set([
            'bible', 'song', 'hymn', 'dictionary', 'text', 'media', 'countdown', 'alert', 'any',
        ])
        for (const option of TEMPLATE_SLIDE_TYPE_OPTIONS) {
            expect(realSlideTypes, `"${option.id}" is offered in the UI`).toContain(option.id)
        }
    })

    it('still accepts the legacy values, so existing rows can be edited', () => {
        // Narrowing the union would need a migration first; until then an
        // operator editing a template stored with ['sermon'] must not have the
        // mutation reject its own stored value.
        expect(schemaValues()).toContain('sermon')
        expect(schemaValues()).toContain('prayer')
        expect(schemaValues()).toContain('announcement')
    })
})

describe('normalizeAppliesTo', () => {
    it('passes every offered option through untouched', () => {
        for (const option of TEMPLATE_SLIDE_TYPE_OPTIONS) {
            expect(normalizeAppliesTo([option.id])).toEqual([option.id])
        }
    })

    it('never widens a restricted template to apply to everything', () => {
        // The reported failure mode: a template restricted to Sermon was saved as
        // applying to *every* slide type — the narrowest choice silently became
        // the widest, because stripping the value emptied the list and the old
        // fallback substituted ['any'].
        for (const value of ['sermon', 'prayer', 'announcement'] as SlideType[]) {
            const result = normalizeAppliesTo([value])
            expect(result ?? []).not.toContain('any')
        }
    })

    it('preserves legacy values rather than rewriting the operator’s choice', () => {
        expect(normalizeAppliesTo(['sermon'])).toEqual(['sermon'])
        expect(normalizeAppliesTo(['bible', 'prayer'])).toEqual(['bible', 'prayer'])
    })

    it('drops values the backend would reject', () => {
        expect(normalizeAppliesTo(['bible', 'nonsense' as SlideType])).toEqual(['bible'])
    })

    it('reports "no restriction" as undefined, not as a fabricated ["any"]', () => {
        // `getTemplatesForSlideType` already reads a missing appliesTo as
        // unconstrained, so there is no need to invent a value.
        expect(normalizeAppliesTo([])).toBeUndefined()
        expect(normalizeAppliesTo(['nonsense' as SlideType])).toBeUndefined()
        expect(normalizeAppliesTo(undefined)).toBeUndefined()
    })
})
