/** The app's transcription engines, one of each. See transcriptionEngine.ts. */

import type { TranscriptionEngine, TranscriptionProvider } from './transcriptionEngine'
import { createWebSpeechEngine } from './webSpeechEngine'
import { createNativeEngine } from './nativeEngine'

export const transcriptionEngines: Record<TranscriptionProvider, TranscriptionEngine> = {
    'web-speech': createWebSpeechEngine(),
    native: createNativeEngine(),
}
