# Handy → Selah: Transcription Inspiration Notes

Source: `/Users/danielabakah/code/opensource/Handy` (Tauri 2.x + Rust `whisper-rs` + React).

Selah already has solid pieces — Silero VAD (`vadTranscriptionService.ts`), a
hallucination filter (`hallucinationFilter.ts`), WAV workers, and a sync manager
for embeddings. The notes below are **gaps or improvements** worth borrowing
from Handy, organised by impact. Code references use `file:line`.

---

## 1. Engine-failure recovery via `catch_unwind` (HIGH)

**Problem.** Selah's whisper flows (`whisperCppTranscription.ts`,
`desktopWhisperTranscription.ts`) wrap calls in `try/catch` but never recover
from a native panic. A single panic inside the Whisper/ONNX runtime poisons
the binding and every subsequent `transcribe()` call hangs or throws
cryptically. Also: if the engine panics mid-recording during a live sermon,
we lose the rest of the service.

**Handy pattern** — `transcription.rs:508-682`:
- `catch_unwind(AssertUnwindSafe(...))` around the engine call.
- On panic: **do not put the engine back** (drop it, effectively unload),
  clear `current_model_id`, emit `model-state-changed { event_type: "unloaded",
  error: "Engine panicked: …" }`, and return a descriptive `Err`. Next
  transcription auto-loads the model fresh.
- `lock_engine()` uses `unwrap_or_else(|p| p.into_inner())` to recover from
  a poisoned mutex — `transcription.rs:167-172`.

**Apply to Selah:**
- `desktopWhisperTranscription.ts`: wrap every `whisper_full()` / ONNX
  inference in `try { … } catch (e) { this.unloadEngine(); throw }` and
  recreate the engine on the next call.
- `unifiedTranscription.ts` already has provider abstraction — extend it
  with `recoverFromEngineError(err): Promise<void>` that the outer loop
  calls once before retrying.
- Add a structured "engine-crashed" event so the UI can show a non-fatal
  banner ("Transcription engine reset — resuming") instead of a frozen
  spinner.

---

## 2. RAII load guard via `Drop` (`LoadingGuard`) (MEDIUM)

**Problem.** Selah's `embeddingSyncManager.ts` has an "auto-upgrade to
fragments" flow but no protection against two concurrent `startSync()` calls
clobbering each other's batch counters and IndexedDB writes. Same risk for
`unifiedTranscription` if the user double-taps the live-transcript button.

**Handy pattern** — `transcription.rs:50-63, 183-193`:
```rust
pub struct LoadingGuard {
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}
impl Drop for LoadingGuard {
    fn drop(&mut self) { /* clear flag, notify_all */ }
}
```
Plus `try_start_loading() -> Option<LoadingGuard>` that atomically checks
and sets the flag, returning `None` if a load is already in flight.

**Apply to Selah:** Wrap the loading state in a TypeScript class with a
`Symbol.dispose` (TS 5.2+) or `try { … } finally { this.isLoading = false;
this.notifyWaiters(); }` block. Have `useEmbeddingStatus.ts` and the live
listener share the same `SyncCoordinator` singleton so only one upgrade can
run, and a second call returns immediately with the current status.

---

## 3. Idle watcher for model unload (`model_unload_timeout`) (MEDIUM)

**Problem.** Selah's `embeddingSyncManager.ts` unloads immediately after
`completed`. Handy takes the opposite approach: keep the model loaded for N
minutes of idle so the next sermon doesn't pay a 30-90 s load penalty. The
embeddings worker stays in memory once warmed.

**Handy pattern** — `transcription.rs:92-161`:
- Spawn a watcher thread that ticks every 10 s.
- Skips the `Immediately` variant (would unload mid-recording).
- While recording, calls `touch_activity()` so the timer never expires
  during a live session.
- `maybe_unload_immediately("transcription")` is called **after** the work
  finishes — `transcription.rs:241-251, 730`.

**Apply to Selah:** Add a `ModelUnloadTimeout` enum to
`embeddingSyncManager.ts` (`Never | Immediately | After(1m) | After(5m) |
After(15m)`). Persist via existing settings store. Default to
`After(5m)` so a second service back-to-back doesn't reload. The
`audioRecorderIdle` flag (no capture for 60 s) should reset the timer the
same way Handy does.

---

## 4. Resumable, SHA-256-verified model downloads (MEDIUM)

**Problem.** Selah's `embeddingSyncManager.ts` downloads the embedding
ONNX model from `blob.handy.computer`-style CDN; if the user's network
blips at 380 MB they restart from 0. There is also no integrity check.

**Handy pattern** — `model.rs:987-1140`:
- Store `.partial` file alongside the final file.
- On retry, send `Range: bytes=<partial_size>-`. If server replies `200 OK`
  instead of `206 Partial Content`, delete the partial and restart
  (`model.rs:1058-1074`) — avoids corrupt concatenation.
- After download: `verify_sha256()` against `ModelInfo.sha256`
  (`model.rs:941-985`). Mismatch → delete and re-download.
- `DownloadCleanup` RAII guard (`model.rs:66-86`) clears
  `is_downloading` + `cancel_flags` on every error path.
- Cancellation via `Arc<AtomicBool>` checked inside the stream loop;
  `cancel_download()` (`model.rs:1442`) flips it and joins the task.

**Apply to Selah:**
- Store `embeddingModel.partial` and resume via `fetch` `Range` header
  (browser-supported). Verify with `crypto.subtle.digest('SHA-256', …)`.
- Wrap each phase (download, load, embed) in a `try { … } finally {
  manager.emit('phase-changed', { phase: 'idle' }) }` so the UI never gets
  stuck on "Loading…" if anything throws.

---

## 5. Smoothed VAD with onset + hangover frames (HIGH)

**Problem.** Selah's `vadTranscriptionService.ts` uses `@ricky0123/vad-web`
defaults (likely single-frame decisions). Handy's `SmoothedVad`
(`vad/smoothed.rs:1-105`) is a wrapper that:
- Requires **N consecutive speech frames** before declaring `in_speech`
  (onset).
- Buffers `prefill_frames` so the user doesn't lose the first word after a
  silence.
- Continues capturing for `hangover_frames` after silence to swallow
  mid-phrase pauses ("and… uh… the Lord").

**Apply to Selah:**
- Wrap the existing MicVAD in a `SmoothedVad` equivalent
  (`src/services/sermon-listener/smoothedVad.ts`).
- Use sermon-appropriate defaults: `prefill=15` (≈450 ms),
  `hangover=20` (≈600 ms — pastors pause for effect), `onset=2`.
- Skip the first 2 s of every recording (speakers clear throats, mic
  feedback). Already a partial pattern in `whisperCppTranscription.ts` —
  make it a first-class setting.

---

## 6. Whisper `initial_prompt` for "Bible-aware" bias (MEDIUM)

**Problem.** Selah's faster-whisper config doesn't pass an initial prompt,
so it often mistranscribes "Psalm" as "some", "verse" as "first", proper
names as random words. The `hallucinationFilter.ts` then patches
**after** the fact with regexes. Whisper's `initial_prompt` biases the
decoder **before** generation — much higher recall and no fragile regex
chains.

**Handy pattern** — `transcription.rs:546-551`:
```rust
initial_prompt: if settings.custom_words.is_empty() {
    None
} else {
    Some(settings.custom_words.join(", "))
}
```
And `commands/models.rs:106-121` resets `selected_language` to `auto` if
the new model doesn't support it — prevents stale settings from breaking
transcription.

**Apply to Selah:** Build a dynamic prompt from the user's installed Bible
version + their `cachedLiveTranscript` glossary + common theological
terms. Rebuild it once per sermon (cache in IndexedDB alongside
`localEmbeddings.ts`). For the desktop whisper path pass it via
`--prompt` / JSON body; for the faster-whisper HTTP path pass
`initial_prompt` / `prompt`.

---

## 7. Fuzzy custom-word correction (Levenshtein + Soundex + n-gram) (LOW-MEDIUM)

**Handy implementation** — `audio_toolkit/text.rs:1-195`:
- `apply_custom_words()` matches against custom vocabulary with **n-grams
  of size 1..3** so "Charge B" → "ChargeBee" works.
- Score = `levenshtein` (normalized) × `0.3` when Soundex matches
  phonetically, otherwise raw Levenshtein.
- Preserves case pattern (ALL CAPS → ALL CAPS, Title → Title) — important
  for Bible book names.
- Preserves surrounding punctuation ("Charge B," → "ChargeBee,").
- Length pre-filter (`max 25% length difference`) prevents over-matching.

**Apply to Selah:** Wire `applyCustomWords()` into
`unifiedTranscription.ts` post-processing, **after** the existing
`hallucinationFilter.ts` runs. Use it for:
- Custom sermon vocabulary set by the pastor (church name, staff names,
  partner organisations).
- Auto-built list from the user's cached sermon notes
  (`referenceContext.ts`).

The fuzzy approach is strictly better than the current "exact match"
expected by Selah — Whisper commonly outputs "Sermon on the Mount" as
"certain on the mount" etc.

---

## 8. Language-aware filler / stutter filtering (MEDIUM)

**Problem.** Selah's `hallucinationFilter.ts` is English-only and only
handles repetition + profanity. Pastors who preach in Spanish, French,
Portuguese, or Twi hit Whisper's full "uh/um/hmm" wall.

**Handy implementation** — `audio_toolkit/text.rs:197-320`:
- `get_filler_words_for_language()` returns per-language filler sets. The
  fallback (unknown language) deliberately **excludes** "um", "eh", "ha"
  because they're real words in Portuguese/Spanish — important
  correctness call.
- `collapse_stutters()` collapses 3+ consecutive identical short words
  ("wh wh wh wh why" → "w wh why") — empirically 5-15% of sermon
  transcripts have these artefacts from slow speakers.
- Whitespace cleanup + trim in one pass.

**Apply to Selah:**
- Promote `filter_transcription_output()` into
  `src/services/sermon-listener/fillerFilter.ts`.
- Wire `app_language` from the existing i18n / settings store
  (Handy uses `settings.app_language` — Selah already has the equivalent).
- Combine with `hallucinationFilter.ts` so the order is: **raw →
  hallucination → filler → custom-words** (each layer assumes a clean
  input from the previous).

---

## 9. Always-on vs on-demand microphone mode (LOW for now)

**Handy pattern** — `audio.rs:159-187, 218-240, 386-415`:
- `MicrophoneMode::AlwaysOn` opens the stream at app startup and keeps
  it warm; only ~30 ms latency on hotkey.
- `MicrophoneMode::OnDemand` opens on first hotkey press.
- `schedule_lazy_close()` keeps the stream open for 30 s after the last
  recording (configurable) so a second hotkey press is instant. Uses an
  atomic `close_generation` counter so a fresh recording cancels the
  pending close (`audio.rs:218-240`).

**Apply to Selah (later):** This is more relevant for the desktop
Tauri/web dichotomy (Selah already handles both via
`useNativeMultiMonitor`). When adding a "sermon mode" quick-toggle,
default to "warm" — open mic on entry to LiveView, close on exit.
`nativeVadCapture.ts` already opens streams lazily; change to warm on
mount.

---

## 10. WAV padding for short utterances (LOW)

**Handy pattern** — `audio.rs:472-481`:
```rust
if s_len < WHISPER_SAMPLE_RATE && s_len > 0 {
    let mut padded = samples;
    padded.resize(WHISPER_SAMPLE_RATE * 5 / 4, 0.0);  // 20s minimum
}
```
Whisper silently returns garbage for clips < 1 s. Handy pads to 20 s of
zero-fill if too short.

**Apply to Selah:** Same minimum-duration guard at
`unifiedTranscription.ts:transcribeAudio()` — pad with silence before
sending to any provider. Cheap, removes a whole class of "What did they
say?" failures for short "Amen"s and altar-call responses.

---

## 11. Race-safe audio stop with `EndOfStream` drain (MEDIUM)

**Handy pattern** — `recorder.rs:489-521`:
- After `Stop`, drain the channel with a **2 s timeout** until the cpal
  callback flips a `stop_flag` and posts an `AudioChunk::EndOfStream`
  sentinel.
- Without this drain, the last 50-200 ms of audio (one cpal buffer) is
  lost — enough to swallow a verse reference.

**Apply to Selah:** `nativeAudioCapture.ts` and `nativeVadCapture.ts`
both stop and return immediately. Add the same drain: after stop, keep
the consumer alive until either (a) `onSilence(>=1000ms)` fires or (b) a
2 s timeout. Then flush the WAV encoder worker and dispose. This is a
silent quality win for live-transcript verse detection.

---

## 12. Forced-failure testing hook (LOW)

**Handy pattern** — `transcription.rs:441-446`:
```rust
#[cfg(debug_assertions)]
if std::env::var("HANDY_FORCE_TRANSCRIPTION_FAILURE").is_ok() {
    return Err(anyhow::anyhow!("Simulated transcription failure"));
}
```
Lets QA hit the "engine crashed → recover" code path without breaking
anything in production.

**Apply to Selah:** Same env-gated throw inside
`desktopWhisperTranscription.ts:transcribeAudio()` and
`unifiedTranscription.ts:transcribeAudio()`. Document it in the AGENTS
testing section so reviewers know the path exists and is covered by
`__tests__/`.

---

## Quick-win prioritisation

Status legend: ✅ done · ⬜ todo

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | `catch_unwind` engine recovery | High (no more frozen UI) | Medium | ✅ |
| 5 | Smoothed VAD wrapper | High (cleaner transcripts) | Low | ✅ |
| 11 | EOS drain on stop | Medium (no dropped verses) | Low | ✅ |
| 8 | Language-aware filler filter | Medium | Low (port from Handy) | ✅ |
| 6 | Whisper `initial_prompt` | Medium | Low | ✅ |
| 2 | RAII loading guard | Medium (no double-upgrades) | Low | ✅ |
| 7 | Fuzzy custom-word correction | Medium | Medium (port + test) | ✅ |
| 3 | Idle model-unload timeout | Medium (UX) | Low | ✅ |
| 4 | Resumable + verified downloads | Medium | Medium | N/A (see below) |
| 12 | Failure-injection env flag | Low | Trivial | ✅ (with #1) |
| 10 | Short-clip padding | Low | Trivial | ✅ |
| 9 | Always-on mic mode | Low (future) | High | ⬜ |

The top four (1, 5, 11, 8) are all small wins and address bugs the current
Selah implementation is exposed to during a live sermon — start there.

---

## Implementation log

**Done (this pass):** 1, 5, 7, 8, 11 (+ 12, bundled with 1).

- **#8** → `src/services/sermon-listener/fillerFilter.ts` (+ tests). Wired into
  `useSermonListener.ts` post-processing: `raw → hallucination → filler → custom-words`.
- **#7** → `src/services/sermon-listener/customWords.ts` (+ tests). Levenshtein +
  Soundex + 1–3-gram, case/punctuation preserving. Phonetic-boost and n-gram width
  are options; the always-on `SERMON_PROPER_NOUNS` list uses a SAFE profile
  (`maxNgram: 1`, `usePhonetic: false`, threshold `0.25`) to avoid over-matching
  (`prophet`→`propitiation`, n-gram eating `of righteousness`). User-curated vocab
  can still use the full Handy profile.
- **#5** → `src-tauri/src/audio_capture/vad.rs`. Added `onset_chunks` (default 3 ≈
  96 ms) to `VadConfig`/`VadSegmenter` so a single noisy frame can't open a segment.
- **#11** → `src-tauri/src/audio_capture/mod.rs` + `nativeAudioCapture.ts`. Added an
  `end_of_stream` terminal event; JS now stops capture first and drains (2 s cap)
  before unlistening, so the final flushed utterance isn't dropped.
- **#1 / #12** → `desktopWhisperService.ts`. Structured `recovering/recovered/failed`
  events (`onWhisperEngineEvent`) surfaced as `engineStatus` + a non-fatal banner in
  `SermonListenerPanel`. Dev-gated `__forceTranscriptionFailure()` injection hook.

**Done (second pass):** 6, 10, 2, 3.

- **#10** → `desktopWhisperTranscription.ts` `padShortClip()` (+ tests). Pads sub-1s
  VAD utterances with trailing silence to a 1.25s floor before encoding.
- **#6** → `bibleInitialPrompt.ts` `buildBibleInitialPrompt()` (+ tests). Replaces the
  inline prompt string; now also biases toward the hard `SERMON_PROPER_NOUNS`, and
  accepts session-specific `extraTerms` (church/staff names, current passage).
- **#2** → `embeddingSyncManager.ts` `ensureModelReady()` (+ tests). Dedups concurrent
  embedder loads and clears `modelLoading` in `finally` (fixes a stuck-flag bug where
  a failed `initializeEmbedder()` left `modelLoading` true forever).
- **#3** → `embeddingSyncManager.ts` idle-unload timer + `localEmbeddings.disposeEmbedder()`
  (+ tests). Keeps the embedder warm for 5 min after the last sync, then frees the
  worker/model. Configurable via `setIdleUnloadTimeout(ms)` (`Infinity` = never, `0` = immediate).

**Not applicable:** #4 (resumable + SHA-256-verified downloads). The premise (a ~380 MB
CDN download) doesn't match Selah: the MiniLM embedding model is ~22 MB and **bundled as
a Tauri resource on desktop** (`assets/embedding-models/`, see `localEmbeddings.resolveLocalModelPath`),
with Transformers.js managing its own Cache-API storage on web. There is no large
network download to resume or checksum, so Range-resume + SHA-256 would be speculative
infrastructure with no real payoff. Revisit only if a large model is ever fetched from a CDN.

**Remaining:** #9 (always-on mic) — deferred, high-effort and lower value for the
desktop/web split (see section 9).