# Selah Transcription Improvement Plan

## Implementation Status (as of 2026-05-27)

| Phase | Item | Status | Files Changed |
|-------|------|--------|---------------|
| 1.1 | Timestamped transcript storage | ✅ Done | `src/types/sermon-listener.ts`, `convex/schema.ts`, `convex/transcripts.ts`, `src/hooks/useTranscripts.ts`, `src/hooks/useSermonListener.ts` |
| 1.2 | VAD timestamp offset correction | ✅ Done | `src-tauri/src/audio_capture/mod.rs`, `src/services/sermon-listener/nativeVadCapture.ts`, `src/services/sermon-listener/nativeAudioCapture.ts`, `src/services/sermon-listener/desktopWhisperTranscription.ts` |
| 1.3 | Whisper sidecar crash recovery | ✅ Done | `src/services/sermon-listener/desktopWhisperService.ts` |
| 1.4 | Keep-awake during recording | ✅ Done | `src/services/sermon-listener/keepAwake.ts`, `src/hooks/useSermonListener.ts` |
| 1.5 | Audio device persistence | ✅ Done | `src/hooks/useAudioDevices.ts`, `src/components/sermon-listener/SermonListenerSettings.tsx` |
| 2.1 | Fix double getUserMedia | ✅ Done | `src/hooks/useSermonListener.ts`, `src/services/sermon-listener/desktopWhisperTranscription.ts` |
| 2.2 | Real-time audio preprocessing | ✅ Done | `src/services/sermon-listener/audioPreprocessing.ts`, `src/services/sermon-listener/desktopWhisperTranscription.ts`, `src-tauri/src/audio_capture/types.rs` |
| 2.4 | Chunk drop rate visibility | ✅ Done | `src/services/sermon-listener/desktopWhisperTranscription.ts`, `src/hooks/useSermonListener.ts`, `src/components/sermon-listener/SermonListenerPanel.tsx` |
| 3.1 | Structured error codes | ✅ Done | `src/services/sermon-listener/transcriptionErrors.ts` |
| 3.2 | Transcript export formats | ✅ Done | `src/services/sermon-listener/transcriptExport.ts` |
| 4.1 | ndjson streaming | ✅ Done | `src-tauri/binaries/whisper-server.py`, `src/services/sermon-listener/desktopWhisperService.ts`, `src/services/sermon-listener/desktopWhisperTranscription.ts`, `src/services/sermon-listener/unifiedTranscription.ts`, `src/hooks/useSermonListener.ts` |
| 4.2 | Crash recovery + file logging | ✅ Done | `src-tauri/Cargo.toml`, `src-tauri/src/logging.rs`, `src-tauri/src/main.rs`, `src/services/logging.ts`, `src/services/sermon-listener/index.ts` |
| 4.3 | Worklet consolidation | ⬜ Pending | — |
| — | Reference context for bare verses | ✅ Done | `src/services/sermon-listener/referenceContext.ts`, `src/hooks/useSermonListener.ts` |
| — | Voice command nav live slide fallback | ✅ Done | `src/hooks/useSermonListener.ts` |
| — | Hallucination filter accent corrections | ✅ Done | `src/services/sermon-listener/hallucinationFilter.ts` |
| 5.2 | VAD CDN removal | ⬜ Future | — |
| 5.3 | Audio recording to file | ⬜ Future | — |
| 5.4 | Audio device hot-swap | ⬜ Future | — |

---

Derived from a detailed review of [Vibe](https://github.com/thewh1teagle/vibe) (Tauri + whisper.cpp desktop transcription app) patterns, adapted to Selah's dual web/desktop architecture and sermon-specific requirements.

---

## Current State Summary

Selah already has several capabilities the original plan incorrectly assumed were missing:

| Capability | Status | Location |
|------------|--------|----------|
| VAD (Silero) | **Exists** — Rust ONNX (`vad.rs`) + browser `@ricky0123/vad-web` | `src-tauri/src/audio_capture/vad.rs`, `desktopWhisperTranscription.ts:338-441` |
| Audio device picker | **Exists** — browser + native enumeration | `useAudioDevices.ts`, `SermonListenerSettings.tsx:114-143` |
| Native audio capture | **Exists** — `cpal`-based with VAD event delivery | `src-tauri/src/audio_capture/`, `nativeVadCapture.ts` |
| Audio visualizer | **Exists** — 8-bar equalizer | `useSermonListener.ts:382-474`, `SermonListenerPanel.tsx:318-343` |
| Hallucination filter | **Exists** — regex-based | `hallucinationFilter.ts` |

**Critical gaps** that do NOT exist:

- Timestamped transcript storage (transcript is plain string, no per-segment timestamps)
- VAD timestamp offset correction (whisper timestamps are relative to segment, not sermon timeline)
- Keep-awake during recording
- Structured error codes with user/internal categorization
- Whisper sidecar crash auto-restart
- Transcript export formats (SRT/VTT/JSON)
- Audio preprocessing chain (highpass + gain)
- File-based logging

---

## Phase 1: Foundation — Fix Core Transcription Reliability

**Goal:** Eliminate the top causes of missed/incorrect transcription and false verse matches. These are prerequisites for everything else.

### 1.1 Timestamped transcript storage

**Problem:** Transcripts are stored as a flat string (`transcript: string`). No per-utterance timestamps. This blocks SRT/VTT export, time-based verse navigation, and accurate verse-to-text alignment.

**Implementation:**

```
New type in src/types/sermon-listener.ts:

interface TranscriptSegment {
  id: string              // uuid
  text: string
  startMs: number         // sermon-relative start time
  endMs: number            // sermon-relative end time
  source: 'web-speech' | 'whisper' | 'elevenlabs'
  confidence?: number
  speaker?: number         // future diarization
}
```

- Modify `useSermonListener.ts` to accumulate `TranscriptSegment[]` instead of appending to a string
- Backward compat: derive `transcript` (plain string) from segments for display
- Update `SermonListenerPanel.tsx` to render from segments with optional timestamp display
- Update Convex `transcripts` table schema to store segments array alongside text
- Migration: existing plain-text transcripts remain valid; segments field defaults to `[]`

**Files changed:**
- `src/types/index.ts` or `src/types/sermon-listener.ts` — new type
- `src/hooks/useSermonListener.ts` — accumulate segments, derive text
- `src/components/sermon-listener/SermonListenerPanel.tsx` — render from segments
- `convex/schema.ts`, `convex/transcripts.ts` — schema + mutation update

### 1.2 VAD timestamp offset correction

**Problem:** When VAD cuts a speech segment starting at 45s into the sermon, whisper returns timestamps relative to the segment (0s), not the sermon timeline (45s). This causes verse detection to fire on hallucinated text from silence gaps, and timestamps in stored segments are wrong.

**Implementation:**

Desktop path (`nativeVadCapture.ts` + `mod.rs`):
- Rust `VadAudioChunkEvent` currently has `{ wav_base64, duration_ms, is_speaking }`. Add `start_offset_ms: u32` — the sermon-relative time when this speech segment began
- Track a `session_startInstant` when capture begins. Each VAD segment's `start_offset_ms = (now - session_start).as_millis()`
- In `desktopWhisperTranscription.ts`, after `transcribeWithDesktopWhisper()` returns, add `start_offset_ms` to every segment's `(start, end)` before creating `TranscriptSegment`

Browser path (`desktopWhisperTranscription.ts:338-441`):
- The `@ricky0123/vad-web` `onSpeechEnd` callback fires with audio data but no timestamp. Track `speechStartTime = performance.now()` in `onSpeechStart`, then offset = `speechStartTime - sessionStartTime`
- Same offset addition to whisper results

**Files changed:**
- `src-tauri/src/audio_capture/mod.rs` — add `start_offset_ms` to `VadAudioChunkEvent`
- `src/services/sermon-listener/nativeVadCapture.ts` — consume new field
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — offset correction for both Rust and browser VAD paths

### 1.3 Whisper sidecar crash recovery

**Problem:** If the Python faster-whisper server crashes mid-sermon, there is no auto-restart. Transcription silently fails. The user sees no error for dropped chunks.

**Implementation:**

- In `desktopWhisperService.ts`, wrap `transcribeWithDesktopWhisper()` with a health check:
  1. Before sending audio, ping `/health`
  2. If health check fails, attempt `startDesktopWhisperServer()` restart (with cooldown to prevent restart loops — max 3 restarts per session)
  3. If restart succeeds, retry the transcription
  4. If restart fails after 3 attempts, set a permanent error state with user-facing message "Transcription server failed. Click to retry."
- In `whisperReadiness.ts`, subscribe to Rust `whisper-server://crashed` events if available, or add a periodic health poll (every 30s during active transcription)
- In `useSermonListener.ts`, add a `retryServer()` action callable from the error banner

**Files changed:**
- `src/services/sermon-listener/desktopWhisperService.ts` — health check + restart logic
- `src/services/sermon-listener/whisperReadiness.ts` — crash detection
- `src/hooks/useSermonListener.ts` — retry action + error state improvement

### 1.4 Keep-awake during recording

**Problem:** No sleep prevention. During 45+ min sermons, the device may sleep, killing AudioWorklet, Web Speech API, and potentially the whisper sidecar.

**Implementation:**

Desktop (Tauri):
- Add `tauri-plugin-keepawake` to `Cargo.toml` (feature-gated, same as Vibe)
- Register plugin in `main.rs` conditionally
- Create `src/services/sermon-listener/keepAwake.ts`:
  ```ts
  export async function startKeepAwake() { invoke('plugin:keepawake|start') }
  export async function stopKeepAwake() { invoke('plugin:keepawake|stop') }
  ```

Web (browser):
- Use Screen Wake Lock API: `navigator.wakeLock.request('screen')`
- Handle visibility change: re-request on `visibilitychange` when document becomes visible again (Wake Lock is released when tab is hidden)
- Fallback: if Wake Lock API unavailable, log warning but continue

Integration:
- In `useSermonListener.ts`, call `startKeepAwake()` in the `start()` function
- Call `stopKeepAwake()` in `stop()` and in the `finally` block of any error handler
- Track wake lock sentinel to release cleanly

**Files changed:**
- `src-tauri/Cargo.toml` — add `tauri-plugin-keepawake` dependency
- `src-tauri/src/main.rs` — register plugin
- `src/services/sermon-listener/keepAwake.ts` — new file
- `src/hooks/useSermonListener.ts` — integrate keep-awake calls
- `package.json` — add `@tauri-apps/plugin-keepawake` (or use invoke directly)

### 1.5 Audio device selection persistence across restarts

**Problem:** Browser `deviceId` is origin-scoped and resets on browser restart. Native device names aren't matched back properly on next launch.

**Implementation:**
- Persist device by **label** + **kind** (not `deviceId`) in localStorage/appStore
- On app launch, after `enumerateDevices()`, resolve saved label to current `deviceId` by substring matching (Vibe's approach)
- If no match found, fall back to system default (with a console warning)
- Add visual indicator of which device is in use during recording
- For Tauri path: Rust `list_audio_devices` already returns device names. Match those by name.

**Files changed:**
- `src/hooks/useAudioDevices.ts` — persist/resolve by label
- `src/store/appStore.ts` — store `selectedMicrophoneLabel` alongside `selectedMicrophoneId`
- `src/components/sermon-listener/SermonListenerSettings.tsx` — indicate resolved vs saved

---

## Phase 2: Quality — Reduce Hallucinations and Improve Accuracy

### 2.1 Fix double getUserMedia for audio visualizer

**Problem:** `useSermonListener.ts:382-474` opens a **second** `getUserMedia` stream for the audio visualizer when VAD/Rust manages the primary stream. Wasteful and can cause conflicts on devices with limited audio input.

**Implementation:**
- For browser VAD path: the `@ricky0123/vad-web` library exposes `_stream` (currently accessed via `(this.vad as any)._stream`). Add a public `getMediaStream()` method or use the VAD library's stream directly for the analyser
- For Rust capture path: expose the active `MediaStream` from `desktopWhisperTranscription.ts` (currently the Rust path doesn't use `getUserMedia` at all — it uses `cpal`). For the analyser, keep the current separate `getUserMedia` but **only for visualization**, and stop the extra stream when recording stops
- For native capture: add a `isSpeaking` state from `vad-audio-chunk` events and use that + a separate visualizer stream
- Clean up: ensure all visualizer streams are properly stopped on unmount

**Files changed:**
- `src/hooks/useSermonListener.ts` — share stream from primary capture
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — expose `getMediaStream()`

### 2.2 Real-time audio preprocessing chain

**Problem:** No highpass filtering or gain boost before transcription. Church environments often have HVAC rumble and low-frequency noise that degrades whisper accuracy.

**Desktop path (Rust):**
- In `src-tauri/src/audio_capture/microphone.rs`, after resampling to 16kHz, apply a first-order highpass IIR filter at 85Hz (Q=0.7) before storing to buffer
- Add a configurable gain stage (default: +3dB, conservative) after the highpass
- This affects all audio captured via Rust: both fixed-chunk and VAD paths
- Implementation: simple biquad filter in Rust — no external dependency needed

**Browser web path:**
- In `desktopWhisperTranscription.ts`, modify the AudioWorklet (`audio-capture-processor`) to add a highpass BiquadFilter node before the audio enters the worklet
- Chain: `mic → highpass(85Hz, Q=0.7) → gain(1.5x) → worklet`
- For the VAD browser path: the `@ricky0123/vad-web` library accepts custom `AudioContext` processor configurations. Add the filter chain to the VAD's audio graph.

**Files changed:**
- `src-tauri/src/audio_capture/microphone.rs` — add highpass + gain
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — add Web Audio filter chain
- `src/services/sermon-listener/nativeAudioCapture.ts` — no change (gets preprocessing for free from Rust)

### 2.3 Server-side audio normalization confirmation

**Problem:** The Python faster-whisper server receives audio of varying quality. Currently, audio is sent as-is after client-side 16kHz mono encoding.

**Implementation:**
- Verify the whisper server normalizes input audio internally (faster-whisper does resample internally, but does not apply highpass or gain)
- If the server cannot be modified (bundled sidecar): rely on client-side preprocessing (2.2)
- If using a remote speaches server: no preprocessing possible on server side, so client-side preprocessing is mandatory
- Add a `vadFilter: true` form parameter to the `/transcribe` request to inform the server that VAD-filtered audio is being sent (server may skip its own VAD step for efficiency)

### 2.4 Chunk drop rate visibility

**Problem:** In `desktopWhisperTranscription.ts:594-609`, timeout errors are logged at only 10% sampling rate. The user gets no feedback when chunks are lost.

**Implementation:**
- Add a `droppedChunkCount` counter to the transcription service
- Surface as a warning badge on the SermonListenerPanel when >5% of chunks are dropped: "⚠ ~N% of audio not transcribed"
- Track `totalChunksSent` and `totalChunksSucceeded` for the session
- On chunk timeout: increment counter, don't silently drop — at minimum queue a lightweight "..." placeholder in the transcript
- In the error banner, include "Chunks lost: N/M" when `droppedChunkCount > 0`

**Files changed:**
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — tracking counters
- `src/hooks/useSermonListener.ts` — expose drop rate state
- `src/components/sermon-listener/SermonListenerPanel.tsx` — warning badge

---

## Phase 3: UX — Error Handling, Export, and Visualizer

### 3.1 Structured error codes with user/internal categorization

**Problem:** Errors are passed as strings with no categorization. No distinction between "server not running" (retry) vs "model not found" (user action needed).

**Implementation:**

```ts
// src/services/sermon-listener/transcriptionErrors.ts (new file)

export const transcriptionErrorCodes = {
  SERVER_NOT_RUNNING:   'server_not_running',   // retry
  SERVER_BUSY:          'server_busy',           // retry (shouldn't happen for Selah — bug)
  SERVER_CRASHED:       'server_crashed',        // auto-restart + retry
  MODEL_NOT_FOUND:      'model_not_found',       // user action needed
  NETWORK_TIMEOUT:      'network_timeout',       // silent retry
  INVALID_AUDIO:        'invalid_audio',         // user error (bad file/device)
  MICROPHONE_DENIED:    'microphone_denied',      // user action needed
  MICROPHONE_NOT_FOUND: 'mic_not_found',         // user action needed
  INTERNAL_ERROR:       'internal_error',        // show details
} as const

export type UserErrorCode = 'invalid_audio' | 'microphone_denied' | 'mic_not_found' | 'model_not_found'
export type RetryableErrorCode = 'server_not_running' | 'server_busy' | 'server_crashed' | 'network_timeout'

export function isUserError(code: string): boolean
export function isRetryableError(code: string): boolean
export function getMaxRetries(code: string): number
```

- **User errors** → red banner with action button ("Check Settings", "Grant Permission")
- **Retryable errors** → auto-retry up to N times, show "Retrying..." indicator, escalate to error banner if exhausted
- **Internal errors** → error modal with "Show Logs" button + optional analytics tracking
- Map existing error strings from `desktopWhisperService.ts` and `speechRecognition.ts` to error codes

**Files changed:**
- `src/services/sermon-listener/transcriptionErrors.ts` — new file
- `src/services/sermon-listener/desktopWhisperService.ts` — return error codes from HTTP status + response body
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — map errors to codes
- `src/hooks/useSermonListener.ts` — handle categorized errors with appropriate UX
- `src/components/sermon-listener/SermonListenerPanel.tsx` — error banners with actions

### 3.2 Transcript export formats

**Prerequisite:** Phase 1.1 (timestamped transcript storage) must be complete.

**Implementation:**

```ts
// src/services/sermon-listener/transcriptExport.ts (new file)

export function exportAsText(segments: TranscriptSegment[], metadata: TranscriptMeta): string
export function exportAsSrt(segments: TranscriptSegment[], metadata: TranscriptMeta): string
export function exportAsVtt(segments: TranscriptSegment[], metadata: TranscriptMeta): string  // include WEBVTT header
export function exportAsJson(segments: TranscriptSegment[], metadata: TranscriptMeta): string
```

- **TXT**: Plain text with detected verse references inline (e.g., "For God so loved [John 3:16]")
- **SRT**: SubRip format with sermon-relative timestamps, sequential numbering, verse references in brackets
- **VTT**: WebVTT with proper `WEBVTT` header (fix Vibe's bug), period decimal separator, verse cues
- **JSON**: Array of `{start, end, text, detectedVerses?}` in seconds + metadata (title, date, provider, duration)
- Optional future: **DOCX** via `docx` npm package, **PDF** via `window.print()`
- Export UI: dropdown in `SermonListenerPanel.tsx` next to the existing export button
- Include detected verse references in all formats (not just raw text)

**Files changed:**
- `src/services/sermon-listener/transcriptExport.ts` — new file
- `src/components/sermon-listener/SermonListenerPanel.tsx` — format picker + export button
- `src/hooks/useSermonListener.ts` — expose `exportTranscript(format)` action

### 3.3 Upgrade audio visualizer

**Problem:** Current 8-bar equalizer is minimal. No waveform view, no dBFS indication, no clipping detection. System audio visualization is entirely disabled.

**Implementation:**

Upgrade path (incremental, not full rewrite):
1. Fix double `getUserMedia` first (Phase 2.1)
2. Add **peak indicator** and **clipping detection** to existing bar visualizer:
   - Track max level per frame, show a peak hold line that decays over 1s
   - If `audioLevel > 0.95` for >5 frames, show yellow/red clipping indicator
3. Add a **speech detected** overlay on the visualizer bars (green glow when VAD detects speech)
4. Add **system audio level events** from Rust:
   - In `start_system_audio_capture` (macos.rs, windows.rs), compute RMS per chunk
   - Emit `system-audio-level` events to frontend via Tauri `Emitter`
   - Frontend uses these for the visualizer instead of trying to open a second stream
5. Future: replace bars with waveform canvas (Vibe's `audio-visualizer.tsx` as reference, ~250 lines Canvas2D with Bezier curves, asymmetric smoothing)

**Files changed:**
- `src-tauri/src/audio_capture/macos.rs` — emit level events
- `src-tauri/src/audio_capture/windows.rs` — emit level events
- `src/hooks/useSermonListener.ts` — consume level events, peak/clipping detection
- `src/components/sermon-listener/SermonListenerPanel.tsx` — enhanced visualizer

---

## Phase 4: Streaming and Robustness

### 4.1 ndjson streaming from whisper server

**Problem:** Current architecture POSTs audio and waits for a full response. For longer VAD segments (5-10s), the user sees no progress until the entire segment is transcribed.

**Implementation:**

Server-side (Python `whisper-server.py`):
- Add SSE/ndjson streaming mode to `/transcribe` endpoint, activated by `response_format=ndjson` form parameter
- Emit events as they're decoded: `{"type": "progress", "progress": 50}`, `{"type": "segment", "start": 0.0, "end": 2.5, "text": "For God so"}`
- Final event: `{"type": "result", "text": "full text"}`
- Error event: `{"type": "error", "code": "invalid_audio", "message": "..."}`
- Keep backward compat: if `response_format` is not `ndjson`, return current JSON response

Desktop client (`desktopWhisperService.ts`):
- When sending to server, include `response_format: 'ndjson'`
- Parse the streaming response using a line-buffered ndjson parser (buffer partial lines across chunks — Vibe has this bug, don't replicate)
- Emit partial results to `onProgress` callback for real-time display
- Accumulate segments into a final result

Web client:
- Same ndjson parser, but consume directly from the `fetch` response body stream via `ReadableStream`
- For non-Tauri browsers: direct ndjson parsing in JavaScript

**Files changed:**
- `src-tauri/binaries/whisper-server.py` — add ndjson streaming mode
- `src/services/sermon-listener/desktopWhisperService.ts` — streaming request + ndjson parser
- `src/hooks/useSermonListener.ts` — consume partial results for progressive display

### 4.2 Crash recovery + file logging

**Problem:** Console logging is ephemeral. If the app crashes, there's no diagnostic info. The whisper sidecar crashing is invisible.

**Implementation:**

Rust backend:
- Add `tracing` + `tracing-subscriber` with file appender to `Cargo.toml`
- Configure in `main.rs`: log to `{app_config_dir}/logs/selah-{date}.log`
- Daily rotation, keep last 7 days
- Log levels: `info` for normal operation, `warn` for retries, `error` for failures
- Add a Tauri command `get_logs()` that returns the last N lines of the log file

Frontend structured logging:
- Add a Tauri command `log_message(level, message, context)` that writes JS-side messages to the same Rust log file
- Create a lightweight wrapper in `src/services/logging.ts` that auto-detects desktop vs web:
  - Desktop: invoke Tauri `log_message` command
  - Web: `console.log` (existing behavior)

Crash detection:
- On startup, check for a sentinel file `{app_config_dir}/.selah-running`
- Write this file on app launch, delete on clean shutdown
- If file exists on next launch: previous session crashed. Show message: "Selah closed unexpectedly last time. [View Logs] [Dismiss]"
- Use a **sentinel file** approach (safer than Vibe's signal-handler UI calls which are UB)
- Don't replicate Vibe's `crash_handler::attach()` — the `dialog` + `open_url` calls in signal handlers are undefined behavior

**Files changed:**
- `src-tauri/Cargo.toml` — add `tracing`, `tracing-subscriber`, `tracing-appender`
- `src-tauri/src/main.rs` — initialize logging, crash detection, `get_logs` command
- `src/services/logging.ts` — new file (structured logging bridge)
- `src/hooks/useSermonListener.ts` — replace `console.log` with structured logger

### 4.3 Worklet consolidation

**Problem:** Two duplicate inline AudioWorklet definitions (`whisper-capture-processor` in `whisperCppTranscription.ts` and `audio-capture-processor` in `desktopWhisperTranscription.ts`).

**Implementation:**
- Create `src/services/sermon-listener/audioCaptureProcessor.worklet.ts` — shared worklet module
- Supports two modes via configuration: `rawPCM` (posts Float32Array) and `encodedWAV` (posts Blob)
- Replace both inline worklet definitions with imports from the shared module
- Delete the WAV encoding from the worklet (move to `wav.worker.ts` or keep as optional worklet-internal encoding)

**Files changed:**
- `src/services/sermon-listener/audioCaptureProcessor.worklet.ts` — new shared worklet
- `src/services/sermon-listener/desktopWhisperTranscription.ts` — use shared worklet
- `src/services/sermon-listener/whisperCppTranscription.ts` — use shared worklet (or remove entirely since it's deprecated)

---

## Phase 5: Future Enhancements

### 5.1 Speaker diarization

**Status:** Deferred. Low priority for Selah's primary use case (single pastor).

**When to revisit:**
- If user feedback indicates interview/Q&A format transcription is a common need
- If diarization models become smaller (<10MB) and faster (<2s latency)
- Vibe's approach: Sortformer ONNX model (~25MB), `sona-diarize` binary, 4-speaker max, 0-indexed
- Implementation would add `speaker?: number` to `TranscriptSegment` and a "Speaker N" label in the UI
- Could filter verse detection to only the primary speaker's segments

### 5.2 VAD CDN dependency removal

**Problem:** Browser VAD path (`@ricky0123/vad-web`) loads ONNX model and WASM from `cdn.jsdelivr.net`. Breaks in offline/restricted networks (common in church AV setups).

**Implementation:**
- Bundle the VAD ONNX model and ONNX Runtime WASM in Vite's `public/` directory
- Configure `@ricky0123/vad-web` to use local asset paths instead of CDN
- Vibe uses a local `ggml-silero-v6.2.0.bin` file (~1MB) — similar approach for browser
- Fallback: if bundled files missing, try CDN; if CDN fails, show "VAD unavailable, using fixed chunks" and fall back to non-VAD capture

### 5.3 Audio recording to file

**Problem:** No audio recording of the sermon — only text is saved. Users sometimes want the actual audio.

**Implementation:**
- In Rust capture path: write raw PCM to a temp file during capture. On stop, encode to WAV (using `hound`) or optionally compress to FLAC/MP3 via ffmpeg
- In browser path: accumulate audio chunks from the worklet, assemble into a single WAV/WebM blob on stop
- Store recording path in transcript metadata
- Add "Download Recording" button next to "Export Transcript"
- Vibe records to WAV via `hound::WavWriter` and optionally normalizes via ffmpeg after stop

### 5.4 Audio device hot-swap

**Problem:** Must stop and restart recording to change audio device.

**Implementation:**
- In Rust: stop current `cpal` stream, create new stream with new device, resume audio processing
- In browser: close current `getUserMedia` stream, open new one, reconnect to VAD/analyser
- Preserve `session_start` time so timestamps remain continuous across device switches
- Show brief "Switching device..." indicator during swap

---

## Implementation Order and Dependencies

```
Phase 1 (Foundation) — all independent, can be parallelized
├── 1.1 Timestamped transcript storage          [prereq for 3.2]
├── 1.2 VAD timestamp offset correction          [builds on 1.1]
├── 1.3 Whisper sidecar crash recovery           [independent]
├── 1.4 Keep-awake                               [independent]
└── 1.5 Device selection persistence              [independent]

Phase 2 (Quality) — partially depends on Phase 1
├── 2.1 Fix double getUserMedia                   [independent]
├── 2.2 Real-time audio preprocessing             [independent]
├── 2.3 Server-side normalization confirmation     [independent, quick]
└── 2.4 Chunk drop rate visibility                [builds on 1.3]

Phase 3 (UX) — depends on Phase 1 timestamps and Phase 2 fixes
├── 3.1 Structured error codes                    [builds on 1.3]
├── 3.2 Transcript export                         [requires 1.1]
└── 3.3 Audio visualizer upgrade                  [builds on 2.1]

Phase 4 (Streaming & Robustness) — can be done in parallel with Phase 3
├── 4.1 ndjson streaming                          [independent]
├── 4.2 Crash recovery + file logging             [builds on 1.3, 3.1]
└── 4.3 Worklet consolidation                     [independent]

Phase 5 (Future) — defer
├── 5.1 Speaker diarization
├── 5.2 VAD CDN dependency removal
├── 5.3 Audio recording to file
└── 5.4 Audio device hot-swap
```

## Effort Estimates

| Phase | Item | Effort | Files | Risk |
|-------|------|--------|-------|------|
| 1.1 | Timestamped storage | 2-3 days | 5-6 | Medium (Convex schema migration) |
| 1.2 | VAD timestamp offset | 1-2 days | 3 | Low |
| 1.3 | Sidecar crash recovery | 1 day | 3 | Low |
| 1.4 | Keep-awake | 0.5 day | 3-4 | Low (well-documented APIs) |
| 1.5 | Device persistence | 1 day | 3 | Low |
| 2.1 | Fix double getUserMedia | 0.5 day | 2 | Low |
| 2.2 | Audio preprocessing | 2-3 days | 4-5 | Medium (Rust DSP + Web Audio API) |
| 2.3 | Server normalization | 0.5 day | 1-2 | Low |
| 2.4 | Chunk drop visibility | 0.5 day | 3 | Low |
| 3.1 | Structured error codes | 1-2 days | 5 | Low |
| 3.2 | Transcript export | 1-2 days | 3 | Low (well-specified formats) |
| 3.3 | Visualizer upgrade | 2-3 days | 4-5 | Medium (Canvas + Rust events) |
| 4.1 | ndjson streaming | 2-3 days | 3-4 | Medium (server + client parser) |
| 4.2 | Crash recovery + logging | 2-3 days | 4-5 | Medium (Rust tracing setup) |
| 4.3 | Worklet consolidation | 1 day | 3 | Low |

**Total: ~18-25 days of focused work for Phases 1-4**

---

## Key Differences from Vibe's Approach

1. **Dual architecture**: Vibe is Tauri-only. Selah must work in both browser and desktop. Every Tauri-only feature (ndjson parsing, keep-awake, audio preprocessing) needs a web fallback.

2. **VAD already exists**: Vibe's `stable_timestamps` mode is a toggle. Selah already has VAD enabled by default — the issue is **timestamp offset correction**, not VAD itself.

3. **Verse detection is Selah-specific**: Vibe has no semantic verse matching. Selah's verse detection is the primary consumer of transcription results, so timestamp accuracy directly affects verse match quality.

4. **Live sermon context**: Vibe transcribes existing files. Selah transcribes live audio in real-time, so crash recovery, keep-awake, and chunk drop visibility are more critical.

5. **No sidecar binary**: Vibe uses a prebuilt Go binary (`sona`). Selah uses a Python Flask server bundled as a Tauri sidecar. Architecture differences mean ndjson streaming must be implemented in Python, not Go.