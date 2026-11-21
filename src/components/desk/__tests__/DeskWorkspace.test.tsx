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
import { getDeskApi, hideDeskPanel, resetDeskLayout, showDeskPanel, useDeskStore } from '../deskStore'
import { DESK_LAYOUT_KEY } from '../layoutStorage'

function openIds() {
    return (getDeskApi()?.panels ?? []).map((p) => p.id).sort()
}

const DEFAULT_PANELS = ['alerts', 'bible', 'countdown', 'dictionary', 'live', 'media', 'music', 'preview', 'serviceOrder', 'sermon', 'templates'].sort()

describe('DeskWorkspace', () => {
    beforeEach(() => {
        localStorage.clear()
        useAppStore.getState().signOut()
        useDeskStore.setState({ editing: false, openPanels: [] })
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
})
