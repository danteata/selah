import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    INLINE_NAV_SECTIONS,
    isInlineNavSection,
    NAV_RAIL_ITEMS,
    type NavSection,
} from '../studio'

/**
 * Sections AppShell turns into modals instead of context-panel content.
 * Kept in step with the `activeNavSection === …` branches in AppShell.
 */
const MODAL_SECTIONS: NavSection[] = ['library', 'schedule', 'settings']

describe('nav section routing', () => {
    it('routes every nav rail item somewhere', () => {
        // A section that is neither inline nor modal-backed is a rail button
        // that does nothing when clicked — which is exactly how the dictionary
        // shipped invisible the first time.
        const unrouted = NAV_RAIL_ITEMS
            .map((item) => item.id)
            .filter((id) => !INLINE_NAV_SECTIONS.includes(id) && !MODAL_SECTIONS.includes(id))

        expect(unrouted).toEqual([])
    })

    it('treats the dictionary as inline content', () => {
        expect(isInlineNavSection('dictionary')).toBe(true)
    })

    it('does not treat modal sections as inline content', () => {
        for (const section of MODAL_SECTIONS) {
            expect(isInlineNavSection(section)).toBe(false)
        }
    })

    it('handles a null section', () => {
        expect(isInlineNavSection(null)).toBe(false)
    })

    it('is the only inline-section list in the codebase', () => {
        // AppShell and ContextPanel each used to carry their own literal, and a
        // section added to one but not the other is silently unreachable. Both
        // must go through the shared predicate.
        for (const file of ['../../components/layout/AppShell.tsx', '../../components/layout/ContextPanel.tsx']) {
            const source = readFileSync(join(__dirname, file), 'utf8')
            expect(source, `${file} should use isInlineNavSection`).toContain('isInlineNavSection')
            expect(source, `${file} should not redeclare the list`).not.toContain('INLINE_SECTIONS')
        }
    })
})
