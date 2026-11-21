/**
 * The listening session: everything the sermon listener hears between one
 * clear of the transcript and the next, and the listening runs within it
 * (see GLOSSARY.md).
 *
 * It owns the lifecycle that used to be spread across a hook, a panel and
 * whichever control was pressed: starting and stopping a run from any entry
 * point, restarting a capture that died mid-run, the free-plan cap,
 * keep-awake, the archive recording, the dev accuracy recording, and saving
 * the transcript for the team. It owns the transcript too (an assembler per
 * session) and hands each utterance to whoever is following it.
 *
 * One per app — there is one microphone. Pure apart from what it is given:
 * the engines and the side effects come in as dependencies, so the whole
 * lifecycle is tested with fakes.
 */

import { AnalyticsEventType } from '../analytics/types'
import { TranscriptAssembler } from './transcriptAssembler'
import {
    errorFromMessage,
    listeningError,
    type CaptureStatus,
    type EngineEvent,
    type EngineSegment,
    type ListeningError,
    type TranscriptionEngine,
    type TranscriptionProvider,
} from './transcriptionEngine'
import { transcriptionErrorCodes } from './transcriptionErrors'
import type { DetectedVerse } from './verseDetection'
import type { TranscriptSegment } from '../../types/sermon-listener'

export type ListeningStatus = 'idle' | 'starting' | 'listening'

export interface ListeningSnapshot {
    status: ListeningStatus
    provider: TranscriptionProvider
    isSupported: boolean
    providerReady: boolean
    error: ListeningError | null
    /** The team's saved copy of this session's transcript, once there is one. */
    savedTranscriptId: string | null
    /** Bumped when a dev accuracy recording has been written. */
    devRecordingsVersion: number
}

/** Settings read afresh at each start. */
export interface ListeningConfig {
    language: string
    captureSource?: 'microphone' | 'system'
    microphoneDeviceId?: string
    inputChannel?: number
    /** Vocabulary bias for the model; empty while a song is being followed. */
    initialPrompt: string
    /** Narrows the duplicate filter while a song is being followed (see transcriptDedup). */
    worshipMode: boolean
    recordSessions: boolean
    isPro: boolean
}

export type ListeningNotice =
    | { type: 'recording-failed' }
    | { type: 'microphone-fell-back'; from: string }
    | { type: 'microphone-reconnected' }
    | { type: 'free-plan-limit' }

export interface TranscriptStore {
    create(data: {
        title: string
        transcript: string
        segments: TranscriptSegment[]
        detectedVerses: DetectedVerse[]
        scheduleId?: string
        provider: TranscriptionProvider
        language: string
    }): Promise<string | null>
    update(id: string, data: {
        title: string
        transcript: string
        segments: TranscriptSegment[]
        detectedVerses: DetectedVerse[]
        scheduleId?: string
    }): Promise<unknown>
}

/** Side effects that exist outside React; real ones in appListeningSession.ts. */
export interface ListeningSessionDeps {
    engines: Record<TranscriptionProvider, TranscriptionEngine>
    keepAwake: { start(): Promise<unknown>; stop(): Promise<unknown> }
    chime: { start(): void; stop(): void }
    /** The church's archive of service audio, kept when they turn it on. */
    archive: {
        start(sessionId: string): Promise<string | null>
        stop(): Promise<void>
        attachTranscript(sessionId: string, text: string): Promise<void>
    }
    /** Development builds only: raw audio plus what was detected, for accuracy reports. */
    devRecorder: {
        start(): Promise<unknown>
        stop(): Promise<{ sessionId: string; startedAt: number } | null>
        writeSidecar(sidecar: {
            sessionId: string
            startedAt: number
            stoppedAt: number
            liveDetectedVerses: DetectedVerse[]
            rawUtterances: Array<{ text: string; timestamp: number }>
        }): Promise<void>
    } | null
    /** For system-audio capture: null when allowed, otherwise what to tell the operator. */
    capturePermission(source: 'microphone' | 'system' | undefined): Promise<string | null>
    /** Let the page play audio (and resume an AudioContext) before capture starts. */
    unlockAudio(): Promise<void>
    /** The audio-features heartbeat: stale for a while means the capture died. */
    audioSignal: { isStale(ms: number): boolean }
    /** The chosen microphone is gone: forget it so Settings stops naming it. */
    forgetMicrophone(): void
}

/** What the app connects once it is running (see useSermonListener). */
export interface ListeningConnections {
    config: () => ListeningConfig
    /** The newest utterance, and the transcript to read it against. */
    hear: (text: string, latestChunk: string, committed: boolean) => void
    /** Capture stopped (a stop, a failure, or a restart). */
    captureStopped: () => void
    track: (event: AnalyticsEventType, properties: Record<string, unknown>) => void
    notify: (notice: ListeningNotice) => void
    transcripts: TranscriptStore | null
    /** What the saved copy carries besides the transcript. */
    savedCopyDetails: () => { detectedVerses: DetectedVerse[]; scheduleId?: string }
}

const INTERIM_DEBOUNCE_MS = 300
/** Free-plan cap on a single listening run. */
export const FREE_RUN_LIMIT_MS = 40 * 60 * 1000
/** The team's copy is saved this often while listening, and at every stop. */
export const SAVED_COPY_INTERVAL_MS = 5 * 60 * 1000
const WATCHDOG_INTERVAL_MS = 2500
/** The heartbeat counts as flowing when fresh within this... */
const SIGNAL_FRESH_MS = 2000
/** ...and the capture as dead once stale for this long after it flowed. */
const SIGNAL_DEAD_MS = 9000
/** At most one automatic restart this often. */
const RESTART_DEBOUNCE_MS = 30_000
/** A pause between stopping a dead capture and starting it again. */
const RESTART_GAP_MS = 400
/** Throttle for the transcription analytics event. */
const TRANSCRIPTION_EVENT_MS = 5000

const noConnections: ListeningConnections = {
    config: () => ({ language: 'en-US', initialPrompt: '', worshipMode: false, recordSessions: false, isPro: true }),
    hear: () => {},
    captureStopped: () => {},
    track: () => {},
    notify: () => {},
    transcripts: null,
    savedCopyDetails: () => ({ detectedVerses: [] }),
}

interface Run {
    startedAt: number
    recordingId: string | null
    devRecording: boolean
    watchdog: ReturnType<typeof setInterval> | null
    capTimer: ReturnType<typeof setTimeout> | null
    saveTimer: ReturnType<typeof setInterval> | null
}

export class ListeningSession {
    private readonly deps: ListeningSessionDeps
    private connections: ListeningConnections = noConnections
    private snapshot: ListeningSnapshot
    private readonly listeners = new Set<() => void>()
    private assembler = new TranscriptAssembler()
    private readonly assemblerListeners = new Set<() => void>()
    private availability: Promise<void> | null = null
    private run: Run | null = null
    /** Set while a dead capture is being restarted inside a run. */
    private restarting = false
    /** When the current capture began (later than the run, after a restart). */
    private captureStartedAt = 0
    private interimTimer: ReturnType<typeof setTimeout> | null = null
    private lastTranscriptionEventAt = 0
    private title = ''
    // The team's saved copy: one per listening session, saved one at a time in order.
    private savedCopyChain: Promise<void> = Promise.resolve()
    private lastSavedText = ''
    /** Bumped by a clear, so a save still in flight belongs to the session it was made for. */
    private sessionGeneration = 0

    constructor(deps: ListeningSessionDeps, provider: TranscriptionProvider = 'web-speech') {
        this.deps = deps
        this.snapshot = {
            status: 'idle',
            provider,
            isSupported: false,
            providerReady: false,
            error: null,
            savedTranscriptId: null,
            devRecordingsVersion: 0,
        }
    }

    // ----- interface -------------------------------------------------------

    getSnapshot = (): ListeningSnapshot => this.snapshot

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /** This session's transcript. A clear replaces it, so subscribe through `subscribeTranscript`. */
    getTranscript = (): TranscriptAssembler => this.assembler

    subscribeTranscript = (listener: () => void): (() => void) => {
        this.assemblerListeners.add(listener)
        const unsubscribe = this.assembler.subscribe(listener)
        return () => {
            this.assemblerListeners.delete(listener)
            unsubscribe()
        }
    }

    connect(connections: Partial<ListeningConnections>): void {
        this.connections = { ...this.connections, ...connections }
    }

    /** Show (or clear) an error that arose outside the engines, such as a failed version switch. */
    showError(error: ListeningError | null): void {
        this.update({ error })
    }

    /** What the saved copy is called; empty for the default, dated title. */
    setTitle(title: string): void {
        this.title = title
    }

    /**
     * Which engine to use. Falls back to web speech when the native engine is
     * missing — on the web build that's expected; on the desktop it's worth a
     * word to the operator.
     */
    checkAvailability(target: TranscriptionProvider, { isDesktop }: { isDesktop: boolean }): Promise<void> {
        const check = (async () => {
            const available = await this.deps.engines[target].isAvailable()
            if (!available && target === 'native' && await this.deps.engines['web-speech'].isAvailable()) {
                this.update({
                    provider: 'web-speech',
                    isSupported: true,
                    providerReady: true,
                    ...(isDesktop ? { error: errorFromMessage('Native transcription unavailable. Falling back to Web Speech API.') } : {}),
                })
                return
            }
            this.update({ provider: target, isSupported: available, providerReady: available })
        })()
        this.availability = check
        return check
    }

    /** Start a listening run. Resolves true once listening. */
    async start(): Promise<boolean> {
        if (this.snapshot.status !== 'idle') return false
        this.update({ status: 'starting' })

        try {
            // Pressed before the availability check landed: wait for it rather
            // than report the engine unsupported.
            await this.availability
            if (this.stoppedWhileStarting()) return false
            const { config, track } = this.connections
            const settings = config()

            if (!this.snapshot.isSupported) {
                this.update({ status: 'idle', error: errorFromMessage('Speech recognition is not supported') })
                track(AnalyticsEventType.SERMON_LISTENER_ERROR, { reason: 'unsupported' })
                return false
            }

            const refusal = await this.deps.capturePermission(settings.captureSource)
            if (this.stoppedWhileStarting()) return false
            if (refusal) {
                this.update({ status: 'idle', error: errorFromMessage(refusal) })
                track(AnalyticsEventType.SERMON_LISTENER_ERROR, { reason: 'screen_capture_denied' })
                return false
            }

            // Prevent the device from sleeping through the service.
            this.deps.keepAwake.start().catch((err: unknown) => {
                console.warn('[listeningSession] Keep-awake failed (non-fatal):', err)
            })
            await this.deps.unlockAudio()
            if (this.stoppedWhileStarting()) {
                this.releaseAfterFailedStart()
                return false
            }

            const started = await this.startCapture(settings)
            // Read afresh: a stop may have arrived while the engine was starting.
            if (!started && this.getSnapshot().status === 'starting') {
                // The engine said no without saying why; it already reported a
                // failure otherwise. Either way, nothing is held for a run
                // that never began.
                this.update({ status: 'idle' })
                this.releaseAfterFailedStart()
            }
            return started
        } catch (err) {
            console.error('[listeningSession] start failed:', err)
            this.update({ status: 'idle', error: errorFromMessage(err instanceof Error ? err.message : String(err)) })
            this.releaseAfterFailedStart()
            return false
        }
    }

    /** A Stop arrived while start() was waiting. */
    private stoppedWhileStarting(): boolean {
        return this.getSnapshot().status !== 'starting'
    }

    /** End the listening run. */
    stop(): void {
        if (this.snapshot.status === 'idle' && !this.run) {
            // A start still in flight is stopped by the engine itself.
            void this.deps.engines[this.snapshot.provider].stop()
            return
        }
        const wasListening = this.snapshot.status === 'listening'
        this.stopCapture()
        this.update({ status: 'idle' })
        if (wasListening) this.deps.chime.stop()
        this.endRun()
    }

    /** Clear the transcript: a new listening session begins, listening or not. */
    clear(): void {
        this.clearInterimTimer()
        this.assembler = new TranscriptAssembler()
        if (this.run) this.assembler.startRun(Date.now(), this.captureStartedAt)
        for (const listener of this.assemblerListeners) {
            this.assembler.subscribe(listener)
            listener()
        }
        // A new session is a new saved copy.
        this.sessionGeneration++
        this.savedCopyChain = Promise.resolve()
        this.lastSavedText = ''
        this.update({ error: null, savedTranscriptId: null })
    }

    /** Pick up a transcript restored after a reload — unless this session has heard something since. */
    restore(restored: { text?: string; segments?: TranscriptSegment[] }): boolean {
        const current = this.assembler.getSnapshot()
        if (current.text || current.segments.length > 0) return false
        this.assembler.restore(restored)
        return true
    }

    // ----- state -----------------------------------------------------------

    private update(patch: Partial<ListeningSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of this.listeners) listener()
    }

    // ----- capture ---------------------------------------------------------

    private engine(): TranscriptionEngine {
        return this.deps.engines[this.snapshot.provider]
    }

    private async startCapture(settings: ListeningConfig): Promise<boolean> {
        const engine = this.engine()
        // An engine still running or draining from before (a remount, a
        // restart) would refuse to start, silently.
        if (engine.isBusy()) {
            try {
                await engine.stop()
            } catch (e) {
                console.warn('[listeningSession] Failed to stop a stale capture:', e)
            }
        }
        return engine.start({
            language: settings.language,
            captureSource: settings.captureSource,
            microphoneDeviceId: settings.microphoneDeviceId,
            inputChannel: settings.inputChannel,
            initialPrompt: settings.initialPrompt,
        }, (event) => this.onEngineEvent(event))
    }

    private stopCapture(): void {
        this.clearInterimTimer()
        this.assembler.clearInterim()
        void this.engine().stop()
        this.connections.captureStopped()
    }

    private onEngineEvent(event: EngineEvent): void {
        switch (event.type) {
            case 'started':
                if (this.restarting) {
                    // Same run, same recording, same clock; the new capture's
                    // own times start from zero, so they're offset to the run.
                    this.restarting = false
                    this.captureStartedAt = Date.now()
                    this.assembler.resumeCapture(this.captureStartedAt)
                    this.update({ status: 'listening', error: null })
                    return
                }
                this.beginRun()
                return
            case 'ended':
                // The engine stopped on its own.
                if (this.restarting) return
                this.update({ status: 'idle' })
                this.endRun()
                return
            case 'failed':
                this.restarting = false
                this.connections.track(AnalyticsEventType.SERMON_LISTENER_ERROR, {
                    provider: this.snapshot.provider,
                    message: event.error.message,
                })
                this.connections.captureStopped()
                this.update({ status: 'idle', error: event.error })
                if (this.run) this.endRun()
                else this.releaseAfterFailedStart()
                return
            case 'result':
                this.onResult(event)
                return
            case 'capture':
                this.onCaptureStatus(event)
        }
    }

    private onResult(result: { text: string; isFinal: boolean; segments?: EngineSegment[] }): void {
        const { config, hear, track } = this.connections
        const assembled = this.assembler.take(result, {
            now: Date.now(),
            provider: this.snapshot.provider,
            worshipMode: config().worshipMode,
        })
        const { chunk } = assembled

        if (assembled.kind === 'interim') {
            // Verse detection waits for the words to settle.
            this.clearInterimTimer()
            this.interimTimer = setTimeout(() => {
                this.interimTimer = null
                hear(assembled.hear, chunk, assembled.committed)
            }, INTERIM_DEBOUNCE_MS)
            return
        }

        // A final supersedes the interim pass still waiting; a duplicate doesn't.
        if (assembled.kind === 'final') this.clearInterimTimer()
        hear(assembled.hear, chunk, assembled.committed)
        if (assembled.kind === 'duplicate') return

        const now = Date.now()
        if (this.lastTranscriptionEventAt && now - this.lastTranscriptionEventAt > TRANSCRIPTION_EVENT_MS) {
            track(AnalyticsEventType.SERMON_LISTENER_TRANSCRIPTION, { length: assembled.hear.length, provider: this.snapshot.provider })
            this.lastTranscriptionEventAt = now
        } else if (!this.lastTranscriptionEventAt) {
            this.lastTranscriptionEventAt = now
        }
    }

    /**
     * What happened to the native capture stream. Nothing else can tell the
     * operator: the heartbeat keeps running through delivery gaps on purpose,
     * so a microphone that dropped reads downstream as a room gone quiet.
     */
    private onCaptureStatus(capture: CaptureStatus): void {
        switch (capture.status) {
            case 'fell-back':
                // Capture already continues on the default device. Forget the
                // stored choice so Settings stops naming a microphone that is
                // not the one recording.
                this.update({ error: null })
                this.deps.forgetMicrophone()
                this.connections.notify({ type: 'microphone-fell-back', from: capture.from })
                return
            case 'recovered':
                this.update({ error: null })
                this.connections.notify({ type: 'microphone-reconnected' })
                return
            case 'fatal':
                // The supervisor has given up, so this is not retrying.
                this.update({
                    error: listeningError(
                        transcriptionErrorCodes.CAPTURE_STREAM_LOST,
                        `Microphone disconnected and could not be reopened: ${capture.message}`,
                        false,
                    ),
                })
                return
            case 'lost':
                this.update({
                    error: listeningError(
                        transcriptionErrorCodes.CAPTURE_STREAM_LOST,
                        `Lost the input stream (attempt ${capture.attempt}): ${capture.message}`,
                        true,
                    ),
                })
        }
    }

    private clearInterimTimer(): void {
        if (this.interimTimer) {
            clearTimeout(this.interimTimer)
            this.interimTimer = null
        }
    }

    // ----- runs ------------------------------------------------------------

    private beginRun(): void {
        const { config, track } = this.connections
        const settings = config()
        const now = Date.now()
        this.run = { startedAt: now, recordingId: null, devRecording: false, watchdog: null, capTimer: null, saveTimer: null }
        this.captureStartedAt = now
        this.assembler.startRun(now)
        this.update({ status: 'listening', error: null })
        this.deps.chime.start()
        track(AnalyticsEventType.SERMON_LISTENER_STARTED, {
            provider: this.snapshot.provider,
            language: settings.language,
            capture_source: settings.captureSource,
        })

        this.beginRecordings(settings)
        this.armWatchdog()
        this.armFreePlanCap()
        this.run.saveTimer = setInterval(() => this.queueSavedCopy(), SAVED_COPY_INTERVAL_MS)
    }

    private endRun(): void {
        const run = this.run
        this.run = null
        this.restarting = false
        this.deps.keepAwake.stop().catch((err: unknown) => {
            console.warn('[listeningSession] Keep-awake release failed (non-fatal):', err)
        })
        if (!run) return
        if (run.watchdog) clearInterval(run.watchdog)
        if (run.capTimer) clearTimeout(run.capTimer)
        if (run.saveTimer) clearInterval(run.saveTimer)

        const { savedCopyDetails, track } = this.connections
        const detectedVerses = savedCopyDetails().detectedVerses
        track(AnalyticsEventType.SERMON_LISTENER_STOPPED, {
            duration_seconds: Math.round((Date.now() - run.startedAt) / 1000),
            verses_detected: detectedVerses.length,
            provider: this.snapshot.provider,
        })
        this.endRecordings(run, detectedVerses)
        // Save what was said since the last save.
        this.queueSavedCopy()
    }

    /** A start that never became a run holds nothing. */
    private releaseAfterFailedStart(): void {
        this.deps.keepAwake.stop().catch(() => {})
    }

    private beginRecordings(settings: ListeningConfig): void {
        const run = this.run!
        if (settings.recordSessions) {
            const sessionId = crypto.randomUUID()
            run.recordingId = sessionId
            void this.deps.archive.start(sessionId).then((path) => {
                if (path) return
                if (run.recordingId === sessionId) run.recordingId = null
                // The service carries on; say once that nothing is being
                // archived rather than let the operator find out weeks later.
                this.connections.notify({ type: 'recording-failed' })
            })
        }
        if (this.deps.devRecorder) {
            run.devRecording = true
            void this.deps.devRecorder.start()
        }
    }

    private endRecordings(run: Run, detectedVerses: DetectedVerse[]): void {
        const transcript = this.assembler.getSnapshot()
        if (run.recordingId) {
            const sessionId = run.recordingId
            const liveText = transcript.text.trim()
            // Keep the live transcript with the recording, so a later
            // re-transcription has something to be judged against.
            void this.deps.archive.stop().then(() => {
                if (!liveText) return
                void this.deps.archive.attachTranscript(sessionId, liveText).catch((err: unknown) => {
                    console.warn('[recordings] could not attach transcript:', err)
                })
            })
        }
        const dev = this.deps.devRecorder
        if (run.devRecording && dev) {
            void dev.stop().then((recorded) => {
                if (!recorded) return
                return dev.writeSidecar({
                    ...recorded,
                    stoppedAt: Date.now(),
                    liveDetectedVerses: detectedVerses,
                    rawUtterances: transcript.rawUtterances,
                }).then(() => {
                    this.update({ devRecordingsVersion: this.snapshot.devRecordingsVersion + 1 })
                })
            }).catch((err: unknown) => {
                console.warn('[listeningSession] Failed to write the dev session sidecar:', err)
            })
        }
    }

    /**
     * Recover from a capture that died silently. While listening, the audio
     * heartbeat flows even through silence; if it goes stale for a sustained
     * window after it was seen flowing, the capture has died and is restarted
     * — within the same run, keeping its recording, its clock and its
     * transcript.
     */
    private armWatchdog(): void {
        const run = this.run!
        let seenSignal = false
        let lastRecoveryAt = 0
        run.watchdog = setInterval(() => {
            if (this.restarting) return
            const { audioSignal } = this.deps
            if (!audioSignal.isStale(SIGNAL_FRESH_MS)) {
                seenSignal = true
                return
            }
            if (!seenSignal || !audioSignal.isStale(SIGNAL_DEAD_MS)) return
            const now = Date.now()
            if (now - lastRecoveryAt < RESTART_DEBOUNCE_MS) return
            lastRecoveryAt = now
            seenSignal = false
            console.warn('[listeningSession] Audio signal lost mid-run — restarting capture')
            void this.restartCapture()
        }, WATCHDOG_INTERVAL_MS)
    }

    private async restartCapture(): Promise<void> {
        const run = this.run
        if (!run) return
        this.restarting = true
        this.clearInterimTimer()
        this.assembler.clearInterim()
        this.connections.captureStopped()
        // Wait for the dead capture to finish stopping: the native engine
        // refuses, silently, to start while it is still draining.
        await this.engine().stop()
        await new Promise((r) => setTimeout(r, RESTART_GAP_MS))
        if (this.run !== run) return

        let started = false
        try {
            started = await this.startCapture(this.connections.config())
        } catch (err) {
            console.warn('[listeningSession] Restart failed:', err)
        }
        if (!started && this.run === run) {
            this.restarting = false
            this.update({
                status: 'idle',
                error: listeningError(
                    transcriptionErrorCodes.CAPTURE_STREAM_LOST,
                    'Listening stopped: the microphone stopped sending audio and could not be restarted.',
                    false,
                ),
            })
            this.endRun()
        }
    }

    /** The free plan stops a run at 40 minutes; Pro (decided when it fires) is unlimited. */
    private armFreePlanCap(): void {
        const run = this.run!
        run.capTimer = setTimeout(() => {
            if (this.run !== run || this.connections.config().isPro) return
            this.stop()
            this.connections.notify({ type: 'free-plan-limit' })
        }, FREE_RUN_LIMIT_MS)
    }

    // ----- the team's saved copy -------------------------------------------

    /**
     * Save the transcript for the team: every few minutes while listening and
     * once at each stop, one save at a time and in order, to one saved copy
     * per listening session. The sermon in progress is already kept on this
     * device as it comes, so this copy is for the team, not for safety.
     * What to save is taken now, not when its turn comes.
     */
    private queueSavedCopy(): void {
        const store = this.connections.transcripts
        if (!store) return
        const transcript = this.assembler.getSnapshot()
        const text = transcript.text
        const { detectedVerses, scheduleId } = this.connections.savedCopyDetails()
        const { language } = this.connections.config()
        const provider = this.snapshot.provider
        const title = this.title.trim() || `Sermon Transcript ${new Date().toLocaleDateString()}`
        const generation = this.sessionGeneration
        this.savedCopyChain = this.savedCopyChain.then(async () => {
            // Nothing new since the last save; or a clear has begun a new session.
            if (generation !== this.sessionGeneration || !text.trim() || text === this.lastSavedText) return
            const payload = { title, transcript: text, segments: transcript.segments, detectedVerses, scheduleId }
            try {
                const id = this.snapshot.savedTranscriptId
                if (!id) {
                    const created = await store.create({ ...payload, provider, language })
                    if (created && generation === this.sessionGeneration) this.update({ savedTranscriptId: created })
                } else {
                    await store.update(id, payload)
                }
                if (generation === this.sessionGeneration) this.lastSavedText = text
            } catch (err) {
                console.warn('[listeningSession] Saving the transcript failed; will retry:', err)
            }
        })
    }
}

export function createListeningSession(deps: ListeningSessionDeps, provider?: TranscriptionProvider): ListeningSession {
    return new ListeningSession(deps, provider)
}
