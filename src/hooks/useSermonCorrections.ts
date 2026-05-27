import { useState, useEffect, useCallback, useRef } from 'react'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import {
    type LocalSermonCorrection,
    saveSermonCorrection,
    getSermonCorrections,
    getUnsyncedCorrections,
    markCorrectionSynced,
    deleteSermonCorrection,
} from './useIndexedDB'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

export interface SermonCorrection {
    id: string
    reference: string
    originalReference?: string
    correctionType: 'missed' | 'wrong-verse' | 'wrong-book'
    closestRawText?: string
    timestamp: number
}

export function useSermonCorrections(sessionId?: string) {
    const { isOffline } = useConvexConnection()
    const [corrections, setCorrections] = useState<SermonCorrection[]>([])
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle')
    const [unsyncCount, setUnsyncCount] = useState(0)
    const syncingRef = useRef(false)

    const addCorrectionMutation = useMutation(api.sermonLearning.addCorrection)

    const loadCorrections = useCallback(async () => {
        const stored = await getSermonCorrections(sessionId)
        setCorrections(stored.map(c => ({
            id: c.id,
            reference: c.reference,
            originalReference: c.originalReference,
            correctionType: c.correctionType,
            closestRawText: c.closestRawText,
            timestamp: c.timestamp,
        })))
        const unsynced = await getUnsyncedCorrections()
        setUnsyncCount(unsynced.length)
    }, [sessionId])

    useEffect(() => {
        loadCorrections()
    }, [loadCorrections])

    const addCorrection = useCallback(async (
        reference: string,
        options?: {
            originalReference?: string
            correctionType?: 'missed' | 'wrong-verse' | 'wrong-book'
            closestRawText?: string
        },
    ) => {
        const id = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const correction: LocalSermonCorrection = {
            id,
            sermonSessionId: sessionId,
            reference,
            originalReference: options?.originalReference,
            correctionType: options?.correctionType || 'missed',
            closestRawText: options?.closestRawText,
            timestamp: Date.now(),
            synced: false,
            createdAt: new Date().toISOString(),
        }

        await saveSermonCorrection(correction)

        setCorrections(prev => [...prev, {
            id,
            reference,
            originalReference: options?.originalReference,
            correctionType: correction.correctionType,
            closestRawText: options?.closestRawText,
            timestamp: correction.timestamp,
        }])
        setUnsyncCount(prev => prev + 1)

        if (!isOffline && sessionId) {
            try {
                await addCorrectionMutation({
                    transcriptId: sessionId as Id<'transcripts'>,
                    correctedReference: reference,
                    originalReference: options?.originalReference,
                    correctionType: correction.correctionType,
                    closestRawText: options?.closestRawText,
                })
                await markCorrectionSynced(id)
                setUnsyncCount(prev => Math.max(0, prev - 1))
            } catch (err) {
                console.warn('[SermonCorrections] Failed to sync immediately, will retry:', err)
            }
        }
    }, [isOffline, sessionId, addCorrectionMutation])

    const removeCorrection = useCallback(async (id: string) => {
        await deleteSermonCorrection(id)
        setCorrections(prev => prev.filter(c => c.id !== id))
    }, [])

    const syncToConvex = useCallback(async () => {
        if (syncingRef.current || isOffline) return
        syncingRef.current = true
        setSyncStatus('syncing')

        try {
            const unsynced = await getUnsyncedCorrections()
            let synced = 0
            for (const c of unsynced) {
                if (!c.sermonSessionId) {
                    await markCorrectionSynced(c.id)
                    synced++
                    continue
                }
                try {
                    await addCorrectionMutation({
                        transcriptId: c.sermonSessionId as Id<'transcripts'>,
                        correctedReference: c.reference,
                        originalReference: c.originalReference,
                        correctionType: c.correctionType,
                        closestRawText: c.closestRawText,
                    })
                    await markCorrectionSynced(c.id)
                    synced++
                } catch (err) {
                    console.warn('[SermonCorrections] Failed to sync correction', c.id, err)
                }
            }
            setUnsyncCount(prev => Math.max(0, prev - synced))
            setSyncStatus('done')
        } finally {
            syncingRef.current = false
        }
    }, [isOffline, addCorrectionMutation])

    useEffect(() => {
        if (!isOffline && unsyncCount > 0 && !syncingRef.current) {
            syncToConvex()
        }
    }, [isOffline, unsyncCount, syncToConvex])

    return {
        corrections,
        addCorrection,
        removeCorrection,
        syncToConvex,
        syncStatus,
        unsyncCount,
    }
}