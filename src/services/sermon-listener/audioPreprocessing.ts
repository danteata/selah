/**
 * Audio Preprocessing Utilities
 *
 * Highpass filter (85 Hz, Q=0.7) and +3 dB gain applied to audio before
 * sending to Whisper. Removes low-frequency rumble (HVAC, stage vibration,
 * handling noise) and boosts speech level for better transcription accuracy.
 *
 * Two implementations:
 * - Float32Array processing (for VAD-captured audio, applied before WAV encoding)
 * - Web Audio nodes (for the worklet-based capture path)
 *
 * Filter design: 2nd-order Butterworth highpass at 85 Hz (Q=0.707)
 * Coefficients computed for 16 kHz sample rate.
 */

// +3 dB ≈ linear gain of ~1.4125
const SPEECH_GAIN = Math.pow(10, 3 / 20) // ~1.4125

// 2nd-order Butterworth highpass at 85 Hz, Q=0.707 for 16 kHz sample rate
// Transfer function H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
const HP_85Hz_16kHz = {
    b0: 0.9443516179571823,
    b1: -1.8887032359143647,
    b2: 0.9443516179571823,
    a1: -1.8891530210580773,
    a2: 0.888253450770652,
}

// 2nd-order Butterworth highpass at 85 Hz, Q=0.707 for 48 kHz sample rate
// (used when we don't know the exact rate; close enough for anti-rumble)
const HP_85Hz_48kHz = {
    b0: 0.9885495390489216,
    b1: -1.9770990780978431,
    b2: 0.9885495390489216,
    a1: -1.9771462858973206,
    a2: 0.977051270198368,
}

/**
 * Apply highpass filter and gain to a Float32Array of PCM samples.
 * Processes in-place. Returns the same array for convenience.
 *
 * Uses a direct-form-II transposed IIR filter (same structure as Web Audio BiquadFilterNode).
 */
export function applyPreprocessing(samples: Float32Array, sampleRate: number = 16000): Float32Array {
    const coeffs = sampleRate <= 22050 ? HP_85Hz_16kHz : HP_85Hz_48kHz
    const { b0, b1, b2, a1, a2 } = coeffs

    // Direct Form II Transposed state
    let d1 = 0
    let d2 = 0

    for (let i = 0; i < samples.length; i++) {
        const input = samples[i]
        const output = b0 * input + d1
        d1 = b1 * input - a1 * output + d2
        d2 = b2 * input - a2 * output
        samples[i] = output * SPEECH_GAIN
    }

    return samples
}

/**
 * Create Web Audio BiquadFilter + Gain nodes for inline audio preprocessing.
 * Connects: source → highpass → gain → destination.
 *
 * Returns the gain node so the caller can connect it to the next node.
 */
export function createPreprocessingNodes(
    audioContext: AudioContext,
    sampleRate?: number
): { highpass: BiquadFilterNode; gain: GainNode } {
    const highpass = audioContext.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 85
    highpass.Q.value = 0.707

    const gain = audioContext.createGain()
    gain.gain.value = SPEECH_GAIN

    return { highpass, gain }
}

/**
 * Connect a source node through the preprocessing chain.
 * source → highpass → gain → destination
 *
 * Returns the final gain node for further chaining.
 */
export function connectPreprocessingChain(
    source: AudioNode,
    audioContext: AudioContext
): GainNode {
    const { highpass, gain } = createPreprocessingNodes(audioContext)
    source.connect(highpass)
    highpass.connect(gain)
    gain.connect(audioContext.destination)
    return gain
}