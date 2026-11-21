/**
 * The app's one listening session, wired to the real engines and side
 * effects. See listeningSession.ts for what it does.
 */

import { isDesktop } from '../../platform'
import { useAppStore } from '../../store/appStore'
import { saveSelectedDeviceLabel } from '../../hooks/useAudioDevices'
import { setSermonRecordingTranscript } from '../../hooks/useIndexedDB'
import { audioFeatures } from '../visualizer/audioFeatures'
import { audioFeedbackService } from './audioFeedback'
import { startKeepAwake, stopKeepAwake } from './keepAwake'
import { startRecording, stopRecording } from './sessionRecordings'
import { sessionAudioRecorder } from './sessionAudioRecorder'
import { writeSessionSidecar } from './devAccuracyReport'
import { songTraceSince } from './songTrace'
import { transcriptionEngines } from './engines'
import { createListeningSession, type ListeningSession, type ListeningSessionDeps } from './listeningSession'

const SCREEN_CAPTURE_REFUSED =
    'Selah needs Screen & System Audio Recording permission to capture system audio. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Selah, then restart the app.'

export function appListeningSessionDeps(): ListeningSessionDeps {
    return {
        engines: transcriptionEngines,
        keepAwake: { start: startKeepAwake, stop: stopKeepAwake },
        chime: {
            start: () => audioFeedbackService.playStart(),
            stop: () => audioFeedbackService.playStop(),
        },
        archive: {
            start: startRecording,
            stop: stopRecording,
            attachTranscript: setSermonRecordingTranscript,
        },
        devRecorder: import.meta.env.DEV
            ? {
                start: () => sessionAudioRecorder.start(),
                stop: async () => {
                    // Read before stop(), which clears both once it resolves.
                    const sessionId = sessionAudioRecorder.getSessionId()
                    const startedAt = sessionAudioRecorder.getStartedAt()
                    await sessionAudioRecorder.stop()
                    return sessionId && startedAt ? { sessionId, startedAt } : null
                },
                // The song follower's decisions ride along, so a recorded
                // service can be replayed to see why a slide didn't move.
                writeSidecar: (sidecar) =>
                    writeSessionSidecar({ ...sidecar, songTrace: songTraceSince(sidecar.startedAt) }),
            }
            : null,
        // System-audio capture on desktop runs through the OS screen-recording
        // permission (macOS: "Screen & System Audio Recording"). That prompt is
        // shown only ONCE — after a decline, macOS never prompts again and
        // ScreenCaptureKit fails silently. So ask up front, and if it's still
        // refused, route the operator to Settings instead of starting a
        // capture that will die with no signal.
        capturePermission: async (source) => {
            if (!isDesktop() || source !== 'system') return null
            try {
                const { invoke } = await import('@tauri-apps/api/core')
                let granted = await invoke<boolean>('check_screen_capture_permission')
                if (!granted) granted = await invoke<boolean>('request_screen_capture_permission')
                return granted ? null : SCREEN_CAPTURE_REFUSED
            } catch (err) {
                // Non-fatal (an IPC hiccup): let the capture attempt surface
                // any real error itself.
                console.warn('[listeningSession] Screen capture permission check failed:', err)
                return null
            }
        },
        // Unlock audio before capture, so a VAD's own AudioContext can resume.
        unlockAudio: async () => {
            try {
                const ctx = new AudioContext()
                if (ctx.state === 'suspended') await ctx.resume()
                await ctx.close()
            } catch (e) {
                console.warn('[listeningSession] AudioContext unlock failed:', e)
            }
        },
        audioSignal: { isStale: (ms) => audioFeatures.isStale(ms) },
        forgetMicrophone: () => {
            const store = useAppStore.getState()
            const sermon = store.settings.sermonListener
            if (sermon?.selectedMicrophoneId) {
                store.setAppSettings({
                    ...store.settings,
                    sermonListener: {
                        ...sermon,
                        selectedMicrophoneId: undefined,
                        // The channel described the old interface, not this one.
                        inputChannel: undefined,
                    },
                })
            }
            saveSelectedDeviceLabel(null)
        },
    }
}

let session: ListeningSession | null = null

export function getListeningSession(): ListeningSession {
    if (!session) {
        const provider = typeof window !== 'undefined' && '__TAURI__' in window ? 'native' : 'web-speech'
        session = createListeningSession(appListeningSessionDeps(), provider)
    }
    return session
}

/** Tests only: the next getListeningSession() makes a fresh one. */
export function resetListeningSessionForTests(): void {
    session = null
}
