import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktop } from '@/platform'
import { audioFeatures, type AudioFeatures } from './audioFeatures'

/**
 * Desktop bridge for the audio-reactive visualizer.
 *
 * On desktop, audio is captured natively in Rust and there is no JS-side
 * MediaStream to run an AnalyserNode on — especially for system-audio loopback.
 * The Rust capture loop instead emits a throttled `audio-features` event; this
 * subscribes to it and publishes the values into the shared {@link audioFeatures}
 * bus (and optionally reports the RMS for the level meter), so the visualizer
 * and meter work for both microphone and system loopback without a second,
 * duplicate getUserMedia stream.
 */

/** The event carries one extra field the shared bus type doesn't: `silent`
 *  marks a keep-alive frame emitted because no samples arrived this tick (a
 *  device/loopback hiccup) rather than because the room went quiet. See
 *  `AudioFeatureBus.publishFeatures`. */
type AudioFeaturesEvent = AudioFeatures & { silent?: boolean; onset_ago_ms?: number | null }

/**
 * Latency between a kick in the room and the webview hearing of it, beyond
 * what the native detector already measures. Each event's `onset_ago_ms` dates
 * the beat within the audio the capture loop has processed, so what is left is
 * the path *into* that loop: the sound card's buffer (~10 ms), the microphone
 * ring and the VAD loop each drained every 10 ms (~5 ms each on average), the
 * resampler's filter delay (~5 ms), and the IPC hop (~3 ms). Reported to the
 * bus so a locked tempo fires the pulse that much early.
 *
 * Was 55 ms when beats were detected here from 33 ms band-level windows; ~16 ms
 * of that was the window averaging the native detector no longer has.
 */
const NATIVE_PIPELINE_LATENCY_MS = 30

/**
 * Start listening for native audio features. No-op off desktop (returns a
 * no-op unsubscribe). `onRms` is called with each frame's overall level (0..1)
 * so callers can drive a level meter from the same signal.
 */
export async function startNativeAudioFeatures(
    onRms?: (rms: number) => void,
): Promise<UnlistenFn> {
    if (!isDesktop()) return () => {}
    audioFeatures.setPipelineLatency(NATIVE_PIPELINE_LATENCY_MS)
    return listen<AudioFeaturesEvent>('audio-features', (event) => {
        const f = event.payload
        audioFeatures.publishFeatures(f, { silent: f.silent === true, onsetAgoMs: f.onset_ago_ms })
        // A keep-alive frame carries no real level — reporting its zero would
        // make the meter flicker to empty on every upstream hiccup.
        if (f.silent !== true) onRms?.(f.rms)
    })
}
