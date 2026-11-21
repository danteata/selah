/* eslint-disable react-refresh/only-export-components */
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from 'react'
import { useSermonListener, type UseSermonListenerReturn } from '../../hooks/useSermonListener'
import { useAppStore } from '../../store/appStore'

const SermonListenerContext = createContext<UseSermonListenerReturn | null>(null)

/** Whether the sermon listener is on for this app: null while the flag is still being read. */
const SermonListenerEnabledContext = createContext<boolean | null>(null)

/**
 * The app's one sermon listener, for every panel, indicator and control —
 * when the `sermon_listener` flag is on.
 *
 * The flag is an off switch: when it is off there is no listener at all —
 * no engine, no tray toggle, nothing for a panel to show. (It used to only
 * hide the listener from everything but the panels, which then each made a
 * listener of their own on the one microphone.)
 *
 * The tree under this provider is the same whatever the flag says, so the
 * flag answering doesn't remount the workspace beneath it.
 */
export function SermonListenerProvider({ children }: { children: ReactNode }) {
    const enabled = useSermonListenerFlag()
    const [listener, setListener] = useState<UseSermonListenerReturn | null>(null)

    return (
        <SermonListenerEnabledContext.Provider value={enabled}>
            <SermonListenerContext.Provider value={enabled ? listener : null}>
                {enabled && <SermonListenerHost onChange={setListener} />}
                {children}
            </SermonListenerContext.Provider>
        </SermonListenerEnabledContext.Provider>
    )
}

function useSermonListenerFlag(): boolean | null {
    const [enabled, setEnabled] = useState<boolean | null>(null)
    useEffect(() => {
        let cancelled = false
        const check = async () => {
            try {
                const { featureFlags } = await import('../../services/feature-flags')
                const on = await featureFlags.isEnabled('sermon_listener', true)
                if (!cancelled) setEnabled(on)
            } catch {
                // An unreadable flag leaves the listener on, as its default does.
                if (!cancelled) setEnabled(true)
            }
        }
        void check()
        return () => {
            cancelled = true
        }
    }, [])
    return enabled
}

/**
 * Runs the listener, and hands it up to the provider. Mounted only while the
 * flag is on. Memoised: its one prop is a state setter, so it re-renders only
 * when the listener changes — re-rendering with the provider would hand up a
 * new object every time, and loop.
 */
const SermonListenerHost = memo(function SermonListenerHost({ onChange }: { onChange: (listener: UseSermonListenerReturn | null) => void }) {
    const enableVoiceCommands = useAppStore(
        (s) => s.settings.sermonListener?.enableVoiceCommands ?? true,
    )

    const sermonListener = useSermonListener({
        autoLookup: true,
        enableSemanticDetection: true,
        enableVoiceCommands,
    })

    useEffect(() => {
        onChange(sermonListener)
    }, [sermonListener, onChange])
    useEffect(() => () => onChange(null), [onChange])

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

    return null
})

export function useSermonListenerContext(): UseSermonListenerReturn | null {
    return useContext(SermonListenerContext)
}

/** False when the sermon listener is turned off for this app; null while that is still being read. */
export function useSermonListenerEnabled(): boolean | null {
    return useContext(SermonListenerEnabledContext)
}

export { SermonListenerContext }
