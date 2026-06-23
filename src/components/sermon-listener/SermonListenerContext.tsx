/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useSermonListener, type UseSermonListenerReturn } from '../../hooks/useSermonListener'

const SermonListenerContext = createContext<UseSermonListenerReturn | null>(null)

export function SermonListenerProvider({ children }: { children: ReactNode }) {
    const [isEnabled, setIsEnabled] = useState(false)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        const check = async () => {
            try {
                const { featureFlags } = await import('../../services/feature-flags')
                const enabled = await featureFlags.isEnabled('sermon_listener', true)
                setIsEnabled(enabled)
            } catch {
                setIsEnabled(true)
            } finally {
                setIsLoading(false)
            }
        }
        check()
    }, [])

    const sermonListener = useSermonListener({
        autoLookup: true,
        enableSemanticDetection: true,
        enableVoiceCommands: true,
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

    if (isLoading) {
        return <>{children}</>
    }

    if (!isEnabled) {
        return <>{children}</>
    }

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