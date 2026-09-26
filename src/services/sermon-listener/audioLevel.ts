import { useSyncExternalStore } from 'react'

/**
 * The live input level, 0–1, outside React state.
 *
 * It updates on every animation frame (and every native `audio-features`
 * event). Held in the sermon listener hook's state, each update re-rendered the
 * whole context — the nav rail, status bar, dashboard layout, panel and the
 * full transcript list — about sixty times a second for the length of a
 * service. Now only the meter that draws it subscribes.
 */
let level = 0
const listeners = new Set<() => void>()

export const audioLevel = {
    get: () => level,
    set(next: number) {
        if (next === level) return
        level = next
        listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
    },
}

export function useAudioLevel(): number {
    return useSyncExternalStore(audioLevel.subscribe, audioLevel.get, audioLevel.get)
}
