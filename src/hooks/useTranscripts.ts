/**
 * useTranscripts Hook
 * Manages sermon transcripts with Convex persistence and offline localStorage fallback
 */

import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useUserRole } from './useUserRole'
import type { DetectedVerse } from '../services/sermon-listener/verseDetection'
import type { TranscriptionProvider } from '../services/sermon-listener'
import type { TranscriptSegment } from '../types/sermon-listener'

const OFFLINE_TRANSCRIPTS_KEY = 'sermon-listener:offline-transcripts'

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
    if (typeof window === 'undefined') return []
    try {
        const raw = localStorage.getItem(OFFLINE_TRANSCRIPTS_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function writeOfflineTranscripts(items: OfflineTranscript[]): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(OFFLINE_TRANSCRIPTS_KEY, JSON.stringify(items))
}

/**
 * Hook for managing sermon transcripts
 */
export function useTranscripts(): UseTranscriptsReturn {
    const { currentUser } = useUserRole()

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
            const offline = readOfflineTranscripts()
            offline.unshift(offlineTranscript)
            writeOfflineTranscripts(offline)
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
            const offline = readOfflineTranscripts()
            offline.unshift(offlineTranscript)
            writeOfflineTranscripts(offline)
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
            const offline = readOfflineTranscripts()
            const idx = offline.findIndex(t => t.id === id)
            if (idx !== -1) {
                offline[idx] = {
                    ...offline[idx],
                    ...data,
                    detectedVerses: convertedVerses ?? offline[idx].detectedVerses,
                    segments: data.segments ?? offline[idx].segments,
                    updatedAt: new Date().toISOString(),
                }
                writeOfflineTranscripts(offline)
            }
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
            const offline = readOfflineTranscripts()
            const offlineCopy = offline.find(t => t.scheduleId === data.scheduleId)
            if (offlineCopy) {
                const idx = offline.indexOf(offlineCopy)
                offline[idx] = {
                    ...offline[idx],
                    ...data,
                    detectedVerses: convertedVerses ?? offline[idx].detectedVerses,
                    segments: data.segments ?? offline[idx].segments,
                    updatedAt: new Date().toISOString(),
                }
                writeOfflineTranscripts(offline)
            }
            return id
        }
    }

    // Delete transcript
    const deleteTranscript = async (id: string): Promise<string | null> => {
        if (id.startsWith('offline-')) {
            const offline = readOfflineTranscripts()
            const filtered = offline.filter(t => t.id !== id)
            writeOfflineTranscripts(filtered)
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

export default useTranscripts