import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { useAppStore } from '../../../store/appStore'

vi.mock('../../preview/PreviewContent', () => ({ PreviewContent: () => <div>service order</div> }))
vi.mock('../../live/LivePanel', () => ({ LivePanel: () => <div>live</div> }))
vi.mock('../../live/PreviewPanel', () => ({ PreviewPanel: () => <div>preview</div> }))
vi.mock('../../layout/ContextPanel', () => ({ ContextSectionContent: ({ section }: { section: string }) => <div>{section}</div> }))
vi.mock('../../layout/MobileStudioWorkspace', () => ({ MobileStudioWorkspace: () => <div>mobile</div> }))
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('dockview-react/dist/styles/dockview.css', () => ({}))
vi.mock('../desk.css', () => ({}))

import { DeskWorkspace } from '../DeskWorkspace'
import {
    applyBuiltInLayout, applySavedLayout, deleteSavedLayout, getDeskApi, hideDeskPanel, renameSavedLayout,
    resetDeskLayout, saveLayout, saveLayoutAs, showDeskPanel, useDeskStore,
} from '../deskStore'
import { DESK_LAYOUT_KEY } from '../layoutStorage'

function openIds() {
    return (getDeskApi()?.panels ?? []).map((p) => p.id).sort()
}

const DEFAULT_PANELS = ['alerts', 'bible', 'countdown', 'dictionary', 'live', 'media', 'music', 'preview', 'serviceOrder', 'sermon', 'templates'].sort()

describe('DeskWorkspace', () => {
    beforeEach(() => {
        localStorage.clear()
        useAppStore.getState().signOut()
        useDeskStore.setState({ editing: false, openPanels: [], savedLayouts: [], loaded: null, modified: false })
    })
    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    it('starts on the default layout, with every panel', () => {
        render(<DeskWorkspace />)
        expect(openIds()).toEqual(DEFAULT_PANELS)
        expect(useDeskStore.getState().openPanels.slice().sort()).toEqual(DEFAULT_PANELS)
    })

    it('keeps hold of the desk under StrictMode', () => {
        // Development mounts effects twice; onReady fires only once.
        render(<StrictMode><DeskWorkspace /></StrictMode>)
        expect(getDeskApi()).not.toBeNull()
        act(() => hideDeskPanel('dictionary'))
        expect(openIds()).not.toContain('dictionary')
    })

    it('flags the dock while a tab is dragged, so the edge drop zones see it', () => {
        const { container } = render(<DeskWorkspace />)
        const dock = container.querySelector('.desk-dock') as HTMLElement
        const tab = container.querySelector('.dv-tab') as HTMLElement
        act(() => { tab.dispatchEvent(new Event('dragstart', { bubbles: true })) })
        expect(dock.dataset.dragging).toBe('true')
        act(() => { tab.dispatchEvent(new Event('dragend', { bubbles: true })) })
        expect(dock.dataset.dragging).toBeUndefined()
        // A drag from inside a panel's content isn't a panel drag.
        const content = container.querySelector('.desk-panel') as HTMLElement
        act(() => { content.dispatchEvent(new Event('dragstart', { bubbles: true })) })
        expect(dock.dataset.dragging).toBeUndefined()
    })

    it('never closes Live', () => {
        render(<DeskWorkspace />)
        act(() => hideDeskPanel('live'))
        expect(openIds()).toContain('live')
    })

    it('puts a closed panel back when asked to show it', () => {
        render(<DeskWorkspace />)
        act(() => hideDeskPanel('dictionary'))
        expect(openIds()).not.toContain('dictionary')
        act(() => { showDeskPanel('dictionary') })
        expect(openIds()).toContain('dictionary')
        // Back in the tab stack it came from.
        expect(getDeskApi()?.getPanel('dictionary')?.api.group.id).toBe(getDeskApi()?.getPanel('bible')?.api.group.id)
    })

    it('shows the panel for a section the NavRail asks for', () => {
        render(<DeskWorkspace />)
        act(() => hideDeskPanel('media'))
        act(() => useAppStore.getState().setActiveNavSection('media'))
        expect(getDeskApi()?.getPanel('media')?.api.isActive).toBe(true)
    })

    it('saves the arrangement and restores it next time', async () => {
        vi.useFakeTimers()
        const first = render(<DeskWorkspace />)
        // dockview reports layout changes on a microtask; the save follows on a timer.
        await act(async () => { hideDeskPanel('templates') })
        act(() => { vi.advanceTimersByTime(1000) })
        expect(localStorage.getItem(DESK_LAYOUT_KEY)).toBeTruthy()
        first.unmount()

        render(<DeskWorkspace />)
        expect(openIds()).toEqual(DEFAULT_PANELS.filter((id) => id !== 'templates'))
    })

    it('resets to the default layout', () => {
        render(<DeskWorkspace />)
        act(() => hideDeskPanel('alerts'))
        act(() => resetDeskLayout())
        expect(openIds()).toEqual(DEFAULT_PANELS)
    })

    it('offers close buttons only while editing, and never on Live', () => {
        const { container } = render(<DeskWorkspace />)
        const closeButtons = () => Array.from(container.querySelectorAll('.dv-default-tab'))
            .filter((tab) => tab.querySelector('.dv-default-tab-action'))
            .map((tab) => tab.querySelector('.dv-default-tab-content')?.textContent)
        expect(closeButtons()).toEqual([])
        act(() => useDeskStore.getState().setEditing(true))
        expect(closeButtons()).toHaveLength(DEFAULT_PANELS.length - 1)
        expect(closeButtons()).not.toContain('Live')
    })

    it('shows the Edit layout bar only while editing', () => {
        render(<DeskWorkspace />)
        expect(screen.queryByText(/editing layout/i)).toBeNull()
        act(() => useDeskStore.getState().setEditing(true))
        expect(screen.getByText(/editing layout/i)).toBeTruthy()
        act(() => screen.getByRole('button', { name: 'Done' }).click())
        expect(useDeskStore.getState().editing).toBe(false)
    })

    describe('layouts', () => {
        // dockview reports layout changes on a microtask; the desk then
        // checks for changes on a timer.
        async function settle() {
            await act(async () => { await Promise.resolve() })
            act(() => { vi.advanceTimersByTime(1000) })
        }
        const groupOf = (id: string) => getDeskApi()?.getPanel(id)?.api.group.id

        beforeEach(() => vi.useFakeTimers())

        it('starts with Default loaded and unchanged', async () => {
            render(<DeskWorkspace />)
            await settle()
            expect(useDeskStore.getState().loaded).toMatchObject({ kind: 'builtin', id: 'default' })
            expect(useDeskStore.getState().modified).toBe(false)
        })

        it('builds Classic: the library and sermon stacked in one tab strip, apart from Preview and Live', async () => {
            render(<DeskWorkspace />)
            act(() => applyBuiltInLayout('classic'))
            await settle()
            expect(openIds()).toEqual(DEFAULT_PANELS)
            const library = groupOf('bible')
            for (const id of ['music', 'media', 'sermon', 'dictionary', 'templates', 'countdown', 'alerts']) {
                expect(groupOf(id)).toBe(library)
            }
            const separate = new Set([groupOf('serviceOrder'), groupOf('preview'), groupOf('live'), library])
            expect(separate.size).toBe(4)
            expect(useDeskStore.getState().loaded).toMatchObject({ kind: 'builtin', id: 'classic' })
        })

        it('marks a change as modified, and a built-in can only be saved as a copy', async () => {
            render(<DeskWorkspace />)
            await settle()
            await act(async () => { hideDeskPanel('templates') })
            await settle()
            expect(useDeskStore.getState().modified).toBe(true)
            expect(saveLayout()).toBe(false)

            let error: string | null = 'unset'
            act(() => { error = saveLayoutAs('Sunday') })
            expect(error).toBeNull()
            expect(useDeskStore.getState().savedLayouts.map((l) => l.name)).toEqual(['Sunday'])
            expect(useDeskStore.getState().loaded?.kind).toBe('saved')
            expect(useDeskStore.getState().modified).toBe(false)
        })

        it('saves over a saved layout, and switches back to it', async () => {
            render(<DeskWorkspace />)
            await settle()
            act(() => { saveLayoutAs('Sunday') })
            const id = useDeskStore.getState().savedLayouts[0].id
            await settle()
            await act(async () => { hideDeskPanel('alerts') })
            await settle()
            expect(useDeskStore.getState().modified).toBe(true)
            act(() => { saveLayout() })
            expect(useDeskStore.getState().modified).toBe(false)

            act(() => applyBuiltInLayout('classic'))
            expect(openIds()).toContain('alerts')
            act(() => { applySavedLayout(id) })
            expect(openIds()).not.toContain('alerts')
            expect(useDeskStore.getState().loaded).toMatchObject({ kind: 'saved', id })
        })

        it('remembers saved layouts and which was loaded across restarts', async () => {
            const first = render(<DeskWorkspace />)
            await settle()
            act(() => { saveLayoutAs('Evening') })
            await settle()
            first.unmount()
            useDeskStore.setState({ savedLayouts: [], loaded: null })

            render(<DeskWorkspace />)
            await settle()
            expect(useDeskStore.getState().savedLayouts.map((l) => l.name)).toEqual(['Evening'])
            expect(useDeskStore.getState().loaded?.kind).toBe('saved')
            expect(useDeskStore.getState().modified).toBe(false)
        })

        it('renames, and deleting the loaded layout leaves the desk as it is', async () => {
            render(<DeskWorkspace />)
            await settle()
            act(() => { saveLayoutAs('Morning') })
            const id = useDeskStore.getState().savedLayouts[0].id
            act(() => { renameSavedLayout(id, 'Early') })
            expect(useDeskStore.getState().savedLayouts[0].name).toBe('Early')
            const before = openIds()
            act(() => deleteSavedLayout(id))
            expect(useDeskStore.getState().savedLayouts).toEqual([])
            expect(useDeskStore.getState().loaded).toBeNull()
            expect(openIds()).toEqual(before)
        })

        it('refuses a duplicate name', async () => {
            render(<DeskWorkspace />)
            await settle()
            act(() => { saveLayoutAs('Sunday') })
            let error: string | null = null
            act(() => { error = saveLayoutAs('sunday') })
            expect(error).toMatch(/already/)
            expect(useDeskStore.getState().savedLayouts).toHaveLength(1)
        })
    })
})
