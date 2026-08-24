import { describe, it, expect, beforeEach, vi } from 'vitest'

const { invokeMock, isDesktopMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    isDesktopMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../../../platform', () => ({ isDesktop: isDesktopMock }))

import {
    formatBytes,
    formatDuration,
    retranscribe,
    sweepRetention,
    startRecording,
    type RecordingFile,
} from '../sessionRecordings'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

function recording(id: string, ageDays: number, bytes = 1_000_000): RecordingFile {
    return {
        session_id: id,
        path: `/tmp/${id}.wav`,
        bytes,
        modified_ms: NOW - ageDays * DAY,
        duration_secs: 2700,
    }
}

/** Newest first, matching what Rust returns. */
function stubList(files: RecordingFile[]) {
    invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'list_sermon_recordings') return Promise.resolve(files)
        return Promise.resolve(undefined)
    })
}

describe('sweepRetention', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        isDesktopMock.mockReset().mockReturnValue(true)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('deletes nothing when retention is never', async () => {
        stubList([recording('old', 900)])

        const result = await sweepRetention('never', new Set(), NOW)

        expect(result.deleted).toEqual([])
        expect(invokeMock).not.toHaveBeenCalledWith('delete_sermon_recording', expect.anything())
    })

    it('deletes recordings past the age limit and keeps the rest', async () => {
        stubList([recording('fresh', 5), recording('stale', 100)])

        const result = await sweepRetention('months3', new Set(), NOW)

        expect(result.deleted).toEqual(['stale'])
        expect(result.freedBytes).toBe(1_000_000)
    })

    it('never deletes a starred recording, however old', async () => {
        // The whole point of starring. A sweep that removed the one sermon
        // someone deliberately kept would be the worst outcome for the feature.
        stubList([recording('keep-me', 900), recording('ordinary', 900)])

        const result = await sweepRetention('months3', new Set(['keep-me']), NOW)

        expect(result.deleted).toEqual(['ordinary'])
    })

    it('applies the count cap to the oldest beyond the limit', async () => {
        const files = Array.from({ length: 13 }, (_, i) => recording(`s${i}`, i))
        stubList(files)

        const result = await sweepRetention('last10', new Set(), NOW)

        // Newest first, so the last three are the oldest three.
        expect(result.deleted.sort()).toEqual(['s10', 's11', 's12'])
    })

    it('does not let starred recordings consume slots in the count cap', async () => {
        // 24 recordings, the 12 newest starred. The cap applies to the
        // unstarred ones only, so all 12 starred survive and the 12 unstarred
        // are trimmed to 10 — rather than the starred ones filling the quota
        // and every unstarred recording being swept.
        const files = Array.from({ length: 24 }, (_, i) => recording(`s${i}`, i))
        stubList(files)
        const starred = new Set(files.slice(0, 12).map((f) => f.session_id))

        const result = await sweepRetention('last10', starred, NOW)

        // Unstarred are s12..s23, newest first; the last two are the oldest.
        expect(result.deleted.sort()).toEqual(['s22', 's23'])
    })

    it('reports only the recordings that were actually removed', async () => {
        invokeMock.mockImplementation((cmd: string, args?: { sessionId?: string }) => {
            if (cmd === 'list_sermon_recordings') {
                return Promise.resolve([recording('a', 900), recording('b', 900)])
            }
            if (cmd === 'delete_sermon_recording' && args?.sessionId === 'b') {
                // e.g. still being written, or the file vanished underneath us
                return Promise.reject(new Error('locked'))
            }
            return Promise.resolve(undefined)
        })

        const result = await sweepRetention('months3', new Set(), NOW)

        expect(result.deleted).toEqual(['a'])
        expect(result.freedBytes).toBe(1_000_000)
    })

    it('does nothing in the browser build', async () => {
        isDesktopMock.mockReturnValue(false)

        const result = await sweepRetention('months3', new Set(), NOW)

        expect(result.deleted).toEqual([])
        expect(invokeMock).not.toHaveBeenCalled()
    })
})

describe('startRecording', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        isDesktopMock.mockReset().mockReturnValue(true)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('returns null rather than throwing when recording cannot start', async () => {
        // A failed archive must not take the service down with it.
        invokeMock.mockRejectedValue(new Error('disk full'))

        await expect(startRecording('abc')).resolves.toBeNull()
    })
})

describe('retranscribe', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        isDesktopMock.mockReset().mockReturnValue(true)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    function stubEngine(loaded: string | null, result: string | Error = 'the new text') {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(loaded)
            if (cmd === 'transcribe_audio_file') {
                return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
            }
            return Promise.resolve(undefined)
        })
    }

    it('transcribes with the chosen model', async () => {
        stubEngine(null)

        const out = await retranscribe('/tmp/a.wav', 'whisper-large-v3')

        expect(out).toEqual({ text: 'the new text', modelId: 'whisper-large-v3' })
        expect(invokeMock).toHaveBeenCalledWith('transcribe_audio_file', {
            filePath: '/tmp/a.wav',
            modelId: 'whisper-large-v3',
        })
    })

    it('restores the previously loaded model afterwards', async () => {
        // Otherwise re-transcribing on Large silently leaves Large loaded, and
        // the next service starts on a model nobody chose.
        stubEngine('moonshine-streaming-small')

        await retranscribe('/tmp/a.wav', 'whisper-large-v3')

        expect(invokeMock).toHaveBeenCalledWith('load_native_model', {
            modelId: 'moonshine-streaming-small',
        })
    })

    it('restores the previous model even when transcription fails', async () => {
        stubEngine('moonshine-streaming-small', new Error('decode failed'))

        await expect(retranscribe('/tmp/a.wav', 'whisper-large-v3')).rejects.toThrow(
            'decode failed',
        )
        expect(invokeMock).toHaveBeenCalledWith('load_native_model', {
            modelId: 'moonshine-streaming-small',
        })
    })

    it('does not reload when the chosen model was already the loaded one', async () => {
        stubEngine('whisper-large-v3')

        await retranscribe('/tmp/a.wav', 'whisper-large-v3')

        expect(invokeMock).not.toHaveBeenCalledWith('load_native_model', expect.anything())
    })

    it('still returns the text when the restore fails', async () => {
        // A failed restore is worth a warning, not worth throwing away the
        // transcript the operator just waited several minutes for.
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve('small')
            if (cmd === 'transcribe_audio_file') return Promise.resolve('recovered text')
            if (cmd === 'load_native_model') return Promise.reject(new Error('gone'))
            return Promise.resolve(undefined)
        })

        await expect(retranscribe('/tmp/a.wav', 'large')).resolves.toEqual({
            text: 'recovered text',
            modelId: 'large',
        })
    })
})

describe('formatting', () => {
    it('formats sizes at the scale a sermon archive reaches', () => {
        expect(formatBytes(512)).toBe('512 B')
        expect(formatBytes(90 * 1024 * 1024)).toBe('90 MB')
        expect(formatBytes(Math.round(4.5 * 1024 ** 3))).toBe('4.5 GB')
    })

    it('formats durations as a service length, not seconds', () => {
        expect(formatDuration(2700)).toBe('45 min')
        expect(formatDuration(4320)).toBe('1 h 12 min')
        expect(formatDuration(30)).toBe('30 s')
        // 3599 s must carry into an hour rather than printing "60 min".
        expect(formatDuration(3599)).toBe('1 h 0 min')
    })

    it('shows a dash when the length is unknown', () => {
        // A file whose header could not be parsed — truncated, or in progress.
        expect(formatDuration(null)).toBe('—')
        expect(formatDuration(0)).toBe('—')
    })
})
