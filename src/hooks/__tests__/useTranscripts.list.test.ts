import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const queries = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]>, result: undefined as unknown }))

vi.mock('convex/react', () => ({
    useQuery: (ref: unknown, args: unknown) => {
        queries.calls.push([ref, args])
        return args === 'skip' ? undefined : queries.result
    },
    useMutation: () => vi.fn(),
}))
vi.mock('../../../convex/_generated/api', () => ({
    api: { transcripts: { listSummaries: 'transcripts:listSummaries', create: 'c', update: 'u', remove: 'r' } },
}))
vi.mock('../useUserRole', () => ({ useUserRole: () => ({ currentUser: { _id: 'user-1', churchId: 'church-1' } }) }))
vi.mock('../useIndexedDB', () => ({
    migrateLegacySermonStorage: vi.fn(async () => {}),
    getOfflineTranscripts: vi.fn(async () => [{
        id: 'offline-1', title: 'Offline', transcript: 'x'.repeat(600), provider: 'whisper',
        detectedVerses: [{ reference: 'John 3:16' }], createdAt: 'b', updatedAt: 'b',
    }]),
    addOfflineTranscript: vi.fn(),
    deleteOfflineTranscript: vi.fn(),
    findOfflineTranscriptByScheduleId: vi.fn(),
}))

import { useTranscripts } from '../useTranscripts'

describe('useTranscripts list', () => {
    beforeEach(() => {
        queries.calls = []
        queries.result = undefined
    })

    it("doesn't read the saved list while nothing shows it", async () => {
        renderHook(() => useTranscripts({ list: false }))
        await act(async () => {})
        expect(queries.calls.every(([, args]) => args === 'skip')).toBe(true)
    })

    it('lists summaries, not whole transcripts, with offline ones summarised alike', async () => {
        queries.result = [{
            transcriptId: 't1', churchId: 'church-1', title: 'Sunday', preview: 'In the beginning', length: 5000,
            verseReferences: ['Genesis 1:1'], verseCount: 1, provider: 'whisper', createdBy: 'user-1', createdAt: 'a', updatedAt: 'a',
        }]
        const { result } = renderHook(() => useTranscripts())

        expect(queries.calls.at(-1)).toEqual(['transcripts:listSummaries', { churchId: 'church-1' }])
        await waitFor(() => expect(result.current.transcripts).toHaveLength(2))
        expect(result.current.transcripts![0]).toMatchObject({ _id: 't1', preview: 'In the beginning', length: 5000, verseCount: 1 })
        expect(result.current.transcripts![1]).toMatchObject({
            _id: 'offline-1', preview: 'x'.repeat(500), length: 600, verseReferences: ['John 3:16'], verseCount: 1, _isOffline: true,
        })
    })
})
