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

---

# Second pass: Handy v0.9.4 → v0.9.5 + post-release

Reviewed range: `v0.9.4..db003f3` (49 commits, 2026-07-15 → 2026-08-08). Most of
it is Handy-specific (paste reliability, secure-input warnings, keyboard
diagnostics, tray/login-items, AppImage packaging, i18n) and doesn't apply.
The items below do. Numbering continues from the first pass.

## 13. Input channel selection for multi-channel interfaces (HIGH)

**Handy** — `12f02e2` (#1254), `recorder.rs`. Multi-channel interfaces
(Focusrite Scarlett, MOTU M4, Behringer UMC) expose loopback and aux channels
alongside the mic. Handy averaged everything to mono, so music bled into the
transcript. They added an `Input Channel` dropdown that appears only when the
selected device reports `channels > 1`, defaulting to "Average all channels"
(the old behaviour). Out-of-range selections log a warning and fall back to
averaging rather than erroring.

**Why this matters here more than it did for Handy.** `52b6540` measured a
vocal-only stem against the front-of-house mix and found the vocal feed
collapses no-speech fallback segments from 46 → 1 and lifts distinct words per
unit of audio 1.81 → 3.03. The commit's own caveat was that the vocal feed is
"the input we do not have yet". This is how we get it: a church desk sends a
vocal aux on channel 2 of the same USB interface carrying the FOH mix on
channel 1. Selah currently can't use it — `microphone.rs:96` reads
`config.channels` and hands it straight to `process_audio_samples`, which calls
`mix_to_mono` (`types.rs:278`) and averages the band back in.

**Apply:** add `selected_channel: Option<u16>` threaded from settings →
`start_capture` → `start_microphone_capture` → a deinterleave-one-channel path
in `process_audio_samples`. `list_audio_devices` already returns `channels`
(`microphone.rs:36`), so the UI can gate the dropdown on it with no backend
change. This turns the sound-desk recommendation from a doc note into a
setting.

## 14. Streaming finalize should read `.full`, not `.display()` (HIGH, one line)

**Handy** — `09aaf4d` "fix moonshine streaming giving the wrong results":
```rust
-  Some(stream.text().display())
+  Some(stream.text().full)
```

Selah has the identical line at `transcription/engine.rs:709`, in the same
place (the `StreamCmd::Finalize` arm of the streaming worker), with a comment
asserting the opposite:

> After finalize the committed prefix holds the full text; `display()` =
> committed + tentative is the safe read.

The crate disagrees. `transcribe-cpp-0.1.3/src/streaming.rs:63-76`:

| field | doc |
|---|---|
| `full` | "The raw current model hypothesis (**authoritative**; may rewrite anywhere)" |
| `committed` | "The **append-only**, flicker-free display/input prefix" |
| `tentative` | "The volatile raw suffix after the committed prefix" |
| `display()` | "`committed + tentative` — the flicker-free render most UIs want" |

`committed` is append-only *by construction*, so once finalize rewrites an
earlier span the committed prefix cannot follow it — `display()` returns the
pre-rewrite text. It is the right read for the live-update path (which Selah
already does correctly at `engine.rs:685`), and the wrong one at finalize.
Every streamed song/sermon segment finalized this way may carry a stale prefix.

**Apply:** change line 709 to `stream.text().full` and fix the comment. Worth
re-running the eval in `songTracking.eval.test.ts` afterwards — that suite
measures exactly the transcript quality this affects.

## 15. Recover the capture stream after it dies (HIGH)

**Handy** — `a4348be` (#1838, fixes #1743). When cpal tears a stream down
mid-session (device unplugged, USB/Bluetooth dropout), the worker exits but
the handles stay populated, so the app still reports the stream as open:
recording captures nothing and stays wedged. They detect the dead worker and
rebuild the stream instead of handing back a dead recorder.

**Selah is exposed to a worse version of this.** `microphone.rs:98` is
`let err_fn = |err| eprintln!("Audio stream error: {}", err);` — the stream
dies, we print to stderr, `is_capturing` stays `true`, the capture thread stays
parked on `stop_rx.recv()`, and `audio_buffer` silently stops filling. Nothing
notices. Mid-service that's a projector that quietly stops following, with no
error surfaced to the operator.

Worse still, the VAD thread deliberately keeps the `audio-features` heartbeat
running through delivery gaps (`mod.rs:930-961` — suppressing it caused
spurious watchdog restarts), so a stream that died at 11:04 presents downstream
as a healthy, permanently silent room. The frontend watchdog cannot tell the
two apart, and nothing else in the pipeline can either.

**Apply:** have `err_fn` flag the stream dead, supervise it from the capture
thread, and rebuild with backoff — plus a `capture-stream-error` event so the
operator sees a banner rather than silence.

(An earlier draft suggested modelling the event on "the existing
`onWhisperEngineEvent` plumbing from item #1". That no longer exists —
`desktopWhisperService.ts` was replaced by the native transcription path. The
current equivalent is the structured `transcriptionErrors.ts` code table and
the banner it drives in `SermonListenerPanel.tsx:521`.)

## 16. Re-apply output window geometry on monitor reconfiguration (HIGH)

**Handy** — `16caad7` (#1445). Display off/on, disconnect/reconnect, or a DPI
change while hidden left the overlay cropped and corrupted; the fix reapplies
the window's logical size on show, and tears down/rebuilds listeners properly
instead of leaking stale closures.

**Selah has no handling at all.** `multi_monitor/types.rs:101` defines
`MonitorEventPayload` ("sent to the frontend when monitor configuration
changes") — it is marked `#[allow(dead_code)]` and grep finds no emitter and no
listener. `window_manager.rs` sets the output window's physical position and
size once at creation (`:310-321`) and never revisits it. A projector that
sleeps and wakes, or an HDMI cable reseated mid-service, leaves the live output
window sized for a monitor geometry that no longer exists.

**Apply:** subscribe to Tauri's window/monitor events, emit the payload that
already exists, and re-run `resolve_target_monitor` + `set_position`/`set_size`
for any open output window. This is the single highest-value item for a
projection app, and the type is already written.

## 17. Stall watchdog + retry/backoff on model downloads (MEDIUM-HIGH)

**Handy** — `292db64` (#1773), now `managers/model/download.rs`. Adds
`HTTP_CONNECT_TIMEOUT`, a `DOWNLOAD_STALL_TIMEOUT` of 60 s raced against both
`request.send()` and each `stream.next()`, retry with backoff, and a mirror
fallback with the catalog sha256 as the trust anchor for the untrusted mirror.

The first pass marked resumable/verified downloads "not applicable" — that was
about the 22 MB bundled embedding model, and it's still right for that. But
`transcription/models.rs` *does* download multi-hundred-MB GGUFs from
`blob.handy.computer` and Hugging Face, and it already has Range-resume and
sha256 verification (`:966-998`). What it lacks is the timeout half:
`reqwest::Client::new()` at `:1029` has no timeouts configured, and the
`resp.chunk().await` loop at `:1067` can block forever. A church on venue wifi
gets a progress bar frozen at 62% with no error and no recovery.

**Apply:** wrap `send()` and each `chunk()` in `tokio::time::timeout`, and wrap
`download_to` in a bounded retry loop with backoff. The partial file already
makes each retry cheap — this is a small change on top of infrastructure Selah
has. The mirror fallback is optional; the watchdog is not.

## 18. Move blocking cpal work off the main thread (MEDIUM)

**Handy** — `b4453a2` (#1716). Synchronous `#[tauri::command]` handlers run
inline on the webview run loop, and holding a mutex across a slow CoreAudio
device open/close (Bluetooth/USB) freezes the UI with a beachball. Two fixes:
`is_recording()` reads a lock-free `AtomicBool` mirror instead of locking
state, and the four cpal-running commands moved to `async` + `spawn_blocking`.

**Selah:** `list_audio_devices` (`microphone.rs:13`) is a sync command that
enumerates every input device and calls `default_input_config()` on each — the
exact ~40-85 ms-per-device HAL query Handy measured, serialized on the main
thread, run every time the settings panel opens. `start_capture`
(`mod.rs:174`) is also sync, though it spawns for the heavy part. Selah already
uses `Arc<AtomicBool>` for `is_capturing`, so only half of Handy's fix applies.

**Apply:** make `list_audio_devices` `async` + `tauri::async_runtime::spawn_blocking`.
Cheap, and it removes a visible hitch on a screen operators open under time
pressure.

## 19. Pin glibc's mmap threshold on Linux (MEDIUM)

**Handy** — `96afb0c` (#1846), `src-tauri/src/memory.rs`. glibc's malloc
raises its dynamic mmap threshold (up to 32 MB) after the first large free, so
subsequent multi-MB transient buffers come from arenas that never return to the
OS. Measured at ~15 MB retained per 2-minute dictation; `mallopt(M_MMAP_THRESHOLD,
128 * 1024)` at the top of `run()` cut it to ~0.5 MB. No-op on macOS/Windows/musl.

**Selah's exposure is larger than Handy's, not smaller.** Handy leaks per
dictation — seconds at a time, minutes apart. Selah runs continuous
VAD-segmented capture for a 90-minute service, allocating a PCM buffer per
segment plus the engine's mel/FFT scratch per `transcribe()` call. Extrapolating
Handy's rate, that's hundreds of MB of untouched RSS migrating to swap on a
Linux box, mid-service.

**Apply:** port `memory.rs` verbatim and call `init_allocator()` at the top of
`run()` in `lib.rs`. ~20 lines, one `libc` dep, cfg-gated to glibc Linux.

## 20. Panel-level error containment (MEDIUM)

**Handy** — `6d3239e` (#1822). A markdown-rendering crash in the "What's New"
dialog blanked the entire settings page. Fix: a 35-line `ErrorBoundary` that
logs with a `context` label and renders `null`, wrapped around the subtree that
can fail.

**Correction to an earlier draft of this note,** which said Selah had no error
boundary anywhere. It does — `RouteErrorBoundary` and `ConvexErrorBoundary` in
`src/components/offline/`, and every route in `App.tsx` is wrapped. Selah's is
the better component, too: it categorises the error, reports to analytics, and
offers a reload. The initial grep looked in `src/components/` only and missed
the `offline/` subdirectory.

**The real gap is granularity, which is exactly Handy's point.** Selah catches
at route level, so a throw inside the sermon-listener panel takes down the
whole Dashboard — or, at `LiveOutput.tsx:664`, the entire `/live` route the
congregation is looking at. A panel is not worth a route.

**Apply:** a `PanelErrorBoundary` wrapping the panels most likely to throw,
with a `silent` mode for the projector output (a fallback card there is a card
the congregation reads).

## 21. Preserve HTTP transport error causes (LOW)

**Handy** — `4223e7a` (#1823), plus a follow-up commit specifically to keep the
diagnostics free of sensitive data. Worth mirroring in Selah's download and
Convex error paths if we ever chase a "it just fails on their network" report:
the cause chain is what makes those diagnosable, and the redaction pass is the
part that's easy to forget.

## Reviewed and not applicable

- **Paste reliability** (`a70ac84`, `b1b2d9f`, `0f32df7`, `3ed2b21`),
  **secure-input warning** (`d001fcd`), **keyboard diagnostics** (`099df58`,
  `KeyboardDiagnostic.tsx`), **bindings while recording** (`16e5d48`) — Handy
  is a dictation tool that types into other apps. Selah isn't.
- **`js-yaml` quadratic parsing** (`d961593`) — Selah is already on 4.1.1
  (`bun.lock:934`), and only transitively via `@eslint/eslintrc`.
- **Windows overlay physical-pixel placement** (`e1152d8`) — Handy converged on
  positioning in the destination monitor's physical pixels to dodge tao's
  current-DPI logical conversion. `window_manager.rs:310-321` already uses
  `PhysicalPosition`/`PhysicalSize`. Nothing to change; noted so the next pass
  doesn't re-derive it.
- **Idle skip of level meter and resampler** (`db003f3`) — an always-on-mic
  optimisation. Selah has no always-on mode (item #9, still deferred).
- **Level meter recalibration** (`76b44d8`) — Selah's `AudioFeaturesEvent`
  already applies explicit per-band gain calibrated for 16 kHz mono speech
  (`mod.rs:579-586`). Different implementation, same problem already solved.
- **Overlay on main thread** (`cf49ab3`) — the Linux GDK/Xlib hazard is real
  (monitor/cursor lookups off the GTK main thread corrupt the X11 connection),
  but Selah's monitor queries run inside Tauri command handlers rather than
  from a hotkey thread. Re-check if item #16's reconfiguration listener ends up
  querying monitors from a background thread.
- **System-output mute state** (`8a362e9`), **SMAppService login items**
  (`0902937`), **AppImage packaging** (`b428ae4`, `d7fc6a0`), **i18n/Danish**
  (`f4e3587`, `ea3c20a`, `09a6a71`), **tray/sidebar UI** (`b462aa3`,
  `cdf5028`, `4b3a969`), **portable-installer update link** (`76736d5`),
  **LLM post-processing** (`148e549`, `2211da6`) — no Selah equivalent.

## Prioritisation

| # | Idea | Impact | Effort | Status |
|---|---|---|---|---|
| 14 | Streaming finalize reads `.full` | High (wrong transcripts today) | Trivial | ✅ |
| 16 | Re-apply geometry on monitor change | High (projection app) | Medium | ✅ |
| 13 | Input channel selection | High (unlocks vocal aux feed) | Medium | ✅ |
| 15 | Capture-stream death recovery | High (silent mid-service failure) | Medium | ✅ |
| 19 | glibc mmap threshold (Linux) | Medium (hours-long sessions) | Trivial | ✅ |
| 20 | Panel-level error containment | Medium | Low | ✅ |
| 17 | Download stall watchdog + retry | Medium | Low | ✅ |
| 18 | `list_audio_devices` off main thread | Low-Medium | Trivial | ✅ |
| 21 | HTTP error cause preservation | Low | Low | ⬜ |

## Implementation log (second pass)

- **#14** → `transcription/engine.rs:709`. `stream.text().full` at finalize, with
  the comment corrected to say why `display()` is right on the live path and
  wrong here.
- **#19** → `src-tauri/src/memory.rs` + `init_allocator()` at the top of `run()`.
  `libc` was already a Linux dependency.
- **#13** → `types::downmix(samples, channels, selected)` (+ 6 tests) replaces
  `mix_to_mono`, threaded through `AudioCaptureState.input_channel` →
  `start_capture` / `start_capture_with_vad` → `start_microphone_capture`. UI is
  an "Input channel" dropdown in `SermonListenerSettings`, shown only when the
  selected device reports `channels > 1`; `useAudioDevices` now surfaces the
  count. Switching to a device with fewer channels clears a now-invalid
  selection, and Rust falls back to averaging for an out-of-range index anyway.
  Also fixed while there: a trailing partial frame used to be averaged over the
  full channel count, scaling it down. It is now dropped.
- **#15** → `microphone.rs` restructured around a supervisor loop. `err_fn`
  flags the stream dead; the thread rebuilds it with backoff (250 ms → 4 s, five
  attempts) and emits `capture-stream-error` with `{attempt, recovered, fatal}`.
  A stream must survive 30 s to reset the budget — otherwise a device that opens
  cleanly and dies immediately rebuilds forever without ever backing off or
  reporting fatal. Surfaced via a new `CAPTURE_STREAM_LOST` error code and the
  existing banner. The 5-way sample-format duplication collapsed into one
  generic `build_stream<T>` in the process.
- **#16** → `window_manager.rs`: `spawn_monitor_watcher` polls the layout every
  2 s, and on a change re-applies physical position/size to both output windows
  and emits `monitor-config-changed` (the `MonitorEventPayload` that had been
  declared and never used). Re-matching prefers an exact stable-ID hit, then the
  same display at new coordinates via `stable_id_name_part` (+ 3 tests) — the
  ID encodes position, so a rearranged or replugged projector would otherwise
  look like a different monitor. A display that is genuinely gone leaves its
  window alone rather than relocating the projector onto the operator's laptop.
- **#17** → `models.rs`: `HTTP_CONNECT_TIMEOUT` (15 s) on the client,
  `DOWNLOAD_STALL_TIMEOUT` (60 s) raced against both `send()` and each
  `chunk()`, and `download_with_retries` wrapping the existing Range-resume with
  four backoff steps. Stall is bounded per chunk, not per download, so a large
  model on a slow-but-healthy link isn't killed for taking a while. Cancellation
  is checked between attempts and inside the backoff sleep.
- **#18** → `list_audio_devices` is now `async` + `spawn_blocking`.
- **#20** → `PanelErrorBoundary` (+ `silent` mode) around the sermon-listener
  panel in `LiveOutput`, `DashboardLayout` and `ContextPanel`.

**Verified:** 70 Rust tests (9 new), 1856 frontend tests (1 new), `tsc -b` clean.
Not verified by running the app — the mid-service failure modes these address
(device dropout, display reconfiguration, stalled download) need hardware to
reproduce.

**Remaining:** #21 (HTTP error cause preservation) — left for when a "it just
fails on their network" report actually needs diagnosing; the retry logic from
#17 removes most of the cases where it would have mattered.