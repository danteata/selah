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
type AudioFeaturesEvent = AudioFeatures & { silent?: boolean }

/**
 * End-to-end latency of the native feature path: the Rust loop computes over a
 * window up to the emit interval long (~33 ms, so ~16 ms of averaging lag on
 * average) plus the Tauri IPC hop and the webview's event dispatch. Reported to
 * the bus so the beat pulse can be fired that much early once the tempo locks —
 * otherwise every punch lands visibly behind the kick that caused it.
 */
const NATIVE_PIPELINE_LATENCY_MS = 55

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
        audioFeatures.publishFeatures(f, { silent: f.silent === true })
        // A keep-alive frame carries no real level — reporting its zero would
        // make the meter flicker to empty on every upstream hiccup.
        if (f.silent !== true) onRms?.(f.rms)
    })
}
