/**
 * React hook for NDI output
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ndiOutputService, type NdiOutputState, type NdiOutputConfig, type NdiSourceInfo } from '../services/ndi-output'

/**
 * Code the backend prefixes onto the "live output window isn't open" refusal, so
 * the UI can offer to open it instead of only reporting it. Must match
 * LIVE_WINDOW_MISSING_CODE in src-tauri/src/ndi_output/commands.rs.
 */
export const NDI_LIVE_WINDOW_MISSING = 'live-window-missing'

export interface NdiStartRefusal {
    /** `live-window-missing` has a one-click remedy; anything else is advice. */
    code: typeof NDI_LIVE_WINDOW_MISSING | 'unknown'
    /** Operator-facing text, with any code prefix removed. */
    message: string
}

function parseRefusal(error: unknown): NdiStartRefusal {
    const raw = error instanceof Error ? error.message : String(error)
    const prefix = `${NDI_LIVE_WINDOW_MISSING}: `
    return raw.startsWith(prefix)
        ? { code: NDI_LIVE_WINDOW_MISSING, message: raw.slice(prefix.length) }
        : { code: 'unknown', message: raw }
}

interface UseNdiOutputReturn {
    /** NDI runtime found and initialised. */
    isAvailable: boolean
    /** This build has NDI compiled in (the `ndi` Cargo feature). */
    isSupported: boolean
    isRunning: boolean
    state: NdiOutputState | null
    sources: NdiSourceInfo[]
    isLoading: boolean
    /** Resolves with null on success, or why it refused. */
    startOutput: (config?: Partial<NdiOutputConfig>) => Promise<NdiStartRefusal | null>
    stopOutput: () => Promise<void>
    refreshState: () => Promise<void>
    discoverSources: () => Promise<void>
}

export function useNdiOutput(): UseNdiOutputReturn {
    const [isAvailable, setIsAvailable] = useState(false)
    const [isSupported, setIsSupported] = useState(false)
    const [state, setState] = useState<NdiOutputState | null>(null)
    const [sources, setSources] = useState<NdiSourceInfo[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const init = async () => {
            const [available, supported] = await Promise.all([
                ndiOutputService.isAvailable(),
                ndiOutputService.isSupported(),
            ])
            setIsAvailable(available)
            setIsSupported(supported)
            if (available) {
                const s = await ndiOutputService.getState()
                setState(s)
            }
        }
        init()
    }, [])

    useEffect(() => {
        if (!isAvailable) return

        pollRef.current = setInterval(async () => {
            const s = await ndiOutputService.getState()
            setState(s)
        }, 2000)

        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [isAvailable])

    const refreshState = useCallback(async () => {
        const s = await ndiOutputService.getState()
        setState(s)
    }, [])

    /**
     * Start NDI output. Returns null on success, or the reason it refused —
     * "the live output window isn't open", "grant Screen Recording", "this
     * Windows is too old". Those are all things the operator can act on, so this
     * resolves with the message instead of rejecting: a rejection meant every
     * caller had to remember a `.catch`, and the one that didn't turned the most
     * useful message in the feature into an uncaught promise error in the
     * console, where no operator would ever see it.
     */
    const startOutput = useCallback(async (config?: Partial<NdiOutputConfig>): Promise<NdiStartRefusal | null> => {
        setIsLoading(true)
        try {
            await ndiOutputService.startOutput(config)
            await refreshState()
            return null
        } catch (error) {
            const refusal = parseRefusal(error)
            setState((previous) => previous ? { ...previous, error: refusal.message } : previous)
            return refusal
        } finally {
            setIsLoading(false)
        }
    }, [refreshState])

    const stopOutput = useCallback(async () => {
        setIsLoading(true)
        try {
            await ndiOutputService.stopOutput()
            await refreshState()
        } finally {
            setIsLoading(false)
        }
    }, [refreshState])

    const discoverSources = useCallback(async () => {
        setIsLoading(true)
        try {
            const found = await ndiOutputService.discoverSources()
            setSources(found)
        } finally {
            setIsLoading(false)
        }
    }, [])

    return {
        isAvailable,
        isSupported,
        isRunning: state?.isRunning ?? false,
        state,
        sources,
        isLoading,
        startOutput,
        stopOutput,
        refreshState,
        discoverSources,
    }
}