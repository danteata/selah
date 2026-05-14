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