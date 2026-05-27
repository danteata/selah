/**
 * Sermon Listener Types
 */

export interface TranscriptSegment {
    /** Unique segment identifier */
    id: string
    /** Transcribed text */
    text: string
    /** Sermon-relative start time in milliseconds */
    startMs: number
    /** Sermon-relative end time in milliseconds */
    endMs: number
    /** Transcription source */
    source: 'web-speech' | 'whisper' | 'elevenlabs'
    /** ASR confidence (0-1) if available */
    confidence?: number
    /** Speaker index for future diarization */
    speaker?: number
}
