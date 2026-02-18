/**
 * useTranscripts Hook
 * Manages sermon transcripts with Convex persistence
 */

import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useUserRole } from './useUserRole'
import type { DetectedVerse } from '../services/sermon-listener/verseDetection'
import type { TranscriptionProvider } from '../services/sermon-listener'

export interface TranscriptVerse {
    reference: string
    book: string
    chapter: number
    verseStart: number
    verseEnd?: number
    confidence: string
}

export interface Transcript {
    _id: string
    title: string
    transcript: string
    detectedVerses?: TranscriptVerse[]
    provider: string
    language?: string
    scheduleId?: string
    churchId: string
    createdBy: string
    createdAt: string
    updatedAt: string
}

export interface UseTranscriptsReturn {
    // Queries
    transcripts: Transcript[] | undefined
    scheduleTranscripts: Transcript[] | undefined
    isLoading: boolean

    // Mutations
    createTranscript: (data: {
        title: string
        transcript: string
        detectedVerses?: DetectedVerse[]
        provider: TranscriptionProvider
        language?: string
        scheduleId?: string
    }) => Promise<string | null>
    updateTranscript: (id: string, data: {
        title?: string
        transcript?: string
        detectedVerses?: DetectedVerse[]
        scheduleId?: string
    }) => Promise<string | null>
    deleteTranscript: (id: string) => Promise<string | null>
}

/**
 * Hook for managing sermon transcripts
 */
export function useTranscripts(scheduleId?: string): UseTranscriptsReturn {
    const { currentUser } = useUserRole()

    // Queries
    const transcripts = useQuery(
        api.transcripts.getByChurch,
        currentUser?.churchId ? { churchId: currentUser.churchId } : 'skip'
    )

    const scheduleTranscripts = useQuery(
        api.transcripts.getBySchedule,
        scheduleId ? { scheduleId } : 'skip'
    )

    // Mutations
    const createMutation = useMutation(api.transcripts.create)
    const updateMutation = useMutation(api.transcripts.update)
    const deleteMutation = useMutation(api.transcripts.remove)

    // Create transcript
    const createTranscript = async (data: {
        title: string
        transcript: string
        detectedVerses?: DetectedVerse[]
        provider: TranscriptionProvider
        language?: string
        scheduleId?: string
    }): Promise<string | null> => {
        if (!currentUser?._id || !currentUser?.churchId) {
            console.error('User not authenticated or no church associated')
            return null
        }

        try {
            // Convert DetectedVerse to TranscriptVerse format
            const convertedVerses = data.detectedVerses?.map(v => ({
                reference: v.reference,
                book: v.book,
                chapter: v.chapter,
                verseStart: v.verseStart,
                verseEnd: v.verseEnd,
                confidence: v.confidence,
            }))

            const id = await createMutation({
                title: data.title,
                transcript: data.transcript,
                detectedVerses: convertedVerses,
                provider: data.provider,
                language: data.language,
                scheduleId: data.scheduleId,
                churchId: currentUser.churchId,
                createdBy: currentUser._id as string,
            })

            return id
        } catch (error) {
            console.error('Failed to create transcript:', error)
            return null
        }
    }

    // Update transcript
    const updateTranscript = async (id: string, data: {
        title?: string
        transcript?: string
        detectedVerses?: DetectedVerse[]
        scheduleId?: string
    }): Promise<string | null> => {
        try {
            // Convert DetectedVerse to TranscriptVerse format if provided
            const convertedVerses = data.detectedVerses?.map(v => ({
                reference: v.reference,
                book: v.book,
                chapter: v.chapter,
                verseStart: v.verseStart,
                verseEnd: v.verseEnd,
                confidence: v.confidence,
            }))

            await updateMutation({
                id: id as any,
                title: data.title,
                transcript: data.transcript,
                detectedVerses: convertedVerses,
                scheduleId: data.scheduleId,
            })

            return id
        } catch (error) {
            console.error('Failed to update transcript:', error)
            return null
        }
    }

    // Delete transcript
    const deleteTranscript = async (id: string): Promise<string | null> => {
        try {
            await deleteMutation({ id: id as any })
            return id
        } catch (error) {
            console.error('Failed to delete transcript:', error)
            return null
        }
    }

    return {
        transcripts: transcripts as Transcript[] | undefined,
        scheduleTranscripts: scheduleTranscripts as Transcript[] | undefined,
        isLoading: currentUser === undefined,
        createTranscript,
        updateTranscript,
        deleteTranscript,
    }
}

export default useTranscripts