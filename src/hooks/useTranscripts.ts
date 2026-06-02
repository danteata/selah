/**
 * useTranscripts Hook
 * Manages sermon transcripts with Convex persistence and offline IndexedDB fallback
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useUserRole } from './useUserRole'
import type { DetectedVerse } from '../services/sermon-listener/verseDetection'
import type { TranscriptionProvider } from '../services/sermon-listener'
import type { TranscriptSegment } from '../types/sermon-listener'
import {
    getOfflineTranscripts,
    addOfflineTranscript,
    deleteOfflineTranscript,
    findOfflineTranscriptByScheduleId,
    migrateLegacySermonStorage,
} from './useIndexedDB'

export interface TranscriptVerse {
    reference: string
    book: string
    chapter: number
    verseStart: number
    verseEnd?: number
    confidence: string
}

interface OfflineTranscript {
    id: string
    title: string
    transcript: string
    segments?: TranscriptSegment[]
    detectedVerses?: TranscriptVerse[]
    provider: string
    language?: string
    scheduleId?: string
    createdAt: string
    updatedAt: string
    _isOffline: true
}

function offlineToRecord(t: OfflineTranscript) {
    return {
        id: t.id,
        title: t.title,
        transcript: t.transcript,
        segments: t.segments,
        detectedVerses: t.detectedVerses,
        provider: t.provider,
        language: t.language,
        scheduleId: t.scheduleId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    }
}

export interface Transcript {
    _id: string
    title: string
    transcript: string
    segments?: TranscriptSegment[]
    detectedVerses?: TranscriptVerse[]
    provider: string
    language?: string
    scheduleId?: string
    churchId: string
    createdBy: string
    createdAt: string
    updatedAt: string
    _isOffline?: boolean
}

export interface UseTranscriptsReturn {
    // Queries
    transcripts: Transcript[] | undefined
    isLoading: boolean

    // Mutations
    createTranscript: (data: {
        title: string
        transcript: string
        segments?: TranscriptSegment[]
        detectedVerses?: DetectedVerse[]
        provider: TranscriptionProvider
        language?: string
        scheduleId?: string
    }) => Promise<string | null>
    updateTranscript: (id: string, data: {
        title?: string
        transcript?: string
        segments?: TranscriptSegment[]
        detectedVerses?: DetectedVerse[]
        scheduleId?: string
    }) => Promise<string | null>
    deleteTranscript: (id: string) => Promise<string | null>
}

function readOfflineTranscripts(): OfflineTranscript[] {
    // Synchronous shim kept for type compatibility with the existing
    // mutation signatures. The actual IDB read happens in the hook body
    // and the result is mirrored into this ref-like state.
    return offlineCache
}

let offlineCache: OfflineTranscript[] = []
const offlineListeners = new Set<() => void>()

function notifyOffline() {
    for (const fn of offlineListeners) fn()
}

async function persistOffline(transcript: OfflineTranscript) {
    await addOfflineTranscript(offlineToRecord(transcript))
    offlineCache = [transcript, ...offlineCache.filter(t => t.id !== transcript.id)]
    notifyOffline()
}

async function updateOfflineRecord(id: string, patch: Partial<OfflineTranscript>) {
    const existing = offlineCache.find(t => t.id === id)
    if (!existing) return
    const updated: OfflineTranscript = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
    }
    await addOfflineTranscript(offlineToRecord(updated))
    offlineCache = offlineCache.map(t => (t.id === id ? updated : t))
    notifyOffline()
}

async function removeOffline(id: string) {
    await deleteOfflineTranscript(id)
    offlineCache = offlineCache.filter(t => t.id !== id)
    notifyOffline()
}

/**
 * Hook for managing sermon transcripts
 */
export function useTranscripts(): UseTranscriptsReturn {
    const { currentUser } = useUserRole()

    // Mirror of the IDB-backed offline queue so synchronous reads work.
    const [, forceUpdate] = useState(0)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                await migrateLegacySermonStorage()
                const records = await getOfflineTranscripts()
                if (cancelled) return
                offlineCache = records.map(r => ({
                    ...r,
                    segments: r.segments as TranscriptSegment[] | undefined,
                    detectedVerses: r.detectedVerses as TranscriptVerse[] | undefined,
                    _isOffline: true as const,
                }))
                forceUpdate(n => n + 1)
            } catch (err) {
                console.warn('[useTranscripts] Failed to load offline transcripts from IDB:', err)
            }
        })()
        const onChange = () => forceUpdate(n => n + 1)
        offlineListeners.add(onChange)
        return () => {
            cancelled = true
            offlineListeners.delete(onChange)
        }
    }, [])

    // Queries
    const transcripts = useQuery(
        api.transcripts.getByChurch,
        currentUser?.churchId ? { churchId: currentUser.churchId } : 'skip'
    )

    // Mutations
    const createMutation = useMutation(api.transcripts.create)
    const updateMutation = useMutation(api.transcripts.update)
    const deleteMutation = useMutation(api.transcripts.remove)

    // Create transcript
    const createTranscript = async (data: {
        title: string
        transcript: string
        segments?: TranscriptSegment[]
        detectedVerses?: DetectedVerse[]
        provider: TranscriptionProvider
        language?: string
        scheduleId?: string
    }): Promise<string | null> => {
        const convertedVerses = data.detectedVerses?.map(v => ({
            reference: v.reference,
            book: v.book,
            chapter: v.chapter,
            verseStart: v.verseStart,
            verseEnd: v.verseEnd,
            confidence: v.confidence,
        }))

        if (!currentUser?._id || !currentUser?.churchId) {
            console.warn('[useTranscripts] User not authenticated — saving transcript offline')
            const offlineId = `offline-${Date.now()}`
            const offlineTranscript: OfflineTranscript = {
                id: offlineId,
                title: data.title,
                transcript: data.transcript,
                segments: data.segments,
                detectedVerses: convertedVerses,
                provider: data.provider,
                language: data.language,
                scheduleId: data.scheduleId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                _isOffline: true,
            }
            await persistOffline(offlineTranscript)
            return offlineId
        }

        try {
            const id = await createMutation({
                title: data.title,
                transcript: data.transcript,
                detectedVerses: convertedVerses,
                segments: data.segments,
                provider: data.provider,
                language: data.language,
                scheduleId: data.scheduleId,
                churchId: currentUser.churchId,
                createdBy: currentUser._id as string,
            })

            return id
        } catch (error) {
            console.error('[useTranscripts] Failed to create transcript online — saving offline:', error)
            const offlineId = `offline-${Date.now()}`
            const offlineTranscript: OfflineTranscript = {
                id: offlineId,
                title: data.title,
                transcript: data.transcript,
                segments: data.segments,
                detectedVerses: convertedVerses,
                provider: data.provider,
                language: data.language,
                scheduleId: data.scheduleId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                _isOffline: true,
            }
            await persistOffline(offlineTranscript)
            return offlineId
        }
    }

    // Update transcript
    const updateTranscript = async (id: string, data: {
        title?: string
        transcript?: string
        segments?: TranscriptSegment[]
        detectedVerses?: DetectedVerse[]
        scheduleId?: string
    }): Promise<string | null> => {
        const convertedVerses = data.detectedVerses?.map(v => ({
            reference: v.reference,
            book: v.book,
            chapter: v.chapter,
            verseStart: v.verseStart,
            verseEnd: v.verseEnd,
            confidence: v.confidence,
        }))

        if (id.startsWith('offline-')) {
            await updateOfflineRecord(id, {
                ...data,
                detectedVerses: convertedVerses as TranscriptVerse[] | undefined,
            })
            return id
        }

        try {
            await updateMutation({
                id: id as Id<'transcripts'>,
                title: data.title,
                transcript: data.transcript,
                detectedVerses: convertedVerses,
                segments: data.segments,
                scheduleId: data.scheduleId,
            })

            return id
        } catch (error) {
            console.error('[useTranscripts] Failed to update transcript online — updating offline copy:', error)
            // Look up by scheduleId for a same-schedule offline copy
            const offlineCopy = data.scheduleId
                ? await findOfflineTranscriptByScheduleId(data.scheduleId)
                : undefined
            if (offlineCopy) {
                await updateOfflineRecord(offlineCopy.id, {
                    ...data,
                    detectedVerses: convertedVerses as TranscriptVerse[] | undefined,
                })
            }
            return id
        }
    }

    // Delete transcript
    const deleteTranscript = async (id: string): Promise<string | null> => {
        if (id.startsWith('offline-')) {
            await removeOffline(id)
            return id
        }

        try {
            await deleteMutation({ id: id as Id<'transcripts'> })
            return id
        } catch (error) {
            console.error('[useTranscripts] Failed to delete transcript:', error)
            return null
        }
    }

    // Merge online + offline transcripts
    const onlineTranscripts = transcripts as Transcript[] | undefined
    const offlineTranscriptsList = readOfflineTranscripts()
    const combinedTranscripts: Transcript[] = [
        ...(onlineTranscripts ?? []),
        ...offlineTranscriptsList.map(t => ({
            _id: t.id,
            title: t.title,
            transcript: t.transcript,
            segments: t.segments,
            detectedVerses: t.detectedVerses,
            provider: t.provider,
            language: t.language,
            scheduleId: t.scheduleId,
            churchId: '',
            createdBy: '',
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            _isOffline: true,
        })),
    ]

    const displayTranscripts = combinedTranscripts

    return {
        transcripts: displayTranscripts,
        isLoading: currentUser === undefined,
        createTranscript,
        updateTranscript,
        deleteTranscript,
    }
}
