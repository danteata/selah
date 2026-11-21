import type { SerializedDockview } from 'dockview-react'
import { isDeskPanelId } from './deskPanels'

/** This device's current desk arrangement. Versioned so a future shape change
 *  can start fresh instead of misreading an old one. */
export const DESK_LAYOUT_KEY = 'selah-desk-layout-v1'

/** The Dashboard grid's keys. Its coordinates don't map onto docked panels,
 *  so they are dropped, not translated. */
const RETIRED_KEYS = ['selah-dashboard-layout', 'selah-dashboard-preset', 'selah-dashboard-edit-locked']

/**
 * The saved arrangement, or null when there is none, it can't be read, or it
 * isn't one this version can show: it must name only panels that exist, and
 * must include Live.
 */
export function loadDeskLayout(): SerializedDockview | null {
    let raw: string | null = null
    try {
        raw = localStorage.getItem(DESK_LAYOUT_KEY)
    } catch {
        return null
    }
    if (!raw) return null
    try {
        const layout = JSON.parse(raw) as SerializedDockview
        if (!isShowableLayout(layout)) {
            console.warn('[desk] saved layout names panels this version lacks, or no Live; using the default')
            return null
        }
        return layout
    } catch (err) {
        console.warn('[desk] saved layout unreadable; using the default', err)
        return null
    }
}

/** A layout this version can show: only panels that exist, Live among them. */
export function isShowableLayout(layout: SerializedDockview | null | undefined): layout is SerializedDockview {
    const ids = Object.keys(layout?.panels ?? {})
    return !!layout?.grid && ids.length > 0 && ids.every(isDeskPanelId) && ids.includes('live')
}

/** Best effort: storage can be full, blocked or missing (private windows). */
export function saveDeskLayout(layout: SerializedDockview): void {
    try {
        localStorage.setItem(DESK_LAYOUT_KEY, JSON.stringify(layout))
    } catch (err) {
        console.warn('[desk] layout not saved', err)
    }
}

export function clearDeskLayout(): void {
    try {
        localStorage.removeItem(DESK_LAYOUT_KEY)
    } catch {
        // Nothing to clear when storage is unavailable.
    }
}

export function removeRetiredLayoutKeys(): void {
    for (const key of RETIRED_KEYS) {
        try {
            localStorage.removeItem(key)
        } catch {
            return
        }
    }
}
