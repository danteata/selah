import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SerializedDockview } from 'dockview-react'
import { checkLayoutName, loadSavedLayouts, writeSavedLayouts, loadLoadedLayout, writeLoadedLayout, type SavedLayout } from '../savedLayouts'

vi.mock('../layoutStorage', () => ({
    isShowableLayout: (layout: { panels?: Record<string, unknown> }) => !!layout?.panels && 'live' in layout.panels,
}))

const saved = (id: string, name: string, panels: string[] = ['live']): SavedLayout => ({
    id,
    name,
    savedAt: 1,
    layout: { grid: {}, panels: Object.fromEntries(panels.map((p) => [p, {}])) } as unknown as SerializedDockview,
})

describe('saved layouts', () => {
    beforeEach(() => localStorage.clear())

    it('reads back the ones this version can show, and skips the rest', () => {
        writeSavedLayouts([saved('a', 'Sunday'), saved('b', 'Broken', ['bible'])])
        expect(loadSavedLayouts().map((l) => l.name)).toEqual(['Sunday'])
    })

    it('remembers which layout was loaded, and forgets a malformed record', () => {
        writeLoadedLayout({ kind: 'saved', id: 'a', signature: 's' })
        expect(loadLoadedLayout()).toEqual({ kind: 'saved', id: 'a', signature: 's' })
        localStorage.setItem('selah-desk-loaded-layout-v1', JSON.stringify({ kind: 'builtin', id: 'nope', signature: 's' }))
        expect(loadLoadedLayout()).toBeNull()
        writeLoadedLayout(null)
        expect(loadLoadedLayout()).toBeNull()
    })

    describe('names', () => {
        const existing = [saved('a', 'Sunday Morning')]

        it('trims and tidies spaces', () => {
            expect(checkLayoutName('  Youth   night ', existing)).toEqual({ name: 'Youth night' })
        })

        it('refuses an empty name, a long one, a built-in one, or one already used', () => {
            expect(checkLayoutName('   ', existing)).toHaveProperty('error')
            expect(checkLayoutName('x'.repeat(41), existing)).toHaveProperty('error')
            expect(checkLayoutName('classic', existing)).toHaveProperty('error')
            expect(checkLayoutName('sunday morning', existing)).toHaveProperty('error')
        })

        it('lets a layout keep its own name when renamed', () => {
            expect(checkLayoutName('Sunday Morning', existing, 'a')).toEqual({ name: 'Sunday Morning' })
        })
    })
})
