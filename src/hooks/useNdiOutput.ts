/**
 * React hook for NDI output
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ndiOutputService, type NdiOutputState, type NdiOutputConfig, type NdiSourceInfo } from '../services/ndi-output'

interface UseNdiOutputReturn {
    isAvailable: boolean
    isRunning: boolean
    state: NdiOutputState | null
    sources: NdiSourceInfo[]
    isLoading: boolean
    startOutput: (config?: Partial<NdiOutputConfig>) => Promise<void>
    stopOutput: () => Promise<void>
    refreshState: () => Promise<void>
    discoverSources: () => Promise<void>
}

export function useNdiOutput(): UseNdiOutputReturn {
    const [isAvailable, setIsAvailable] = useState(false)
    const [state, setState] = useState<NdiOutputState | null>(null)
    const [sources, setSources] = useState<NdiSourceInfo[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const init = async () => {
            const available = await ndiOutputService.isAvailable()
            setIsAvailable(available)
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

    const startOutput = useCallback(async (config?: Partial<NdiOutputConfig>) => {
        setIsLoading(true)
        try {
            await ndiOutputService.startOutput(config)
            await refreshState()
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