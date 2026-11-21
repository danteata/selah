import { create } from 'zustand'
import type { DockviewApi } from 'dockview-react'
import { DESK_PANELS, type DeskPanelId } from './deskPanels'
import { buildDefaultLayout, panelOptions } from './deskLayouts'

interface DeskState {
    /** Edit layout mode: panels can be moved, closed and added. Splitters
     *  resize in either mode. Never persisted: every start is locked. */
    editing: boolean
    /** Panels currently in the layout. */
    openPanels: DeskPanelId[]
    setEditing: (editing: boolean) => void
    setOpenPanels: (ids: DeskPanelId[]) => void
}

export const useDeskStore = create<DeskState>((set) => ({
    editing: false,
    openPanels: [],
    setEditing: (editing) => set({ editing }),
    setOpenPanels: (ids) => set({ openPanels: ids }),
}))

// The mounted desk's dockview, for the menu, the NavRail and the shortcuts
// that drive it from outside. Null while the desk isn't on screen.
let deskApi: DockviewApi | null = null
// Where each closed panel last sat, so reopening puts it back there.
const lastGroupOf = new Map<DeskPanelId, string>()

export function attachDeskApi(api: DockviewApi | null): void {
    deskApi = api
}

export function getDeskApi(): DockviewApi | null {
    return deskApi
}

export function rememberPanelGroup(id: DeskPanelId, groupId: string): void {
    lastGroupOf.set(id, groupId)
}

/**
 * Bring a panel into view: forward in its tab stack if it's open, or back
 * where it last was if it was closed (else beside Live). Returns false when
 * no desk is mounted.
 */
export function showDeskPanel(id: DeskPanelId): boolean {
    const api = deskApi
    if (!api) return false
    const existing = api.getPanel(id)
    if (existing) {
        existing.api.setActive()
        return true
    }
    const groupId = lastGroupOf.get(id)
    const group = groupId ? api.groups.find((g) => g.id === groupId) : undefined
    const live = api.getPanel('live')
    api.addPanel({
        ...panelOptions(DESK_PANELS[id]),
        position: group
            ? { referenceGroup: group, direction: 'within' }
            : live
                ? { referencePanel: live, direction: 'right' }
                : { direction: 'right' },
    })
    return true
}

/** Close a panel. Live can't be closed. */
export function hideDeskPanel(id: DeskPanelId): void {
    if (!DESK_PANELS[id].closable) return
    deskApi?.getPanel(id)?.api.close()
}

export function resetDeskLayout(): void {
    if (deskApi) buildDefaultLayout(deskApi)
}
