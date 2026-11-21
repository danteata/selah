import { describe, it, expect } from 'vitest'
import { classifyTranscriptionError, transcriptionErrorCodes } from '../transcriptionErrors'

describe('classifying transcription errors', () => {
    // The native engine's own wording for a missing model came out as an
    // internal error, so the banner never said to download the model.
    it.each([
        'Model base.en is not downloaded',
        'Failed to load model: Model small.en is not downloaded',
        'Unknown model: tiny.xx',
        'No transcription model is loaded',
    ])('"%s" is a missing model', (message) => {
        expect(classifyTranscriptionError(message)).toBe(transcriptionErrorCodes.MODEL_NOT_FOUND)
    })

    it.each([
        ['SCREEN_CAPTURE_PERMISSION_DENIED', transcriptionErrorCodes.SCREEN_CAPTURE_DENIED],
        ['Microphone permission denied.', transcriptionErrorCodes.MICROPHONE_DENIED],
        ['Lost the input stream (attempt 2): unplugged', transcriptionErrorCodes.CAPTURE_STREAM_LOST],
        ['Requested device not found', transcriptionErrorCodes.MICROPHONE_NOT_FOUND],
        ['Something else entirely', transcriptionErrorCodes.INTERNAL_ERROR],
    ])('"%s" → %s', (message, code) => {
        expect(classifyTranscriptionError(message)).toBe(code)
    })
})
