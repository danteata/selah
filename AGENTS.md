# Selah — Agent Context

## Client-Side Embedding Architecture

### Local Embeddings (`src/services/sermon-listener/localEmbeddings.ts`)
- **Web Worker** (`embedding.worker.ts`) runs ONNX inference off the main thread so the UI stays responsive during batch embedding.
- `embedText()` / `embedBatch()` post messages to the worker; the worker loads `Xenova/all-MiniLM-L6-v2` from the same CDN and returns embeddings.
- Vite bundles the worker into a separate chunk (`dist/assets/embedding.worker-*.js`).
- `isEmbedderReady()` checks whether the worker has been instantiated.

### Text Preparation Worker (`src/services/sermon-listener/textPreparation.worker.ts`)
- Offloads sentence splitting, deduplication (`O(n²)` char-similarity), and sliding-window generation from `semanticVerseDetection.ts`.
- Pre-compiles the sentence-split regex at module scope (no recompilation per call).
- Main thread posts `text + excludedRanges`, worker returns `{ sentences, dedupedSentences, windows }`.

### WAV Encoding Worker (`src/services/sermon-listener/wav.worker.ts`)
- Offloads audio resampling (cubic Hermite), mono mixing, and WAV encoding from the main thread.
- Used by `whisperCppTranscription.ts` for both live chunk encoding (`encodeChunk`) and blob conversion (`convertBlob`).
- Keeps the UI responsive during live sermon transcription where previously `ScriptProcessorNode` blocked the main thread.

### AudioWorklet (`whisper-capture-processor` inline module)
- Replaces deprecated `ScriptProcessorNode` in `whisperCppTranscription.ts`.
- Runs on the audio rendering thread, accumulating PCM samples and posting full chunks to the main thread.
- The desktop web fallback (`desktopWhisperTranscription.ts`) encodes WAV **directly inside the AudioWorklet** and posts the blob back, eliminating main-thread `pcmToWav()` entirely.

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
