# Predictive Song-Lyrics Auto-Advance & Audio-Reactive Visuals

## Executive Summary

This plan adds two capabilities to Selah:

1. **Predictive lyric tracking** — during live worship, listen to the audio, figure out which song is being sung and where the singers are within it, and advance the live output **ahead** of the singers so the next line is already on screen when they reach it.
2. **Audio-reactive motion graphics** — a real-time visual layer behind the lyrics that pulses/reacts to the music at frame rate.

The reference plans handed to us are architecturally sound but written for a greenfield app. Selah is **not** greenfield — most of the hard infrastructure already exists. The reference plans propose building an audio pipeline, a Whisper integration, a fuzzy matcher, a song data model, and a second-screen output window. **We already have all five.** This plan re-frames the feature as _wiring together existing subsystems plus one genuinely new component (the position tracker) and one new render layer (the visualizer)_, rather than a from-scratch build.

### What already exists that we reuse (not rebuild)

| Reference plan proposes | Selah already has | Location |
|---|---|---|
| Build audio capture (getUserMedia / cpal loopback) | Native Rust `cpal` capture **and** web capture, both emitting Float32 samples | `src-tauri/src/audio_capture/`, `src/services/sermon-listener/nativeAudioCapture.ts` |
| Integrate Whisper | Native whisper (Rust) + 4 cloud/self-host providers behind a unified interface | `src-tauri/src/transcription/`, `src/services/sermon-listener/{nativeTranscription,unifiedTranscription}.ts` |
| Add VAD | Silero VAD, native + web | `nativeVadCapture.ts`, `vadTranscriptionService.ts` |
| Add a fuzzy matcher | `fuzzysort` dep + existing `detectVerses` regex engine + semantic embedding matcher | `verseDetection.ts`, `semanticVerseDetection.ts` |
| Build a song content model | 2,919-song library already imported (EasyWorship `Songs.db`/`SongWords.db`) + `songs`/`slides` Convex tables | `Songs.db`, `convex/schema.ts` |
| Build a second-screen output window | `LiveView` output window; desktop pushes via Rust `emit_to_live_window`→`listen('slide-update')`, web via `BroadcastChannel` + `localStorage` | `src/pages/LiveView.tsx`, `src-tauri/src/multi_monitor/`, `src/components/live/` |
| Add a WebGL rendering library | `three` + `gsap` + `framer-motion` are deps (⚠️ `three` is used **only on the marketing landing page** — the output path is DOM+`<video>`, so the visual layer itself is genuinely new; `HeroScene.tsx` is the reference pattern) | `package.json`, `src/components/landing/HeroScene.tsx` |

### What is genuinely new

1. **Structured lyrics + arrangement model** — today `Song.lyrics` is a freeform string (`src/types/index.ts:224`). The tracker needs sections + a per-service arrangement. This is the one real data-model change.
2. **The position tracker** — a state machine (Idle → Searching → Tracking → Lost) that consumes the existing transcript stream and outputs "advance to slide N _now_." Modeled on the existing `voiceCommandDetection.ts` / `semanticVerseDetection.ts` pattern.
3. **The audio-reactive visualizer** — a `three.js` layer inside the live output, driven by a Web Audio `AnalyserNode` tapping the same mic stream.
4. **Operator safety UI** — confidence meter, lock, manual override, click-to-jump — added to `LiveSessionControls`.

---

## Current Architecture (grounded)

### Audio + transcription (reuse as-is)

```
                          ┌──────────────────────────────────────────┐
  Desktop (Tauri):        │  src-tauri/src/audio_capture (cpal)        │
  system loopback / mic ─▶│  → Float32 samples → Tauri events          │
                          └───────────────┬──────────────────────────┘
                                          │  nativeAudioCapture.ts
  Web: getUserMedia ──────────────────────┤  (MediaRecorder / AudioContext)
                                          ▼
                          ┌──────────────────────────────────────────┐
                          │  vadTranscriptionService (Silero VAD)      │
                          │  → speech segments → unifiedTranscription  │
                          │  → transcript chunks (text + timing)       │
                          └───────────────┬──────────────────────────┘
                                          ▼
                          verseDetection.ts / semanticVerseDetection.ts
                          → detected refs → setLiveSlide()
```

Key seam: on desktop, capture + VAD + Whisper all run **in-process in Rust** and arrive in the WebView as `transcription-result` events (`{ text, duration_ms, start_offset_ms }`); a sidecar/web fallback emits `vad-audio-chunk` (base64 WAV). Either way, transcript chunks are already produced and consumed by `useSermonListener.ts`. **The song tracker is a new consumer of that same event stream** — no new capture or transcription work. (Consequence for Phase 4: on desktop there is *no* `MediaStream` in the WebView — the audio never enters JS as raw samples — so the visualizer's audio source must be handled per-platform. See Phase 4.)

### Live output (reuse as-is)

- `appStore.setLiveSlide(slideId)` (`src/store/appStore.ts:546`) sets `liveSlideId`.
- `LiveView.tsx` receives state over `BroadcastChannel('selah-live-channel')` + `localStorage`, renders via `LiveOutput`, `AutoFitText`, `VideoBackground`.
- **The tracker advances lyrics by calling `setLiveSlide` — the exact same path the operator's manual clicks already use.** The output window needs zero changes to receive auto-advances.

### Song data (partial — needs structure)

- `src/types/index.ts:224` — `Song { lyrics: string; verses?: string[] }` (freeform).
- `convex/schema.ts:266` — `songs` table; `slides` table (`:156`) already stores per-song slides with `lyrics`/`verses` arrays.
- `Songs.db` — **2,919 songs** already present (EasyWorship schema: `song` + `word.words` as RTF). This is a large ready-made corpus; RTF → structured sections is a parsing task, not data entry.

---

## The core problem (why this isn't "verse detection v2")

Verse detection is **reactive**: match a spoken reference, display it; 1–2 s of lag is invisible. Lyric tracking must be **predictive**: verse 2 must be on screen _before_ the congregation reaches it, but Whisper always lags live audio by its buffer window. So we cannot "detect line → show line." We must **track position within a known structure and trigger the transition on the trailing edge of the current line**, using the last phrase of a line as the lead-time buffer.

Two independent consumers of one audio source, with very different latency budgets:

```
                        ┌─ Transcript stream ─▶ Position Tracker ─▶ setLiveSlide()  (tolerates ~1–2s)
 Shared audio source ───┤
                        └─ AnalyserNode (FFT/RMS) ─▶ Visualizer params ─▶ three.js  (must be frame-accurate)
```

Keep them decoupled: the visualizer must never wait on Whisper, and the tracker must never block the render loop.

---

## Phase 1 — Structured lyrics + arrangement model

**Goal:** give the tracker known checkpoints. This is the only unavoidable schema change.

1. Extend the song model (additive, back-compatible with the freeform `lyrics` string):

```ts
// src/types/index.ts — extend Song
interface SongSection {
  id: string                     // "v1", "c1", "b1"
  type: 'verse' | 'chorus' | 'bridge' | 'prechorus' | 'tag' | 'intro' | 'ending'
  label?: string                 // "Verse 1"
  lines: string[]
  slideId?: string               // link to existing slides row for rendering
}
interface Song {
  // ...existing fields (keep `lyrics` for back-compat)...
  sections?: SongSection[]
  defaultArrangement?: string[]  // ["v1","c1","v2","c1","c1","b1","c1"]
}
```

2. Mirror in `convex/schema.ts` `songs` table as optional fields (no migration needed; old rows keep working).

3. **Arrangement is per live session, not per song** — worship deviates constantly (repeated choruses, skipped verses). Add an editable arrangement to the live-session model (`convex/schema.ts:532` live sessions) that defaults to `song.defaultArrangement`. Also support a **freeform mode** (no arrangement → tracker searches all sections) as fallback.

4. **RTF → sections parser** for the 2,919-song `Songs.db`. `word.words` is RTF with slide markers; write a one-time importer (`scripts/`) that strips RTF, splits on slide/verse boundaries, and heuristically classifies section types. Ship results into the `songs`/`slides` tables. This turns the existing corpus into tracker-ready content for free.

5. Importers for common formats (OpenLyrics / OpenSong / ChordPro / plain-text-with-markers) — a real, requested feature and avoids manual entry. Reuse `AddSongModal.tsx` UI.

**Files:** `src/types/index.ts`, `convex/schema.ts`, `scripts/import-easyworship-songs.mjs` (new), `src/components/songs/`.

---

## Phase 2 — The position tracker (new; the hard part)

**Goal:** consume the existing transcript stream, output "current position" + "advance now" triggers. New module `src/services/sermon-listener/songTracker.ts`, modeled on `semanticVerseDetection.ts` and `voiceCommandDetection.ts`.

### State machine

```
Idle ──(operator loads song / setlist item active)──▶ Searching
Searching ──(first-line match ≥ threshold)──▶ Tracking
Tracking  ──(sustained low match)──▶ Lost ──(re-match)──▶ Tracking
Tracking  ──(operator stops / setlist changes)──▶ Idle
```

State: `{ songId, arrangement, currentStepIndex, currentLineIndex, confidence, lastMatchTime }`.

### Matching strategy (reuse both existing matchers)

For each transcript chunk, score against a **small candidate set** (not the whole DB once tracking):

- **remaining words of the current line** → detects we're near the trailing edge (the trigger).
- **next 1–2 steps in the arrangement** → primary advance candidates.
- **low-priority wide scan** of all section starts → catches unplanned jumps/repeats.

Scoring = fast lexical pass (`fuzzysort`, already a dep) for candidate pruning, then **semantic similarity** (reuse `localEmbeddings.ts` / `embedding.worker.ts` + the `similarity.worker.ts` cosine path, with thresholds from `src/lib/semanticRetrievalPolicy.ts`) for robustness against Whisper noise (reverb, multiple vocalists). Do **not** stand up a new embedding stack — the sermon-listener one is already prewarmed.

**Song embedding index (new, mirrors the Bible one):** verse embeddings today are Bible-only (`verseEmbeddings` Convex table + local packed-`Float32Array` in `verseEmbeddingStore.ts`). Build the song-line equivalent the same way — a `songEmbeddings` table (or extend `verseEmbeddings`) plus a local pack keyed off the structured `sections[].lines` from Phase 1, generated in a `scripts/build-embedding-pack` variant. Because tracking only ever scores a handful of candidate lines, a full index is optional — a per-loaded-song in-memory embedding of its own lines is enough for v1 and avoids the Convex round-trip entirely.

### Trailing-edge trigger (the lead-time mechanism)

```
if (confidence(last N words of current line) ≥ TRIGGER_THRESHOLD) {
    advanceTo(nextStep)   // → setLiveSlide(step.slideId)
}
```

The duration of that final phrase (typically 1–3 s) is exactly the buffer that hides Whisper latency.

### Hysteresis / anti-flicker

- Require **2 consecutive** weak matches before jumping backward/forward (music is noisier than speech).
- **Instrumental handling:** if no matching transcript for X s **but** audio RMS stays high (from the visualizer's analyser — already computed), assume solo/instrumental and **hold** the current slide. Only revert to Searching on low RMS **and** sustained no-match.

### Mode selection — don't auto-classify song vs. scripture

Selah already knows context: the operator has a setlist item / song loaded (`appStore`). Let the active item set the mode (song-tracking vs. sermon verse-detection) rather than inferring from content. Much more reliable live, and both features can coexist without fighting over `setLiveSlide`.

**Output:** the tracker only ever calls `setLiveSlide(slideId)` and emits a `{position, confidence}` event for the UI. Reuses `mitt` (already a dep) or Zustand.

**Files (new):** `src/services/sermon-listener/songTracker.ts`, `src/services/sermon-listener/__tests__/songTracker.test.ts`.

---

## Phase 3 — Operator safety UI (non-negotiable for live)

Full automation alone is not trustworthy on a live stage. Add to `src/components/live/LiveSessionControls.tsx`:

- **Confidence meter** + current-position indicator (which section/line the tracker thinks it's on).
- **Lock auto-advance** toggle for risky moments (offering, spontaneous worship).
- **Manual next/prev always live** (keyboard / presentation clicker) — already partly wired via `setLiveSlide`; ensure manual input **overrides and re-seeds** tracker state, not fights it.
- **Click-to-jump** on any line → resets tracker `currentStepIndex/currentLineIndex` to that point.

This mirrors ProPresenter's model and is what makes churches actually trust the feature.

---

## Phase 4 — Audio-reactive visualizer (new render layer, fully decoupled)

**Goal:** a real-time visual layer behind lyrics, driven by audio features, at animation-frame rate — independent of Whisper.

1. **Analyser tap — platform-split (the real design decision here):**
   - **Web:** straightforward. `getUserMedia`/`getDisplayMedia` gives a real `MediaStream`; attach an `AudioContext` + `AnalyserNode` (`fftSize` 1024–2048) directly. Zero-latency, all in the WebView.
   - **Desktop:** ⚠️ the audio lives in **Rust** (`src-tauri/src/audio_capture/`) — there is **no `MediaStream` in the WebView**, so there is nothing for `AnalyserNode` to attach to. Two options: **(a)** compute FFT/RMS bands in Rust and forward a small spectrum payload to the WebView on a new Tauri event (modeled exactly on `vad-audio-chunk`), throttled to ~30–60 Hz — cheap, a handful of floats per frame; or **(b)** open a *separate, WebView-side* `getUserMedia` mic stream purely for visuals, independent of the Rust capture used for transcription. **Recommend (a)** — it works with system loopback (option (b) is mic-only and would double-open the device) and keeps a single audio source.
2. **Feature extraction** (per `requestAnimationFrame` on web; per forwarded event on desktop): bass (avg low ~10% bins) → pulses/scale; RMS → overall intensity/opacity; highs (top ~30%) → sparkle. The RMS value **also feeds the tracker's instrumental-hold logic** (Phase 2) — one audio source, two consumers.
3. **Render:** use `three.js` (already a dep, but only exercised on the landing page today — `HeroScene.tsx` is the reference implementation, nothing in the output path is reusable) for a shader/particle background rendered inside the live output, **behind** the HTML/CSS lyric layer (`AutoFitText`) so text stays crisp. Slot it alongside `VideoBackground.tsx` as a new background type selectable per template. Note the visual must render in **both** the studio monitor (`LiveOutput.tsx`) and the projector window (`LiveView.tsx`); on desktop the projector is a separate `WebviewWindow`, so forward the spectrum payload to it the same way slides are forwarded (`emit_to_live_window`).
4. **Worship-appropriate defaults:** subtle pulsing gradients / particle drift, not distracting strobes. Expose intensity presets.
5. **Cross-window transport:** compute features once (in Rust on desktop, or in the operator WebView on web) and fan the scalar params out to every renderer — over `BroadcastChannel` on web, over `emit_to_live_window` on desktop — throttled. Never run two independent analysers.

**Files (new):** `src/components/live/AudioReactiveBackground.tsx`, `src/services/visualizer/audioFeatures.ts`; a spectrum-forwarding path in `src-tauri/src/audio_capture/` + a new Tauri event; integrate in `LiveView.tsx` / `LiveOutput.tsx`, add background type in `appStore` (`DEFAULT_BACKGROUNDS`).

---

## Phase 5 — Platform capture hardening (investigate early — real risk)

Mostly **already solved** on desktop, but confirm and fill gaps:

- **Desktop (Tauri):** system-audio loopback via existing `src-tauri/src/audio_capture/` (cpal). Verify per-OS: WASAPI loopback (Windows, straightforward), Core Audio (macOS has **no native loopback** — needs BlackHole or equivalent virtual device; document this), PulseAudio/PipeWire monitor (Linux). This asymmetry is the main UX risk — confirm what the existing capture module already handles.
- **Web:** `getUserMedia` (mic) or `getDisplayMedia` (tab/screen audio) only, with Safari inconsistency. Likely **mic-only** on web vs. full loopback on desktop — decide and message this in-product early since it shapes expectations.

**Files:** `src-tauri/src/audio_capture/`, `docs/NATIVE_AUDIO_CAPTURE_HANDOFF.md` (already exists — extend it).

### Phase 5 — implementation status (what shipped)

Reconnaissance corrected two assumptions above:

- **macOS loopback is already native** via **ScreenCaptureKit** (`screencapturekit` crate, `macos.rs`) — no BlackHole needed, but it does require the **Screen Recording permission** (`check_screen_capture_permission`). Windows uses **WASAPI loopback** (`windows.rs`). Both are functional and plumbed end-to-end (`start_capture{,_with_vad}` take a `capture_type` of `microphone | system | both`). **Linux** loopback is a fragile cpal search for an input device named `"monitor"` (no PipeWire-native path); `both` currently falls back to microphone.

**Shipped this phase — the continuous audio path to the webview (the real gap):**

Before, audio only left Rust as VAD **speech segments** (base64 WAV) or final transcription **text** — there was *no* continuous level/spectrum event. So on desktop the visualizer + level meter were dead for **system loopback**, and worked for **microphone** only by opening a wasteful *second* `getUserMedia` stream in the webview.

- **Rust** (`audio_capture/mod.rs`): the VAD capture loop now emits a throttled (~30fps) **`audio-features`** event `{ rms, bass, mid, treble }` for **every** source (mic *and* system loopback), computed in the time domain (one-pole low-pass ≈ bass, high-pass residual ≈ treble — no FFT crate needed) via `compute_audio_features()`.
- **Frontend** (`services/visualizer/nativeAudioFeatures.ts`): subscribes to `audio-features` and publishes into the existing `audioFeatures` bus (`publishFeatures`), so the Phase-4 visualizer needs no change. On desktop, `useSermonListener` now drives the level meter *and* the visualizer from this native signal and **no longer opens a duplicate mic stream**; the web/browser AnalyserNode path is unchanged.

**Still open (documented, not built):**
- Linux PipeWire-native loopback; `both` (mix mic + system) is a TODO that falls back to mic.
- In-app UX for the macOS Screen Recording permission prompt, and cross-platform loopback guidance.
- Web remains **mic-only** for reactive visuals (browsers can't capture speaker output; `getDisplayMedia` tab audio is a possible future opt-in).

---

## Suggested build order

Correctness before lead-time before polish:

1. **Phase 1** — structured model + EasyWorship RTF importer. Unblocks everything; delivers a real content win immediately.
2. **Phase 2a** — reactive line tracking (match transcript → highlight position) **without** predictive triggering. Prove matching works against the noisy live transcript.
3. **Phase 2b** — trailing-edge triggering + hysteresis + instrumental-hold. This is where most tuning time goes.
4. **Phase 3** — operator safety UI. Ship gated behind a feature flag (`src/services/feature-flags/`) so it's testable live without risk.
5. **Phase 4** — visualizer. **Independent workstream** — can proceed in parallel from day one since it shares only the audio tap, not the tracker.
6. **Phase 5** — capture hardening, folded in as platforms are validated.

## Risks & open questions

- **Whisper chunk cadence vs. lead time:** if the native transcription buffer is large, the trailing-edge trigger may still be late. Measure real end-to-end lag from the existing native pipeline first; it dictates how aggressive the trigger must be.
- **Multi-vocalist / harmony reverb** degrades Whisper more than sermon speech — semantic matching + hysteresis mitigate but need real-service audio to tune. Capture sample recordings early.
- **RTF parsing fidelity** across 2,919 heterogeneous EasyWorship entries — expect a long tail; provide a manual section-editor (Phase 1.5) as the escape hatch.
- **Two features writing `setLiveSlide`** (sermon verse-detection vs. song tracker) — the mode-selection rule (Phase 2) must guarantee only one is active per live session.
