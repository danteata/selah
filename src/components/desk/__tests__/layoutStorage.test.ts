import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { SerializedDockview } from 'dockview-react'
import { DESK_LAYOUT_KEY, loadDeskLayout, saveDeskLayout, clearDeskLayout, removeRetiredLayoutKeys } from '../layoutStorage'

vi.mock('../deskPanels', () => ({
    isDeskPanelId: (id: string) => ['serviceOrder', 'preview', 'live', 'bible'].includes(id),
}))

function layout(panelIds: string[]): SerializedDockview {
    return {
        grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
        panels: Object.fromEntries(panelIds.map((id) => [id, { id, contentComponent: id, title: id }])),
        activeGroup: undefined,
    } as unknown as SerializedDockview
}

describe('desk layout storage', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.restoreAllMocks())

    it('reads back what it saved', () => {
        saveDeskLayout(layout(['live', 'bible']))
        expect(Object.keys(loadDeskLayout()?.panels ?? {})).toEqual(['live', 'bible'])
    })

    it('has nothing when nothing was saved, or after clearing', () => {
        expect(loadDeskLayout()).toBeNull()
        saveDeskLayout(layout(['live']))
        clearDeskLayout()
        expect(loadDeskLayout()).toBeNull()
    })

    it('ignores a save it cannot read', () => {
        localStorage.setItem(DESK_LAYOUT_KEY, '{not json')
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(loadDeskLayout()).toBeNull()
    })

    it('ignores a save naming a panel this version lacks, or without Live', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        saveDeskLayout(layout(['live', 'quickActions']))
        expect(loadDeskLayout()).toBeNull()
        saveDeskLayout(layout(['bible']))
        expect(loadDeskLayout()).toBeNull()
    })

    it('copes with storage that throws', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(() => saveDeskLayout(layout(['live']))).not.toThrow()
        expect(loadDeskLayout()).toBeNull()
    })

    it("drops the Dashboard grid's keys", () => {
        localStorage.setItem('selah-dashboard-layout', '{}')
        localStorage.setItem('selah-dashboard-preset', 'default')
        localStorage.setItem('selah-dashboard-edit-locked', 'true')
        removeRetiredLayoutKeys()
        expect(localStorage.getItem('selah-dashboard-layout')).toBeNull()
        expect(localStorage.getItem('selah-dashboard-preset')).toBeNull()
        expect(localStorage.getItem('selah-dashboard-edit-locked')).toBeNull()
    })
})
