import type { SerializedDockview } from 'dockview-react'
import { isShowableLayout } from './layoutStorage'

export type BuiltInLayoutId = 'default' | 'classic'

/** A layout the operator kept under a name (GLOSSARY.md: saved layout). */
export interface SavedLayout {
    id: string
    name: string
    layout: SerializedDockview
    savedAt: number
}

/** Which layout the desk last loaded, and what it looked like then, so the
 *  menu can say when the arrangement has drifted from it. */
export type LoadedLayout =
    | { kind: 'builtin'; id: BuiltInLayoutId; signature: string }
    | { kind: 'saved'; id: string; signature: string }

const SAVED_KEY = 'selah-desk-saved-layouts-v1'
const LOADED_KEY = 'selah-desk-loaded-layout-v1'

export const MAX_LAYOUT_NAME = 40

function read(key: string): unknown {
    try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function write(key: string, value: unknown): void {
    try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
        console.warn('[desk] could not store', key, err)
    }
}

/** Saved layouts this version can show; any others are skipped. */
export function loadSavedLayouts(): SavedLayout[] {
    const list = read(SAVED_KEY)
    if (!Array.isArray(list)) return []
    return list.filter((item): item is SavedLayout =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string' && isShowableLayout(item.layout))
}

export function writeSavedLayouts(list: SavedLayout[]): void {
    write(SAVED_KEY, list)
}

export function loadLoadedLayout(): LoadedLayout | null {
    const ref = read(LOADED_KEY) as LoadedLayout | null
    if (!ref || typeof ref.signature !== 'string') return null
    if (ref.kind === 'builtin' && (ref.id === 'default' || ref.id === 'classic')) return ref
    if (ref.kind === 'saved' && typeof ref.id === 'string') return ref
    return null
}

export function writeLoadedLayout(ref: LoadedLayout | null): void {
    write(LOADED_KEY, ref)
}

/** A trimmed name, or why it can't be used. */
export function checkLayoutName(name: string, existing: SavedLayout[], exceptId?: string): { name: string } | { error: string } {
    const trimmed = name.trim().replace(/\s+/g, ' ')
    if (!trimmed) return { error: 'Give the layout a name.' }
    if (trimmed.length > MAX_LAYOUT_NAME) return { error: `Keep it under ${MAX_LAYOUT_NAME} characters.` }
    const lower = trimmed.toLowerCase()
    if (lower === 'default' || lower === 'classic') return { error: 'That name belongs to a built-in layout.' }
    if (existing.some((l) => l.id !== exceptId && l.name.toLowerCase() === lower)) {
        return { error: 'You already have a layout with that name.' }
    }
    return { name: trimmed }
}
