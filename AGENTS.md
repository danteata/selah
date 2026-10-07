# Selah — Agent Context

## Client-Side Embedding Architecture

### Local Embeddings (`src/services/sermon-listener/localEmbeddings.ts`)
- Two models, chosen by platform in `embeddingModel.ts`:
  - **Desktop**: EmbeddingGemma 300M (`onnx-community/embeddinggemma-300m-ONNX`, 8-bit, 768 dims), run natively by ONNX Runtime in `src-tauri/src/embeddings.rs` (`embed_texts` / `embeddings_unload` commands), from the model bundled under `src-tauri/assets/embedding-models`. It runs `onnx/model_quantized_gather_first.onnx`, a rewrite of the published graph that looks token embeddings up before dequantizing them (`scripts/embedding-graph/`; the stock graph rebuilt an 805 MB float32 table every call). Memory test: `cargo test --release --bin selah memory_stays_flat -- --ignored --nocapture`, on its own (RSS is per process). Do not move it back into the webview: on macOS it grew WebKit's content process past its 8 GB limit and the window went black.
  - **Web**: `Xenova/all-MiniLM-L6-v2` (384 dims) in a **Web Worker** (`embedding.worker.ts`) through `@xenova/transformers` from jsdelivr.
- `embedText(text, kind)` / `embedBatch(texts, kind)`: `kind` is `'query'`, `'document'` (verses) or `'clustering'`. EmbeddingGemma prefixes each differently (added in `localEmbeddings.ts`); MiniLM takes no prefix.
- Each model has its own verse pack — desktop `src-tauri/semantic-packs/WEB` (EmbeddingGemma), web `public/embedding-packs/WEB` (MiniLM, frozen) — and the loader passes over a pack built with the other model. The EmbeddingGemma pack, the score calibration (`embeddingCalibration.ts`), the build scripts and the Rust embedder must agree — tests enforce it, and `cargo test --release --bin selah embeddings` checks the Rust embedder reproduces the pack's vectors. After a model change run `npm run build-semantic-pack` (pack + calibration) and `npx vite-node scripts/eval-semantic-policy.ts -- <dump>`.
- Scores leaving `searchVerseEmbeddings` are calibrated onto MiniLM's scale (`scoreCalibration.ts`), which is what every semantic threshold was tuned on; MiniLM's pass through. Search is local only; the Convex `verseEmbeddings` table is no longer read.
- Vite bundles the worker into a separate chunk (`dist/assets/embedding.worker-*.js`).
- `isEmbedderReady()` checks whether the model is loaded (desktop) or the worker exists (web).

### Text Preparation Worker (`src/services/sermon-listener/textPreparation.worker.ts`)
- Offloads sentence splitting, deduplication (`O(n²)` char-similarity), and sliding-window generation from `semanticVerseDetection.ts`.
- Pre-compiles the sentence-split regex at module scope (no recompilation per call).
- Main thread posts `text + excludedRanges`, worker returns `{ sentences, dedupedSentences, windows }`.

### Transcription providers
- Only two remain: **Web Speech** (browser) and **native** (in-process Whisper/Parakeet in Rust, desktop). `unifiedTranscription.ts` routes between them.
- The whisper.cpp / faster-whisper / remote Whisper / ElevenLabs / browser-VAD providers, their WAV worker and the `public/` VAD/ONNX assets were unreachable and were removed in September 2026. Older docs in `docs/` still describe them.

### Embedding Sync Manager (`src/services/sermon-listener/embeddingSyncManager.ts`)
- Central singleton that manages the full verse-embedding pipeline: download → model load → generate → cache.
- `startSync(versionId, getUrl, downloadFn, withFragments)`
  - `withFragments = false` (default): embeds **only full verse texts**. ~1–2 min for KJV.
  - `withFragments = true`: embeds full verse **plus clause/window fragments**. ~3–5 min for KJV, ~3–4× more rows, better short-verse detection.
- Yields the main thread (`await new Promise(r => setTimeout(r, 0))`) between batches so React can paint progress updates.
- Flushes accumulated embeddings to IndexedDB every 5 batches (250 verses) to keep memory bounded.

### UI / Controls
- `BibleVersionSettings.tsx` — "Enable Search" seeds full-verse embeddings only (~1–2 min), then **auto-upgrades to fragments in the background** after a 500 ms pause so the user gets usable search quickly. "Upgrade" button lets users manually re-seed with fragments. "Refresh" preserves the current mode.
- `LocalEmbeddingSync.tsx` — Checkbox toggle lets the user choose fragment mode before caching. Defaults to fast full-verse mode. Also auto-upgrades to fragments after the fast seed completes.
- `useEmbeddingStatus.ts` — thin React hook that subscribes to the sync manager's reactive state Map. Exposes `upgradeToFragments()` for background enhancement.

### Auto-Upgrade Flow
1. User clicks **Enable Search** / **Cache** (default `withFragments = false`).
2. `startSync` completes in ~1–2 min, state shows `completed`, `hasEmbeddings = true`, `hasFragments = false`.
3. After a 500 ms delay, `upgradeToFragments()` is triggered automatically.
4. State switches to `upgrading`, progress resets, fragments are embedded **without clearing existing full-verse embeddings**.
5. On finish, `hasFragments = true`, badge flips from **v1** → **v2**.
6. If the user navigates away, the worker keeps running because the sync manager is a singleton outside React lifecycle.

### Multi-Monitor / Live Output (Web + Desktop)

### Architecture
The live output system has **two code paths**: native (Tauri desktop) and web (browser Presentation API). Both are managed through `useNativeMultiMonitor`, which auto-detects the environment.

### Microphone Access (Web Speech + Desktop Whisper)
`getUserMedia({ audio: true })` is gated differently on each platform:

- **Web** — browser shows its own permission prompt. Failure (`not-allowed`) means the user denied or an extension blocked the prompt.
- **macOS desktop (Tauri)** — `src-tauri/Info.plist` carries `NSMicrophoneUsageDescription` **and** `NSSpeechRecognitionUsageDescription` (the latter is required for the WKWebView Web Speech API — without it, the host app SIGABRTs the first time the user clicks the mic). Tauri 2.x's codegen auto-embeds this file's keys when feature `custom-protocol` is **off** (i.e. `tauri dev`); when it is **on** (default in `Cargo.toml` and always on for `tauri build` / release bundling), the codegen skips the embed and the bundler writes a fresh `Info.plist` from `tauri.conf.json` that drops our custom keys. `src-tauri/src/main.rs` calls `tauri::embed_plist::embed_info_plist!` manually under `#[cfg(all(target_os = "macos", feature = "custom-protocol"))]` to close that gap. macOS shows its own prompt the first time the app calls `getUserMedia`. If the user denies it, they must re-enable in **System Settings → Privacy & Security → Microphone** (and Speech Recognition for the second key).
- **Windows desktop (Tauri)** — WebView2 requires the host executable's **application manifest** to declare `<DeviceCapability Name="microphone"/>`. Without it, `getUserMedia` fails **immediately with `NotAllowedError` before any user prompt** — the user never sees a dialog. We embed the manifest via `src-tauri/app.manifest` and wire it through `tauri_build::WindowsAttributes::app_manifest(include_str!("app.manifest"))` in `build.rs`. If the OS-level toggle is off, the user must enable it in **Settings → Privacy & security → Microphone**.

**Error messages MUST branch on `isDesktop()`** — Tauri has no "browser settings" page to point users at, so the generic "Enable microphone access in browser settings" copy is wrong on desktop and confuses users. See:
- `src/hooks/useVoiceSearch.ts` (line ~242) — Tauri/desktop-specific message.
- `src/services/sermon-listener/speechRecognition.ts:521-528` — same pattern for the old sermon-listener path.
- `src/services/sermon-listener/transcriptionErrors.ts:70-82` — same for the `TranscriptionError.userAction` string.

**Verification after every Tauri upgrade:** `plutil -p path/to/Selah.app/Contents/Info.plist | grep -E "Microphone|Speech"` — both keys must be present in the shipped RELEASE app or the WebKit speech recognition TCC check will SIGABRT the app.


### Critical Rule: Every desktop-only code path MUST have a web fallback
When adding features to `useNativeMultiMonitor`, `ScreenPicker`, or `LiveOutput`:
- Every `if (isDesktop)` branch MUST have an `else` that handles web mode
- `openLiveWindow()` MUST NOT throw in web mode — use `multiMonitorService.startPresentation()` or `window.open()` as fallback
- `detectMonitors()` MUST call `setMonitors()` in BOTH branches — the web branch previously only returned mapped screens without updating React state, causing "No screens detected"
- `init()` web branch MUST auto-detect screens (call `multiMonitorService.detectScreens()` + `setMonitors()`), not just subscribe to `webState`
- ScreenPicker MUST use `monitors` (not `screens`) for the screen list, since `monitors` is the unified state that's populated in both modes

### Testing
- Test files: `src/store/__tests__/sharedQueue.test.ts`, `src/hooks/__tests__/liveSessionSync.test.ts`, `src/hooks/__tests__/useNativeMultiMonitor.test.ts`
- Key scenarios covered: queue sync backward compat (queue vs queuedSlideIds), operatorSlideIds operator-only sync, collaboration mode behaviors, session cleanup race conditions, screen detection mapping

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
