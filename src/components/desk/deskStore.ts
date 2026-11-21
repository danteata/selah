import { create } from 'zustand'
import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { DESK_PANELS, isDeskPanelId, type DeskPanelId } from './deskPanels'
import { BUILT_IN_LAYOUTS, panelOptions } from './deskLayouts'
import { layoutSignature, sameArrangement } from './layoutSignature'
import { saveDeskLayout } from './layoutStorage'
import {
    checkLayoutName,
    loadLoadedLayout,
    loadSavedLayouts,
    writeLoadedLayout,
    writeSavedLayouts,
    type BuiltInLayoutId,
    type LoadedLayout,
    type SavedLayout,
} from './savedLayouts'

interface DeskState {
    /** Edit layout mode: panels can be moved, closed and added. Splitters
     *  resize in either mode. Never persisted: every start is locked. */
    editing: boolean
    /** Panels currently in the layout. */
    openPanels: DeskPanelId[]
    savedLayouts: SavedLayout[]
    /** The layout last loaded, or null when the arrangement isn't one (its
     *  saved layout was deleted, or it predates saved layouts). */
    loaded: LoadedLayout | null
    /** The arrangement has changed since `loaded` was loaded or saved. */
    modified: boolean
    setEditing: (editing: boolean) => void
    setOpenPanels: (ids: DeskPanelId[]) => void
}

export const useDeskStore = create<DeskState>((set) => ({
    editing: false,
    openPanels: [],
    savedLayouts: [],
    loaded: null,
    modified: false,
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

/**
 * Bring a freshly loaded arrangement in line with this version: each
 * panel's renderer as the registry has it, and Live present whatever was
 * saved.
 */
export function normalizeDeskPanels(api: DockviewApi): void {
    for (const panel of api.panels) {
        if (!isDeskPanelId(panel.id)) continue
        panel.api.setRenderer(panelOptions(DESK_PANELS[panel.id]).renderer ?? 'onlyWhenVisible')
    }
    if (!api.getPanel('live')) {
        api.addPanel({ ...panelOptions(DESK_PANELS.live), position: { direction: 'right' } })
    }
}

// dockview settles sizes after a layout is built or loaded, so the shape
// recorded at that moment can differ a little from the one that ends up on
// screen. A settled change shortly after building or loading takes the
// record's place; after that window, changes are the operator's.
const SETTLE_WINDOW_MS = 1500
let settleUntil = 0

function markLoaded(ref: LoadedLayout | null, { justBuilt = false } = {}): void {
    writeLoadedLayout(ref)
    settleUntil = justBuilt && ref ? Date.now() + SETTLE_WINDOW_MS : 0
    useDeskStore.setState({ loaded: ref, modified: false })
    // Keep the autosave in step, so a restart restores this arrangement and
    // the record of which layout it is agrees with it.
    if (deskApi) saveDeskLayout(deskApi.toJSON())
}

function currentSignature(): string | null {
    return deskApi ? layoutSignature(deskApi.toJSON()) : null
}

/** After the arrangement changes: has it drifted from what was loaded? */
export function refreshModified(): void {
    const { loaded } = useDeskStore.getState()
    const signature = currentSignature()
    // Only proportions may settle; a moved, closed or added panel is the
    // operator's change, however soon after loading.
    if (Date.now() < settleUntil && loaded && signature && sameArrangement(signature, loaded.signature)) {
        settleUntil = 0
        writeLoadedLayout({ ...loaded, signature })
        useDeskStore.setState({ loaded: { ...loaded, signature }, modified: false })
        return
    }
    const modified = !!loaded && signature !== null && signature !== loaded.signature
    if (modified !== useDeskStore.getState().modified) useDeskStore.setState({ modified })
}

/** Read saved layouts and the loaded-layout record when the desk mounts. */
export function initLayouts(builtDefault: boolean): void {
    const savedLayouts = loadSavedLayouts()
    let loaded = loadLoadedLayout()
    if (loaded?.kind === 'saved' && !savedLayouts.some((l) => l.id === loaded!.id)) loaded = null
    useDeskStore.setState({ savedLayouts })
    if (builtDefault) {
        // Nothing to restore: the desk has just built Default.
        const signature = currentSignature()
        markLoaded(signature ? { kind: 'builtin', id: 'default', signature } : null, { justBuilt: true })
        return
    }
    useDeskStore.setState({ loaded })
    refreshModified()
}

export function applyBuiltInLayout(id: BuiltInLayoutId): void {
    const api = deskApi
    if (!api) return
    BUILT_IN_LAYOUTS[id].build(api)
    markLoaded({ kind: 'builtin', id, signature: layoutSignature(api.toJSON()) }, { justBuilt: true })
}

export function resetDeskLayout(): void {
    applyBuiltInLayout('default')
}

export function applySavedLayout(id: string): boolean {
    const api = deskApi
    const saved = useDeskStore.getState().savedLayouts.find((l) => l.id === id)
    if (!api || !saved) return false
    try {
        api.fromJSON(saved.layout)
    } catch (err) {
        console.warn('[desk] saved layout failed to load', err)
        return false
    }
    normalizeDeskPanels(api)
    markLoaded({ kind: 'saved', id, signature: layoutSignature(api.toJSON()) }, { justBuilt: true })
    return true
}

function storeSavedLayouts(list: SavedLayout[]): void {
    writeSavedLayouts(list)
    useDeskStore.setState({ savedLayouts: list })
}

/** Save over the loaded saved layout. Built-in layouts can't be overwritten. */
export function saveLayout(): boolean {
    const api = deskApi
    const { loaded, savedLayouts } = useDeskStore.getState()
    if (!api || loaded?.kind !== 'saved') return false
    const layout: SerializedDockview = api.toJSON()
    storeSavedLayouts(savedLayouts.map((l) => (l.id === loaded.id ? { ...l, layout, savedAt: Date.now() } : l)))
    markLoaded({ kind: 'saved', id: loaded.id, signature: layoutSignature(layout) })
    return true
}

/** Keep the current arrangement under a new name. Returns an error to show, or null. */
export function saveLayoutAs(name: string): string | null {
    const api = deskApi
    if (!api) return 'The desk isn’t open.'
    const { savedLayouts } = useDeskStore.getState()
    const checked = checkLayoutName(name, savedLayouts)
    if ('error' in checked) return checked.error
    const layout: SerializedDockview = api.toJSON()
    const entry: SavedLayout = { id: newLayoutId(), name: checked.name, layout, savedAt: Date.now() }
    storeSavedLayouts([...savedLayouts, entry])
    markLoaded({ kind: 'saved', id: entry.id, signature: layoutSignature(layout) })
    return null
}

export function renameSavedLayout(id: string, name: string): string | null {
    const { savedLayouts } = useDeskStore.getState()
    const checked = checkLayoutName(name, savedLayouts, id)
    if ('error' in checked) return checked.error
    storeSavedLayouts(savedLayouts.map((l) => (l.id === id ? { ...l, name: checked.name } : l)))
    return null
}

/** Delete a saved layout. The desk keeps its arrangement either way. */
export function deleteSavedLayout(id: string): void {
    const { savedLayouts, loaded } = useDeskStore.getState()
    storeSavedLayouts(savedLayouts.filter((l) => l.id !== id))
    if (loaded?.kind === 'saved' && loaded.id === id) markLoaded(null)
}

/** The loaded layout's name, for the menu button. */
export function loadedLayoutName(loaded: LoadedLayout | null, savedLayouts: SavedLayout[]): string | null {
    if (!loaded) return null
    if (loaded.kind === 'builtin') return BUILT_IN_LAYOUTS[loaded.id].name
    return savedLayouts.find((l) => l.id === loaded.id)?.name ?? null
}

function newLayoutId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
