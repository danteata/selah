/**
 * Dev-only session audio recorder.
 *
 * Wraps the native `start_session_recording`/`stop_session_recording` Tauri
 * commands so a sermon-listener session's raw audio is saved to disk for
 * later offline re-transcription and accuracy comparison against the live
 * detector (see `devAccuracyReport.ts`). No-op in production builds — the
 * underlying Rust commands are themselves compiled out via
 * `#[cfg(debug_assertions)]`, this is just the matching frontend guard.
 */
import { invoke } from '@tauri-apps/api/core'

class SessionAudioRecorder {
    private sessionId: string | null = null
    private filePath: string | null = null
    // Tracked here (not in the calling component) because this singleton
    // outlives a single component's lifetime — a panel remount between
    // Start and Stop (e.g. navigating away and back, or toggling
    // minimize/expand) must not lose the session's start time, or the
    // sidecar write at Stop silently never happens.
    private startedAt: number | null = null

    /** Returns the new session id, or null if recording didn't start (prod build, or an error). */
    async start(): Promise<string | null> {
        if (!import.meta.env.DEV) return null

        const sessionId = crypto.randomUUID()
        try {
            const filePath = await invoke<string>('start_session_recording', { sessionId })
            this.sessionId = sessionId
            this.filePath = filePath
            this.startedAt = Date.now()
            return sessionId
        } catch (error) {
            console.warn('[sessionAudioRecorder] Failed to start recording:', error)
            this.sessionId = null
            this.filePath = null
            this.startedAt = null
            return null
        }
    }

    async stop(): Promise<void> {
        if (!import.meta.env.DEV || !this.sessionId) return
        try {
            await invoke('stop_session_recording')
        } catch (error) {
            console.warn('[sessionAudioRecorder] Failed to stop recording:', error)
        } finally {
            this.sessionId = null
            this.filePath = null
            this.startedAt = null
        }
    }

    getSessionId(): string | null {
        return this.sessionId
    }

    getFilePath(): string | null {
        return this.filePath
    }

    /** Call before stop() — stop() clears this once it resolves. */
    getStartedAt(): number | null {
        return this.startedAt
    }
}

export const sessionAudioRecorder = new SessionAudioRecorder()
