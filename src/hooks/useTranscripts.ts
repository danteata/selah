/**
 * useTranscripts Hook
 * Manages sermon transcripts with Convex persistence and offline IndexedDB fallback
 *
 * The list is of summaries (`transcripts.listSummaries`): a title, the start
 * of the text and the verses, which is all the saved-transcripts list shows.
 * It used to subscribe to the church's last 200 whole transcripts, segments
 * and all, re-read for everyone each time the sermon in progress was saved.
 * The whole of one transcript is `transcripts.getById`.
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

/** How much of a transcript a summary previews; the server keeps as much. */
const PREVIEW_CHARS = 500

/** A saved transcript as the list shows it. */
export interface TranscriptSummary {
    _id: string
    title: string
    /** The start of the text; `length` is all of it. */
    preview: string
    length: number
    verseReferences: string[]
    verseCount: number
    provider: string
    language?: string
    scheduleId?: string
    createdAt: string
    updatedAt: string
    _isOffline?: boolean
}

export interface UseTranscriptsReturn {
    // Queries
    transcripts: TranscriptSummary[] | undefined
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
 * Hook for managing sermon transcripts. `list: false` leaves the saved list
 * unread (and unsubscribed) while nothing shows it; saving works either way.
 */
export function useTranscripts({ list = true }: { list?: boolean } = {}): UseTranscriptsReturn {
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
    const listing = list && !!currentUser?.churchId
    const summaries = useQuery(
        api.transcripts.listSummaries,
        listing ? { churchId: currentUser.churchId } : 'skip'
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
    const combinedTranscripts: TranscriptSummary[] = [
        ...(summaries ?? []).map((t): TranscriptSummary => ({
            _id: t.transcriptId,
            title: t.title,
            preview: t.preview,
            length: t.length,
            verseReferences: t.verseReferences,
            verseCount: t.verseCount,
            provider: t.provider,
            language: t.language,
            scheduleId: t.scheduleId,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        })),
        ...readOfflineTranscripts().map((t): TranscriptSummary => ({
            _id: t.id,
            title: t.title,
            preview: t.transcript.slice(0, PREVIEW_CHARS),
            length: t.transcript.length,
            verseReferences: (t.detectedVerses ?? []).map(v => v.reference),
            verseCount: t.detectedVerses?.length ?? 0,
            provider: t.provider,
            language: t.language,
            scheduleId: t.scheduleId,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            _isOffline: true,
        })),
    ]

    return {
        transcripts: combinedTranscripts,
        isLoading: currentUser === undefined || (listing && summaries === undefined),
        createTranscript,
        updateTranscript,
        deleteTranscript,
    }
}
