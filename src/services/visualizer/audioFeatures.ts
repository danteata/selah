/**
 * Audio feature extraction + a decoupled bus for the audio-reactive visualizer
 * (Phase 4).
 *
 * The sermon listener already runs an `AnalyserNode` over the live audio to
 * drive its level meter. Rather than open a second audio stream (which is
 * awkward on desktop, where capture lives in Rust), the listener publishes its
 * per-frame frequency data here, and the visualizer reads the latest features
 * in its own `requestAnimationFrame` loop. This keeps the visual layer fully
 * decoupled from the transcription/lyrics pipeline, exactly as the plan calls
 * for — the two never block each other.
 *
 * ## Staying in sync with the music
 *
 * Everything between the microphone and the pixel adds latency: the analyser's
 * FFT window, the desktop emit throttle + IPC hop, and the visual's own
 * easing. Left uncompensated that lands the "punch" 150-250 ms after the kick
 * the audience actually heard, which reads as *not* being in time with the
 * song. Three things here fix that:
 *
 *  1. **Bands are defined in Hz, not as fractions of the spectrum**
 *     ({@link bandsForSampleRate}). A fraction-based split makes "bass" mean
 *     everything under ~3.5 kHz at a 48 kHz sample rate, so the beat detector
 *     was really watching general vocal energy rather than the kick.
 *  2. **Beat detection is time-based, not frame-based** — a fast/slow envelope
 *     pair with real time constants, so a 30 fps desktop feed and a 60 fps web
 *     feed behave identically instead of the desktop one adapting half as fast.
 *  3. **The pulse is latency-compensated and tempo-predictive**
 *     ({@link AudioFeatureBus.beatPulse}). Callers report their pipeline
 *     latency via {@link AudioFeatureBus.setPipelineLatency}; once the tempo is
 *     locked, the pulse fires on the *predicted* beat that much early, so the
 *     visual lands with the beat instead of behind it.
 */

export interface AudioFeatures {
    /** Overall loudness, 0..1. */
    rms: number
    /** Low-frequency energy (kick/bass), 0..1 — good for pulses. */
    bass: number
    /** Mid-frequency energy (vocals/instruments), 0..1. */
    mid: number
    /** High-frequency energy (cymbals/air), 0..1 — good for sparkle. */
    treble: number
}

export const ZERO_FEATURES: AudioFeatures = { rms: 0, bass: 0, mid: 0, treble: 0 }

export interface BandRanges {
    /** Fraction [0..1] of the spectrum where bass starts (skips DC/rumble). */
    bassStart?: number
    /** Fraction [0..1] of the spectrum where bass ends. */
    bassEnd: number
    /** Fraction where mids end (treble runs from here to `trebleEnd`). */
    midEnd: number
    /** Fraction where treble ends. Defaults to 1 (Nyquist). */
    trebleEnd?: number
}

export const DEFAULT_BANDS: BandRanges = { bassEnd: 0.15, midEnd: 0.6 }

/** Band edges in Hz. Chosen for worship-band material: the kick/bass guitar
 *  fundamental sits under ~160 Hz, voices and most instruments in the mids,
 *  and cymbals/air above 2 kHz. Anything above `trebleHz` is deliberately
 *  excluded — a mic-captured (or 16 kHz-resampled) signal has essentially no
 *  content up there, so including it only drags every band's average down. */
export const BAND_EDGES_HZ = { bassStartHz: 25, bassHz: 160, midHz: 2000, trebleHz: 9000 }

/**
 * Convert {@link BAND_EDGES_HZ} into spectrum fractions for a given context
 * sample rate. An `AnalyserNode`'s bins span 0..(sampleRate / 2), so the
 * fraction for a cutoff is `hz / (sampleRate / 2)`.
 *
 * Without this the band split is meaningless: at 48 kHz the fraction-based
 * {@link DEFAULT_BANDS} puts everything below 3.6 kHz in "bass" and gives
 * "treble" the 14.4-24 kHz dead zone, which reads as a flat zero forever.
 */
export function bandsForSampleRate(sampleRate: number): BandRanges {
    const nyquist = Math.max(1, sampleRate / 2)
    const frac = (hz: number) => clamp01(hz / nyquist)
    const bassStart = frac(BAND_EDGES_HZ.bassStartHz)
    const bassEnd = Math.max(bassStart + 1e-6, frac(BAND_EDGES_HZ.bassHz))
    const midEnd = Math.max(bassEnd + 1e-6, frac(BAND_EDGES_HZ.midHz))
    const trebleEnd = Math.max(midEnd + 1e-6, frac(BAND_EDGES_HZ.trebleHz))
    return { bassStart, bassEnd, midEnd, trebleEnd }
}

function mean(data: ArrayLike<number>, from: number, to: number): number {
    if (to <= from) return 0
    let sum = 0
    for (let i = from; i < to; i++) sum += data[i]
    return sum / (to - from)
}

/**
 * Extract normalized band energies from a byte frequency array
 * (`AnalyserNode.getByteFrequencyData`, values 0..255).
 *
 * Bands are given as fractions of the spectrum so this works for any
 * `fftSize`; pass {@link bandsForSampleRate} to get frequency-accurate edges.
 * Returns all-zero for an empty array.
 */
export function extractBands(freq: ArrayLike<number>, bands: BandRanges = DEFAULT_BANDS): AudioFeatures {
    const n = freq.length
    if (n === 0) return { ...ZERO_FEATURES }

    const lo = Math.min(n - 1, Math.max(0, Math.round(n * (bands.bassStart ?? 0))))
    const bassEnd = Math.min(n, Math.max(lo + 1, Math.round(n * bands.bassEnd)))
    const midEnd = Math.min(n, Math.max(bassEnd + 1, Math.round(n * bands.midEnd)))
    const hi = Math.min(n, Math.max(midEnd + 1, Math.round(n * (bands.trebleEnd ?? 1))))

    const bass = mean(freq, lo, bassEnd) / 255
    const mid = mean(freq, bassEnd, midEnd) / 255
    const treble = mean(freq, midEnd, hi) / 255

    // RMS across the audible span only (energy, not just average) — including
    // the empty top of the spectrum would understate every level.
    let sq = 0
    for (let i = lo; i < hi; i++) sq += freq[i] * freq[i]
    const rms = Math.sqrt(sq / Math.max(1, hi - lo)) / 255

    return {
        rms: clamp01(rms),
        bass: clamp01(bass),
        mid: clamp01(mid),
        treble: clamp01(treble),
    }
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v
}

/** A single-frame timestamp source that is safe in tests and the browser. */
function now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0
}

/**
 * Process-wide singleton the analyser writes to and the visualizer reads from.
 * Intentionally not React state — updating at ~60fps through the store/context
 * would thrash re-renders. The visualizer reads `.current` in its rAF loop.
 */
/** How fast a detected beat's pulse decays back to 0 (see `beatPulse` getter). */
const BEAT_DECAY_TAU_MS = 130
/** Minimum time between two detected beats, so one hit can't double-trigger.
 *  200 ms ≈ 300 BPM, above any worship tempo. */
const BEAT_REFRACTORY_MS = 200
/** How far above the slow (baseline) bass envelope a sample must sit to be a
 *  beat candidate. Measured against the *slow* envelope so a kick still stands
 *  out during a loud sustained passage — the baseline has risen with the music,
 *  and the kick still has to beat it. */
const BEAT_THRESHOLD_RATIO = 1.3
/** How far above the *fast* envelope the incoming sample must sit — i.e. how
 *  much new energy this frame actually brought. The ratio test alone treats a
 *  step up to a new sustained level as a run of beats, because the slow
 *  baseline needs a few hundred ms to catch up and every frame in between looks
 *  loud relative to it. This gate is what distinguishes "a hit just landed"
 *  from "we are now simply louder than we were": once the level plateaus the
 *  fast envelope reaches it and the flux collapses to ~0. */
const BEAT_MIN_FLUX = 0.06
/** Noise floor — a "peak" quieter than this is ignored (silence/hiss). Tuned
 *  for a true 25-160 Hz band, which is much quieter than the old
 *  everything-under-3.5 kHz "bass" this replaced. */
const BEAT_MIN_BASS = 0.05
/** Envelope time constants for the fast (transient) / slow (baseline) pair. */
const BEAT_FAST_TAU_MS = 45
const BEAT_SLOW_TAU_MS = 420
/** Beats kept for the tempo estimate. */
const TEMPO_HISTORY = 6
/** Inter-beat intervals within this relative spread count as a locked tempo. */
const TEMPO_TOLERANCE = 0.14
/** Plausible worship-tempo range for the interval estimate (40-220 BPM). */
const TEMPO_MIN_MS = 272
const TEMPO_MAX_MS = 1500

class AudioFeatureBus {
    current: AudioFeatures = { ...ZERO_FEATURES }
    /** Monotonic count of detected beats. Consumers that must act exactly once
     *  per beat (rather than on every frame where the pulse happens to be high)
     *  should latch on a change to this — see `KineticText`. */
    beatCount = 0

    private lastPublishMs = 0
    /** Measured end-to-end latency between the sound and this bus being
     *  updated. Set per platform via {@link setPipelineLatency}. */
    private pipelineLatencyMs = 0

    // Onset detector: fast vs slow bass envelope, both with real time
    // constants so the behaviour is identical at 30 fps (desktop IPC feed) and
    // 60 fps (web analyser feed).
    private fastBass = 0
    private slowBass = 0
    private lastFrameMs = 0
    private lastBeatMs = 0
    /** Recent inter-beat intervals (ms), newest last. */
    private intervals: number[] = []
    /** Locked tempo interval in ms, or 0 when the tempo isn't stable. */
    private tempoMs = 0

    /**
     * Report the pipeline latency (ms) between the sound reaching the mic and
     * `publish`/`publishFeatures` being called with it — analyser window +
     * emit throttle + IPC. Used to fire the beat pulse that much early once a
     * tempo is locked, so the visual lands *with* the beat.
     */
    setPipelineLatency(ms: number): void {
        this.pipelineLatencyMs = Math.max(0, Math.min(300, ms))
    }

    /** Called by the analyser each frame with raw byte frequency data. */
    publish(freq: ArrayLike<number>, bands?: BandRanges): void {
        this.current = extractBands(freq, bands)
        this.lastPublishMs = now()
        this.detectBeat(this.current.bass)
    }

    /**
     * Publish already-computed features. Used on desktop, where the native
     * (Rust) capture loop computes band energies and forwards them — there is
     * no JS-side MediaStream/AnalyserNode to run {@link extractBands} on.
     *
     * `silent: true` marks a keep-alive frame emitted because no audio samples
     * arrived this tick (a device hiccup or loopback stall), NOT because the
     * room is quiet — real silence still delivers near-zero samples. Such a
     * frame refreshes liveness for the capture watchdog but must not overwrite
     * the features with hard zeros: doing so both stutters the visual and, far
     * worse, collapses the onset detector's baseline so the next real frame
     * reads as a huge transient and fires a phantom beat.
     */
    publishFeatures(features: AudioFeatures, opts?: { silent?: boolean }): void {
        this.lastPublishMs = now()
        if (opts?.silent) return
        this.current = {
            rms: clamp01(features.rms),
            bass: clamp01(features.bass),
            mid: clamp01(features.mid),
            treble: clamp01(features.treble),
        }
        this.detectBeat(this.current.bass)
    }

    /**
     * Onset detection by fast/slow envelope divergence. Both envelopes use
     * time-based smoothing (`1 - exp(-dt/tau)`) rather than a fixed per-frame
     * coefficient, so the detector's memory is measured in milliseconds of
     * audio and not in however many frames the current platform happens to
     * deliver.
     */
    private detectBeat(bass: number): void {
        const t = now()
        const dt = this.lastFrameMs === 0 ? 0 : Math.max(0, Math.min(500, t - this.lastFrameMs))
        this.lastFrameMs = t

        if (dt === 0) {
            // First frame after a reset: seed both envelopes so the very first
            // sample can't look like a transient against a zeroed baseline.
            this.fastBass = bass
            this.slowBass = bass
            return
        }

        const aFast = 1 - Math.exp(-dt / BEAT_FAST_TAU_MS)
        const aSlow = 1 - Math.exp(-dt / BEAT_SLOW_TAU_MS)
        // How much energy this frame brought over the short-term envelope, taken
        // before the envelope absorbs it.
        const flux = bass - this.fastBass
        this.fastBass += (bass - this.fastBass) * aFast
        this.slowBass += (bass - this.slowBass) * aSlow

        const isOnset =
            bass > this.slowBass * BEAT_THRESHOLD_RATIO &&
            bass > BEAT_MIN_BASS &&
            flux > BEAT_MIN_FLUX &&
            t - this.lastBeatMs > BEAT_REFRACTORY_MS
        if (!isOnset) return

        if (this.lastBeatMs > 0) this.recordInterval(t - this.lastBeatMs)
        this.lastBeatMs = t
        this.beatCount++
    }

    /** Maintain the rolling tempo estimate used to predict the next beat. */
    private recordInterval(interval: number): void {
        if (interval < TEMPO_MIN_MS || interval > TEMPO_MAX_MS) {
            // Out of plausible range (a missed beat, or a detection on noise) —
            // the tempo hypothesis is no longer trustworthy.
            this.intervals = []
            this.tempoMs = 0
            return
        }
        this.intervals.push(interval)
        if (this.intervals.length > TEMPO_HISTORY) this.intervals.shift()
        if (this.intervals.length < 3) {
            this.tempoMs = 0
            return
        }
        const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length
        const stable = this.intervals.every((i) => Math.abs(i - mean) / mean <= TEMPO_TOLERANCE)
        this.tempoMs = stable ? mean : 0
    }

    /** Locked tempo in BPM, or 0 when the beat isn't steady enough to predict. */
    get bpm(): number {
        return this.tempoMs > 0 ? 60000 / this.tempoMs : 0
    }

    /**
     * 0..1, spikes to 1 on the beat and exponentially decays back to 0.
     * Computed on read (not stored/ticked) so every consumer's own rAF loop
     * sees a smooth decay regardless of how often `publish`/`publishFeatures`
     * actually arrive.
     *
     * Two corrections keep it *in time with the room* rather than with our own
     * pipeline:
     *  - the reference time is shifted back by {@link setPipelineLatency}, so
     *    the pulse reflects when the beat was actually heard, not when we
     *    finished analysing it;
     *  - once a tempo is locked, the *next* beat is anticipated at
     *    `lastBeat + tempo - latency`, which is what actually cancels the
     *    latency (and rides through a single missed detection). Anticipation is
     *    capped at one beat past the last real detection so a song ending
     *    doesn't leave the visual pulsing on its own forever.
     */
    get beatPulse(): number {
        if (this.lastBeatMs === 0) return 0
        const t = now()
        let ref = this.lastBeatMs - this.pipelineLatencyMs
        if (this.tempoMs > 0) {
            const predicted = this.lastBeatMs + this.tempoMs - this.pipelineLatencyMs
            const withinOneBeat = t - this.lastBeatMs < this.tempoMs * 2
            if (t >= predicted && withinOneBeat) ref = predicted
        }
        const age = t - ref
        if (age < 0) return 0
        return Math.exp(-age / BEAT_DECAY_TAU_MS)
    }

    /** Clear features (e.g. when the listener stops). */
    reset(): void {
        this.current = { ...ZERO_FEATURES }
        this.lastPublishMs = 0
        this.fastBass = 0
        this.slowBass = 0
        this.lastFrameMs = 0
        this.lastBeatMs = 0
        this.beatCount = 0
        this.intervals = []
        this.tempoMs = 0
    }

    /** True when no fresh audio has arrived recently, so the visual can fade. */
    isStale(staleMs = 400): boolean {
        if (this.lastPublishMs === 0) return true
        return now() - this.lastPublishMs > staleMs
    }
}

export const audioFeatures = new AudioFeatureBus()
