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
    /** Fraction [0..1] of the spectrum where bass ends. */
    bassEnd: number
    /** Fraction where mids end (treble runs from here to 1). */
    midEnd: number
}

export const DEFAULT_BANDS: BandRanges = { bassEnd: 0.15, midEnd: 0.6 }

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
 * Bands are split by fraction of the spectrum so it works for any `fftSize`.
 * Returns all-zero for an empty array.
 */
export function extractBands(freq: ArrayLike<number>, bands: BandRanges = DEFAULT_BANDS): AudioFeatures {
    const n = freq.length
    if (n === 0) return { ...ZERO_FEATURES }

    const bassEnd = Math.max(1, Math.round(n * bands.bassEnd))
    const midEnd = Math.max(bassEnd + 1, Math.round(n * bands.midEnd))

    const bass = mean(freq, 0, bassEnd) / 255
    const mid = mean(freq, bassEnd, midEnd) / 255
    const treble = mean(freq, midEnd, n) / 255

    // RMS across the whole spectrum (energy, not just average).
    let sq = 0
    for (let i = 0; i < n; i++) sq += freq[i] * freq[i]
    const rms = Math.sqrt(sq / n) / 255

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
class AudioFeatureBus {
    current: AudioFeatures = { ...ZERO_FEATURES }
    private lastPublishMs = 0

    /** Called by the analyser each frame with raw byte frequency data. */
    publish(freq: ArrayLike<number>, bands?: BandRanges): void {
        this.current = extractBands(freq, bands)
        this.lastPublishMs = now()
    }

    /**
     * Publish already-computed features. Used on desktop, where the native
     * (Rust) capture loop computes band energies and forwards them — there is
     * no JS-side MediaStream/AnalyserNode to run {@link extractBands} on.
     */
    publishFeatures(features: AudioFeatures): void {
        this.current = {
            rms: clamp01(features.rms),
            bass: clamp01(features.bass),
            mid: clamp01(features.mid),
            treble: clamp01(features.treble),
        }
        this.lastPublishMs = now()
    }

    /** Clear features (e.g. when the listener stops). */
    reset(): void {
        this.current = { ...ZERO_FEATURES }
        this.lastPublishMs = 0
    }

    /** True when no fresh audio has arrived recently, so the visual can fade. */
    isStale(staleMs = 400): boolean {
        if (this.lastPublishMs === 0) return true
        return now() - this.lastPublishMs > staleMs
    }
}

export const audioFeatures = new AudioFeatureBus()
