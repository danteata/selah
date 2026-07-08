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

/**
 * Start listening for native audio features. No-op off desktop (returns a
 * no-op unsubscribe). `onRms` is called with each frame's overall level (0..1)
 * so callers can drive a level meter from the same signal.
 */
export async function startNativeAudioFeatures(
    onRms?: (rms: number) => void,
): Promise<UnlistenFn> {
    if (!isDesktop()) return () => {}
    return listen<AudioFeatures>('audio-features', (event) => {
        const f = event.payload
        audioFeatures.publishFeatures(f)
        onRms?.(f.rms)
    })
}
