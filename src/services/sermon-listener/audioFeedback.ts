/**
 * Audio feedback chimes for the sermon listener.
 *
 * Plays a short rising two-tone cue when listening starts and a falling cue
 * when it stops, so the operator gets an unmistakable confirmation without
 * watching the screen. Inspired by Handy's `audio_feedback.rs`, but synthesised
 * with the Web Audio API (oscillator + gain envelope) so it needs no bundled
 * sound assets and works identically in the browser and the desktop webview.
 *
 * The enabled flag is persisted in localStorage (per-operator, local) and
 * defaults to on. Gracefully no-ops where Web Audio is unavailable (e.g. SSR
 * or test environments).
 */

const STORAGE_KEY = 'selah:sermonAudioFeedback'

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | null {
    if (typeof window === 'undefined') return null
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
    return w.AudioContext ?? w.webkitAudioContext ?? null
}

function readPersisted(): boolean {
    try {
        if (typeof localStorage === 'undefined') return true
        const v = localStorage.getItem(STORAGE_KEY)
        return v === null ? true : v === 'true'
    } catch {
        return true
    }
}

/** A single tone in a chime: frequency (Hz), start offset and duration (s). */
interface Tone {
    freq: number
    start: number
    duration: number
}

// Rising perfect-fifth (C5 → G5): "listening on".
const START_CHIME: Tone[] = [
    { freq: 523.25, start: 0, duration: 0.12 },
    { freq: 783.99, start: 0.1, duration: 0.16 },
]

// Falling fifth (G5 → C5): "listening off".
const STOP_CHIME: Tone[] = [
    { freq: 783.99, start: 0, duration: 0.12 },
    { freq: 523.25, start: 0.1, duration: 0.16 },
]

class AudioFeedbackService {
    private enabled: boolean = readPersisted()
    private ctx: AudioContext | null = null
    /** Peak gain of each tone (0–1). Kept low so the cue isn't startling. */
    private volume = 0.12

    isEnabled(): boolean {
        return this.enabled
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled
        try {
            localStorage?.setItem(STORAGE_KEY, String(enabled))
        } catch {
            /* persistence is best-effort */
        }
    }

    setVolume(volume: number): void {
        this.volume = Math.max(0, Math.min(1, volume))
    }

    /** Play the start cue. No-op when disabled or Web Audio is unavailable. */
    playStart(): void {
        this.play(START_CHIME)
    }

    /** Play the stop cue. No-op when disabled or Web Audio is unavailable. */
    playStop(): void {
        this.play(STOP_CHIME)
    }

    private ensureContext(): AudioContext | null {
        if (this.ctx) return this.ctx
        const Ctor = getAudioContextCtor()
        if (!Ctor) return null
        try {
            this.ctx = new Ctor()
        } catch {
            this.ctx = null
        }
        return this.ctx
    }

    private play(tones: Tone[]): void {
        if (!this.enabled) return
        const ctx = this.ensureContext()
        if (!ctx) return

        try {
            // Autoplay policies can leave the context suspended until a gesture;
            // resume() is a no-op if already running.
            if (ctx.state === 'suspended') void ctx.resume()

            const now = ctx.currentTime
            for (const tone of tones) {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = 'sine'
                osc.frequency.value = tone.freq

                const startAt = now + tone.start
                const endAt = startAt + tone.duration
                // Quick attack, smooth exponential release — avoids clicks.
                gain.gain.setValueAtTime(0.0001, startAt)
                gain.gain.exponentialRampToValueAtTime(this.volume, startAt + 0.012)
                gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.start(startAt)
                osc.stop(endAt + 0.02)
            }
        } catch {
            /* never let a UI cue break the listening flow */
        }
    }
}

export const audioFeedbackService = new AudioFeedbackService()
export default audioFeedbackService
