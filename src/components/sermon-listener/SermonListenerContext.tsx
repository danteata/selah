/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useSermonListener, type UseSermonListenerReturn } from '../../hooks/useSermonListener'
import { useAppStore } from '../../store/appStore'

const SermonListenerContext = createContext<UseSermonListenerReturn | null>(null)

/**
 * The app's one sermon listener, for every panel, indicator and control.
 *
 * It used to be withheld while the `sermon_listener` flag loaded, or when it
 * was off — and every panel then made a listener of its own, all sharing one
 * microphone and one engine. The flag never turned the listener off; it only
 * hid it from everything but the panels. Now there is exactly one.
 */
export function SermonListenerProvider({ children }: { children: ReactNode }) {
    const enableVoiceCommands = useAppStore(
        (s) => s.settings.sermonListener?.enableVoiceCommands ?? true,
    )

    const sermonListener = useSermonListener({
        autoLookup: true,
        enableSemanticDetection: true,
        enableVoiceCommands,
    })

    // Let the desktop system tray toggle listening. The tray (Rust) emits
    // `tray://toggle-listening`; we start/stop based on the current state.
    const { isListening, start, stop } = sermonListener
    useEffect(() => {
        if (typeof window === 'undefined' || !('__TAURI__' in window)) return
        let unlisten: (() => void) | undefined
        let cancelled = false
        import('@tauri-apps/api/event')
            .then(({ listen }) => listen('tray://toggle-listening', () => {
                if (isListening) stop()
                else void start()
            }))
            .then((fn) => {
                if (cancelled) fn()
                else unlisten = fn
            })
            .catch(() => { /* not in Tauri / event API unavailable */ })
        return () => {
            cancelled = true
            unlisten?.()
        }
    }, [isListening, start, stop])

    return (
        <SermonListenerContext.Provider value={sermonListener}>
            {children}
        </SermonListenerContext.Provider>
    )
}

export function useSermonListenerContext(): UseSermonListenerReturn | null {
    return useContext(SermonListenerContext)
}

export { SermonListenerContext }