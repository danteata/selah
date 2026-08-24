# Dictation Mode & Distribution — Plan

**Status:** Phase A shipped in 0.1.21 · **Created:** 2026-08-23 · **Updated:** 2026-08-24 · **Owner:** unassigned

## Provenance

Came out of reviewing **Murmur** — a local push-to-talk dictation app (a WhisperFlow
competitor) built on camera in [this walkthrough](https://youtu.be/dErOXLMT8CU) by
*Web Prodigies*. Tauri + Rust + React, local Whisper, global hotkey, floating pill,
auto-paste into the focused app.

**The headline finding is that we are already past it.** Murmur is roughly the transcription
half of Selah, built overnight and debugged on camera. Every engineering lesson the video
surfaces, we have already solved — in several cases more carefully than the video does.
Part 0 records that with evidence, so nobody watches it again and re-proposes the work.

What is left is one feature we genuinely do not have, and one distribution decision we have
already deferred once and should now revisit.

---

## TL;DR

| Part | What | Verdict |
|---|---|---|
| **0** | Every technical lesson in the video | Already done — no action |
| **1** | Dictation Mode (global push-to-talk, paste anywhere) | The one real gap. Build it |
| **2** | macOS / Windows code signing | Known deferral (`docs/UPDATER.md`). Worth revisiting for our audience |
| **3** | First-run demo media | Small, cheap, optional |
| **5** | Session recording & transcript history | Replaced dictation history. The bigger feature, and mostly already written |
| **6** | Handy upstream sync | Reviewed to 2026-08-23. Three worth taking |

---

# Part 0 — Already ahead of the video (no action)

Each row is a problem the video hits on camera, and where we already handle it.

| Video's problem | Timestamp | Our state |
|---|---|---|
| Mic permission checked once at mount, so the app "listens" at a dead device | ~52:00 | `stream.play()` returning is not treated as capture running. The capture callback sets a first-chunk flag and the supervisor fails the session when audio never arrives — `fix(audio): notice a microphone that opens but never delivers` (4d1faff, 0.1.20) |
| Finalize has no timeout, so actors wedge permanently | 48:02 | `TranscriptionEngine::await_finalize` uses `recv_timeout(Duration::from_secs(30))` and falls back to batch transcription on expiry — `src-tauri/src/transcription/engine.rs:793` |
| 3s paste delay because word-count stats run before the text lands | 54:10 | `setTranscript()` commits the text to the UI *before* `processTranscript()` runs verse detection — `src/hooks/useSermonListener.ts:2768,2786` |
| Hotkey rebinding needs an app restart | 48:23 | Not applicable: we register no global shortcuts yet. Part 1 must not reintroduce it |
| Model warm-up makes the first use fail silently | 25:24 | Idle watcher holds a loaded model for 300s by default (`UnloadTimeout::After(Duration::from_secs(300))`, `engine.rs:76`), configurable via `set_unload_timeout` |
| Whisper silently auto-translates non-English speech to English | 28:12–29:48 | `language` (`None`/"auto" for detect) and `translate` are explicit engine config — `engine.rs:52-57`, `commands.rs:267` |
| Scans / unreadable audio produce nonsense with no explanation | — | `hallucinationFilter.ts`, `fillerFilter.ts`, `singingDetection.ts`, `transcriptDedup.ts` |
| Onboarding drops the user at "allow access" with no idea what to do | 55:42 | `SermonListenerWizard` — Choose Input → Test Audio → Ready, with a live level meter |
| macOS ggml-metal crash on quit | — | Fixed ahead of the video (f1e2685, from Handy #1902) |

Two process notes from the video that are worth keeping in mind but need no work here: the
agent tried an `rm -rf`-shaped command against the repo (22:22), and a one-shot overnight
build left seven settings declared but never wired (47:43). Our `plan/` + review-doc habit
already covers the second.

---

# Part 1 — Dictation Mode

## 1.1 Why this one is worth building

Every part exists already. We ship the models (`scripts/download-gguf-model.mjs`), the
engine (`src-tauri/src/transcription/engine.rs`), VAD capture
(`start_capture_with_vad`, `nativeVadCapture.ts`), device management (`useAudioDevices`),
a tray icon (`main.rs:229`), and multi-window output. What is missing is a global hotkey and
a way to put text into whatever the operator is typing in.

There is also an in-app case that stands on its own. `useVoiceSearch` — our current voice
input for Bible refs and song titles — is the **Web Speech API**: cloud-dependent, needs
internet, quality varies by browser engine. Dictation Mode replaces it with the local engine
we already bundle, which means voice search works in a church hall with no Wi-Fi.

Concretely, the operator can:
- dictate an announcement or alert straight onto a slide, mid-service, without typing
- dictate sermon notes into the notes panel
- speak a Bible reference or song title into search, offline
- (system-wide) dictate into anything else on the machine — the WhisperFlow use case

## 1.2 Scope decision — do the in-app half first

Split deliberately:

- **Phase A (in-app)** — hotkey works while Selah is focused; text goes into the focused
  Selah input. No OS accessibility permission, no keystroke synthesis, no new permissions
  prompt. Ships the offline-voice-search win on its own.
- **Phase B (system-wide)** — hotkey works anywhere; text is pasted into whatever app has
  focus. Needs macOS Accessibility (TCC) permission and a keystroke-synthesis dependency.

Phase A is worth shipping alone. Phase B is the part that turns it into a Murmur competitor,
and it should not gate A.

## 1.3 Coordination with the existing plan

`plan/desktop-enhancements.md` §2 already proposes `tauri-plugin-global-shortcut` for
**presentation control** (next/prev slide, blank screen, emergency clear). That plan is stale
in general — items 1, 3, 4, 5, 7 (multi-monitor, auto-update, tray, window state, local
whisper) are all shipped — but §2 is still open, and it needs the same plugin.

**Register both from one place.** A shortcut registry module owns every global binding,
presentation and dictation alike, so conflicts are detectable and the whole set can be
re-registered atomically. Whoever picks up either item should do this part once.

## 1.4 Architecture

```
tauri-plugin-global-shortcut
   └─ src-tauri/src/shortcuts.rs      ← single registry: presentation + dictation
        └─ dictation hotkey pressed
             ├─ show pill window (always-on-top, transparent, no decorations)
             ├─ start_capture_with_vad  (existing)
             └─ on release / VAD silence:
                  ├─ request_finalize + await_finalize  (existing, 30s timeout)
                  ├─ EMIT TEXT FIRST  ────────────────► insert / paste
                  └─ then: history write, stats, analytics
```

**Two modes**, both of which the video demonstrates and both of which operators expect:
- *Push-to-talk* — hold the key, release to commit. Best mid-service; no chance of leaving
  the mic hot.
- *Toggle* — press to start, press to stop. Better for long dictation.

**Pill window.** A second Tauri window, transparent + `always_on_top` + skip-taskbar, in the
style of the existing live-output window. Two states only: listening (level meter) and
transcribing (spinner). Remember its position per display; the video's pill kept appearing on
the wrong monitor because nothing persisted it (24:31). We already have
`useWindowStatePersistence` — reuse it.

**Model choice.** Dictation is latency-sensitive in a way the sermon listener is not — the
operator is waiting with a cursor blinking. Default to the fastest bundled ONNX path
(Parakeet / Moonshine) rather than large-v3, and keep it warm via `set_unload_timeout` while
dictation is enabled. Make it a separate setting from the sermon-listener model: they are
different jobs with different tradeoffs, and sharing one setting will produce a bad default
for one of them.

**Emit first, then bookkeeping.** The text must reach the input before we write history,
count words, or fire analytics. This is the video's clearest lesson (54:10) and the only one
we do not automatically inherit — the sermon listener gets the ordering right, but this is
new code on a new path.

## 1.5 Permissions — check at the point of use

The rule the video learns the hard way (52:00), stated for the implementer:

- **Do not** check microphone or accessibility permission once at app start and cache it.
- **Do** check at the moment of the action — when the hotkey fires, and again when the paste
  is attempted — and surface an actionable message with a deep link to the right System
  Settings pane if it is missing.
- The onboarding step and the runtime path must call the **same function**, so the button in
  the wizard and the hotkey cannot disagree about whether we have permission.

macOS specifics: `NSMicrophoneUsageDescription` is already in `src-tauri/Info.plist` and
embedded via `main.rs`. Phase B additionally requires **Accessibility** permission
(`AXIsProcessTrusted`) to synthesise keystrokes — that is a separate TCC grant the user makes
in System Settings, it cannot be prompted for repeatedly, and denying it is not recoverable
in-session. Detect it, explain it, and fall back to clipboard-only (see below).

## 1.6 Getting text into the target

| Path | Mechanism | Notes |
|---|---|---|
| Phase A, in-app | Direct insert into the focused React input | No new permission, no new dependency |
| Phase B, preferred | Clipboard write + synthetic paste keystroke | Needs Accessibility on macOS |
| Phase B, fallback | Clipboard write only, pill says "copied — press ⌘V" | Works with no Accessibility grant |

The fallback is not a consolation prize — ship it as the Phase B default and let auto-paste
be the thing the user opts into after granting permission. It means the feature works
immediately on first launch, which is exactly where the video's version failed (57:03).

New crates for Phase B: a clipboard crate (`arboard`) and a keystroke-synthesis crate
(`enigo`). Both are cross-platform; both need a Linux path check (X11 vs Wayland) before we
promise Linux support.

## 1.7 Phases

### Phase A — In-app dictation *(first increment landed 2026-08-23)*
- [x] Add `tauri-plugin-global-shortcut = "2.0"` to `src-tauri/Cargo.toml`
- [x] `src-tauri/src/shortcuts.rs` — one registry for all global bindings, with
      re-registration on settings change (**no restart required** — see Part 0).
      Reports per-binding failures rather than throwing, so one taken accelerator
      does not cost the operator the rest of the set
- [x] Wire hotkey → `start_capture_with_vad` → transcription → commit
      (`src/hooks/useDictation.ts`)
- [x] Insert into focused Selah input, before any bookkeeping
      (`src/services/dictation/insertText.ts`, 11 tests)
- [x] Hotkey-conflict detection, surfaced in Settings → Shortcuts
- [x] Settings: enabled, hotkey (live key recorder), mode (push-to-talk / toggle)
- [x] **Final-utterance drain** — unplanned, but the feature does not work without
      it; see the note below
- [x] Settings: model and input-device pickers, both defaulting to "same as
      Sermon Listener" so nothing changes until the operator asks. The model
      setting needed plumbing, not just a control — see the note below
- [x] Pill window — transparent, always-on-top, click-through, placed on the
      display the main window is on. `src-tauri/src/dictation_pill.rs` +
      `public/dictation-pill.{html,js}`; see the two notes below
- [x] `useVoiceSearch` runs on the local engine on desktop, with Web Speech as
      the fallback — the offline-voice-search win; see the note below
- [ ] Seen working in a running app — the pill's appearance, its placement, and
      the focus rule below are covered by reasoning and unit tests, not by
      having been watched on screen
- ~~Dictation history~~ — **dropped**, and replaced by Part 5. Reasoning there.

**The final-utterance drain.** `nativeTranscriptionService.stop()` invoked
`stop_capture` and tore its listener down in the same tick. For a continuous
sermon session that is harmless — it stops during silence, with nothing in
flight. For push-to-talk it dropped *the entire dictation*: the operator holds
the key, speaks one sentence, releases before the VAD has seen a silence
boundary, and the flushed segment arrives after the listener is gone.

The capture thread already does the right thing (flush the pending segment, wait
for the transcription worker to drain, then emit a terminal `end_of_stream`
marker — `audio_capture/mod.rs:1164-1207`), and `nativeAudioCapture` already
waits for it. `nativeTranscriptionService` did not. `stop()` now takes an opt-in
`waitForFinalMs`, defaulting to `0` so the sermon listener's behaviour is
unchanged; dictation passes 2000.

> Worth a follow-up: the sermon listener stops without a drain too. It matters
> far less there, but "stop pressed while the preacher is still talking" is not
> a hypothetical, and the fix is now one argument.

**The pill must never take focus.** This is the constraint the window is shaped
around, and it is not obvious from the outside. `insertTextAtCaret` refuses when
`document.hasFocus()` is false, so a pill that activated on show would move
focus to itself and send *every* dictation to the clipboard instead of the
field — presenting as the insertion code being broken rather than the indicator
being at fault. Three things prevent it: the window is built `focused(false)`,
it is created once and thereafter only shown/hidden (a rebuild is another chance
to activate), and it ignores cursor events so a stray click passes through.

**The pill cannot be dragged**, which is a deliberate trade against the original
"position persisted per display" line in §1.4. Ignoring cursor events is what
makes it impossible to steal focus by accident, and the failure that actually
needs solving — the reference implementation's pill appearing on the wrong
monitor — is solved by placing it on the monitor the main window is on, which it
recomputes on every show. If operators ask to move it, the way back is a
drag-handle region with `set_ignore_cursor_events(false)` only while the modifier
is held, not making the whole window clickable.

**Level meter for free.** The pill subscribes to the `audio-features` frames the
capture loop already broadcasts for the visualiser, so there is no second stream
to plumb or keep in sync.

**The dictation model was a setting nothing read.** `AppSettings.dictation.model`
existed from the first increment, but `nativeTranscriptionService.start()`
resolved the model itself from `settings.sermonListener.whisperModel` — so
adding a picker alone would have shipped a control that does nothing, which is
precisely the failure the source video ended on (seven settings declared, none
wired). `start()` now takes an optional `modelId` that takes precedence, with
three tests covering override, fallback, and no-reload-when-resident.

**Both pickers default to inheriting.** "Same as Sermon Listener" rather than a
fast model chosen on the operator's behalf: only one model is resident at a
time, so a differing choice costs a load on the first dictation after either
feature runs. The panel says so when the two differ — the symptom is otherwise a
slow first dictation that reads as the feature being sluggish. Model downloads
stay in the Sermon Listener panel; this one lists only what is already on disk,
so there are not two places managing one set of files.

**Voice search now prefers the local engine, and falls back rather than
refusing.** The engine choice is made per `start()`, not at render, because the
deciding fact changes underneath: the sermon listener holds the engine for the
length of a service, and that is exactly when someone reaches for voice search
on the Bible panel. So `busy` is an expected answer, not a failure — desktop
falls through to Web Speech and voice search keeps working mid-service.

What this buys is the error list it routes around. The Web Speech path carries
branches for macOS wanting a *separate* Speech Recognition permission on top of
the microphone one, macOS wanting Dictation enabled on top of *that*, Windows
wanting "Online speech recognition", and the backend shipping only in Google
Chrome so Arc and Brave fail on a good network. Every one of those exists in
`useVoiceSearch` because it was hit. None of them apply to a model already on
disk — and it works in a hall with no Wi-Fi, which is the case that matters on
a Sunday.

The session logic is a plain module (`services/dictation/nativeVoiceSearch.ts`),
not a hook: React owns UI state, it owns one utterance, and it is testable
without a renderer. Both engines share `normalizeQuery`, which strips the
trailing punctuation speech engines add while keeping the colon in "John 3:16" —
the Whisper family punctuates far more readily than Web Speech did, so the
existing inline strip mattered more once the local path landed. Bounded like
everything else in this pipeline: a silence budget and a hard session ceiling,
so a stuck VAD cannot hold the microphone open.

`isSupported` is now also true on desktop regardless of Web Speech, so the mic
button is not hidden in a WebView that lacks it — WKWebView and WebView2 both
have, at times.

**Input channel follows the device.** Dictation inherits the listener's channel
index only while it is also inheriting its device. Channel 3 of a four-channel
desk is not a channel on the headset the operator just picked — the same
reasoning `SermonListenerSettings.handleDeviceChange` already applies when the
device changes under it.

### Phase B — System-wide dictation
- [ ] Accessibility permission detection + deep link to the settings pane
- [ ] Clipboard-only mode as the default
- [ ] Auto-paste as an opt-in after the grant
- [ ] Onboarding step: grant → dictate one test sentence → confirmed working

### Phase C — Nice to have
- [ ] Per-language selection reusing the existing `language`/`translate` engine config
- [ ] Custom vocabulary — feed `customWords.ts` (church names, hymn titles, local place
      names) into the dictation prompt the same way the sermon listener does
- [ ] "Time saved" counter, if we want it. The video has one; it is pure delight, no utility

## 1.8 Open questions

1. Is this a Pro feature or free? Sermon Listener is feature-gated; dictation shares its
   engine and its cost profile is nearly zero (local). Suggest free — it is a retention
   feature, not a revenue one.
2. Ship Phase B on Linux, or macOS + Windows only at first? Wayland keystroke synthesis is
   the risk.
3. Does dictation get its own tray menu entry, or live only in Settings?

---

# Part 2 — OS code signing

## 2.1 Where we are

`docs/UPDATER.md` §"OS-level code signing (deferred)" already records this as a conscious
deferral, with the cost table. Nothing has changed technically since — I verified
`.github/workflows/build-desktop.yml` sets `TAURI_SIGNING_PRIVATE_KEY` (the **updater**
signature, which is correctly in place) but no `APPLE_*` or Authenticode secrets, and
`src-tauri/tauri.conf.json` has `certificateThumbprint: null` for Windows and no
`signingIdentity` for macOS.

So: shipping unsigned on both desktop platforms, by decision, not by oversight.

## 2.2 Why it is worth revisiting now

The deferral reasoning — "you can ship without them for v1" — is sound for a developer
audience. Ours is not one. Selah is installed by church volunteers, often on a Sunday
morning, often by whoever is available. The video shows the exact experience (59:19–60:19):
System Settings → Privacy & Security → scroll → "Open Anyway" → confirm again. That is a
funnel leak measured in installs that never happen and a support burden measured in
WhatsApp messages.

There is also an auto-update interaction: our updater is signed and works, but each new
version an unsigned app downloads carries quarantine, so the Gatekeeper prompt is not
strictly a one-time cost on macOS.

**Recommendation:** macOS Developer ID ($99/yr) is the highest-leverage money we can spend on
install conversion. Windows Authenticode is a second decision — SmartScreen reputation
accrues over downloads, so an OV cert helps less immediately and costs more.

## 2.3 Zero-cost interim (do this regardless)

Whether or not we buy a certificate, the install instructions should exist and currently do
not. `README.md` has no install section covering it, and Gatekeeper is mentioned only in
passing in `docs/NDI_OUTPUT.md:147`.

- [ ] `docs/INSTALL.md` — screenshotted first-launch walkthrough for macOS and Windows
- [ ] Link it from the README and from wherever the download lives
- [ ] Say plainly why the warning appears ("we have not yet bought Apple's certificate") —
      volunteers installing church software are right to be suspicious of a scary dialog,
      and an honest explanation converts better than silence

## 2.4 If we buy the certificate

- [ ] Apple Developer Program enrolment ($99/yr) — allow days, not hours, for org verification
- [ ] Add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
      `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` as repo secrets
- [ ] `signingIdentity` + `hardenedRuntime` in `tauri.conf.json` → `bundle.macOS`
- [ ] Notarization + stapling in the workflow
- [ ] **Do not touch the Tauri updater signing** while doing this — `docs/UPDATER.md` is
      emphatic and correct: that key is bound forever and is a separate mechanism
- [ ] Verify: `spctl -a -vvv Selah.app` and a clean-VM download-and-launch test

---

# Part 3 — First-run demo media

The video's one UI idea we do not already have (55:42): short looping clips in the onboarding
flow showing the feature working, instead of a bare "allow microphone access" button.

`SermonListenerWizard` covers the mechanics well (Choose Input → Test Audio → Ready) but shows
nothing of what the feature *does*. A 3-second clip of a spoken reference turning into a Bible
slide would explain Sermon Listener better than the paragraph we currently write.

- [ ] 2–4 short muted loops (WebM/MP4) in the wizard steps
- [ ] Same for Dictation Mode's onboarding once Phase B lands

Low priority, low effort, genuinely improves first-run comprehension for a non-technical
operator.

---

# Part 4 — Explicitly not worth taking

- **The "agent OS" multi-agent workflow.** Cross-session agent messaging, overnight one-shot
  builds. The video's own outcome argues against it: seven settings declared and never wired,
  and the author's advice at 46:12 is *"never build the way I'm building right now."*
- **The `$2B app` / `1% of weekly usage` framing.** Marketing.
- **A separate standalone dictation product.** Tempting, since the engine is already ours,
  but it is a different product with a different audience, a different support surface, and a
  crowded market (Handy, WhisperFlow, MacWhisper). Dictation *inside* Selah serves our
  operator; a standalone app serves someone else's.

---

# Part 5 — Session recording & transcript history

**Replaces the dictation-history item.** Written 2026-08-24 after reading Handy's
implementation (`src-tauri/src/managers/history.rs`, `src/components/settings/history/`).

## 5.1 Why dictation history was the wrong feature

Murmur and Handy both keep a scrollback of dictations because in those apps the
dictation **is the only artifact** — there is nowhere else for it to live. In Selah it
lands in a slide, the notes panel, or a search box, and *those* are the durable thing. A
list of "youth meeting Tuesday 7pm" snippets duplicates what is already on the slide, and
a dictation that comes out wrong is retyped in less time than opening a history panel
would take.

The asymmetry that matters: **a dictation is recoverable, a sermon is not.** If the mic
was wrong, the band bled into the vocal aux, or the model struggled with an accent, the
transcript is poor and the audio is gone. That is the loss worth engineering against.

## 5.2 Most of this is already written, and switched off

Both halves exist in the tree behind `#[cfg(debug_assertions)]`, built for
`devAccuracyReport.ts`:

| Piece | Where | State |
|---|---|---|
| Record a session's raw audio | `start_session_recording` / `stop_session_recording`, `audio_capture/session_recorder.rs` | dev-only. Records the raw buffer, not just VAD-flagged speech — which is what makes re-transcription meaningful |
| Re-transcribe a saved file | `transcribe_audio_file`, `transcription/commands.rs:217` | dev-only. Explicitly loads a bigger model than realtime affords |
| Persist transcripts | `saveSermonTranscript` / `getSavedSermonTranscripts` (IndexedDB) | shipped, text only |

So the missing work is: audio persistence in production, a join between audio and
transcript, a UI, retention, and consent.

> ⚠️ **"Mostly built" is a read of signatures and doc comments, not of behaviour under
> production conditions.** That dev path only ever ran with a developer watching. Anything
> promoted out of `debug_assertions` deserves a real read before it carries an estimate —
> error handling, disk-full, and a session that ends by the app being force-quit are all
> cases nobody has needed to survive yet.

## 5.3 Consent is the first design question, not a footnote

This is where Selah and Handy genuinely differ, and it is the reason this part is not
simply "port Handy's history".

Handy records one person's own voice, on their own machine, for a few seconds. Selah would
record **45 minutes of a room full of people** — congregational prayer, a testimony, a
pastoral aside, children. That is a different thing ethically and in some places legally,
and it cannot be a checkbox nobody reads.

Non-negotiables, before any of 5.4:

- **Off by default**, enabled per church by someone with authority to make that call —
  not per operator, and not by whoever happens to be running the desk.
- **Unmistakably visible while recording.** Not a subtle dot. The operator must be able to
  answer "are we recording?" from across the room, and the recording indicator must be
  distinct from the listening indicator.
- **Say plainly where the file is and who can reach it** — local disk, this machine, not
  uploaded. If that ever stops being true, it is a new consent conversation.
- **Deleting a session deletes the audio**, immediately and for real.

If we cannot do those four well, we should ship the transcript half and not the audio.

## 5.4 What to build, ranked by value per unit of work

Built in dependency order rather than this one — the other three all need recordings to
exist before they mean anything.

1. [x] **Re-transcribe a past session with a better model.** The one capability that cannot
   be had any other way. `transcribe_audio_file` turned out to be gated on the
   `native-transcription` feature rather than `debug_assertions`, and that feature is in
   `default` — so it already shipped in release builds and only its doc comment claimed
   otherwise. The service reads the loaded model first and restores it afterwards, or
   re-transcribing on Large silently leaves Large loaded for the next service.
2. [x] **Session list** — date, duration, size, play, star, delete, re-transcribe
   (`SermonArchive.tsx`). The join to the saved transcript is still open; the archive
   currently stands on its own by date.
3. [x] **Retention policy** — never / 30 days / 3 months / a year / last-10-unstarred.
   Swept at startup, in TypeScript because it depends on starring.
4. [x] **Star / keep**, exempt from both retention rules.

5. [x] **Join a recording to its transcript.** Stored on the recording's metadata rather
   than referenced: a reference would have to point at one of two different transcript
   systems (IndexedDB or Convex) and would dangle whenever history was cleared. A few tens
   of KB per service. The archive shows the live text above the re-transcribed one rather
   than replacing it — which is better is the operator's judgement, and they cannot make it
   against nothing.
6. [x] **Export a recording** — a copy, not a move, so sending a sermon to the pastor does
   not remove it from the archive and from retention's view of it.

Still open in this part:

- [ ] Replace a saved transcript with a re-transcribed one in place. Today the operator
      copies the better text; wiring it back into the transcript record means deciding
      which of the two transcript systems owns the result.
- [ ] Seen working in a running app. The WAV-header repair is no longer only reasoned —
      six Rust tests exercise it against real files on disk, including one zeroed the way
      a force-quit leaves it — but nothing here has been watched on screen.

## 5.5 What not to take from Handy's version

- **`post_processed_text` / `post_process_prompt` on the entry.** Selah's LLM cleanup
  already lives in `llmSummarization.ts` and `sermonNotes.ts`; a second, entry-scoped
  prompt would be a competing home for the same idea.
- **Infinite-scroll pagination at 30/page.** Handy has one entry per dictation, so
  thousands. Selah has roughly one per service — about 52 a year. A plain list is right.
- **SQLite (`history.db`).** Handy needs it for that volume. Selah already persists
  transcripts to IndexedDB; adding a second store for ~52 rows a year is not worth the
  migration surface. (Implemented as `sermonRecordingMeta`, IndexedDB v10.)
- **"Reveal in Finder".** It needs an opener plugin this project does not have, which is
  more surface than a convenience button earns. The archive copies the folder path
  instead — which also works when the operator is reading it to someone over the phone.

## 5.6 Open questions

1. Does the audio belong to the operator's machine only, or eventually to the church
   (synced, shared)? Answering "eventually shared" changes the consent conversation and
   the storage design, so it is worth deciding before building rather than after.
2. Is a sermon archive a Pro feature? Unlike dictation, this one has a real cost story
   (disk, and any future sync).
3. Should recording follow the Sermon Listener's start/stop, or be independently armed?
   Following is simpler; independent lets someone record without live verse detection.

---

---

# Part 6 — Handy upstream sync

Selah has twice taken fixes from [Handy](https://github.com/cjpais/Handy) — it runs the
same transcription engine and meets the same faults first. This records the state of that
relationship so the next sync starts from a date rather than from scratch.

**Last adopted:** `98a4d80` *disable metal residency on macos* (2026-08-15), shipped as
`f1e2685` in Selah 0.1.20.
**Reviewed to:** `8fd6691` (2026-08-23) — 14 upstream commits, all read.

## 6.1 Worth taking

| Handy | What | Why it applies here |
|---|---|---|
| `c89b7bf` *fall back to default microphone after disconnect* (#1874) | When the selected mic vanishes, resolve to the system default and **persist that** — but only when device enumeration itself succeeded, so a transient backend error cannot erase the operator's saved preference. Rebuilds a recorder that failed since last use rather than handing back a stalled one. | The complement to Selah's 0.1.20 supervisor. Ours catches a device that opens and never delivers; this catches one that **disappears entirely** mid-session. A USB interface knocked out during a service is not hypothetical. The "don't clobber the preference on a transient enumeration error" detail is the part worth copying exactly. |
| `99052ee` *clear stale modifier latch after xdotool type* (#1817) | On Linux, synthesising keystrokes can leave a modifier stuck down afterwards. | Directly relevant to **Phase B**, which needs keystroke synthesis. Worth reading before choosing `enigo`, not after. |
| `2cf157d` *allow multi-word custom-word phrases* (#1406) | The backend accepted spaced entries; the settings UI rejected them. | Not a bug we have — Selah's `customWords.ts` already handles n-grams ("Charge B" → "ChargeBee") and has **no user-facing UI at all** (`SERMON_PROPER_NOUNS` is hardcoded). It is a design note for **Phase C custom vocabulary**: do not reject spaces, or "Ashale Botwe" cannot be entered. |

## 6.2 Worth reading, probably not porting

- `5ec2276` *single writer tray icon* (#1952) — 576 lines reworking tray updates around a
  single writer, with retry on failed applies. Selah's tray is far simpler (Show / Toggle
  listening / Quit) and has shown no symptoms. Revisit only if tray state starts drifting.
- `d55ea7e` *drop the 'gpu' accelerator selector* — Handy collapsing a user-facing
  acceleration choice. Selah does not expose one; noted in case we are ever tempted to.
- `b8ad109` *docs: Bluetooth microphone tradeoff* — on macOS a Bluetooth headset mic forces
  bidirectional audio, degrading playback while recording. Selah has no such note, and the
  advice (keep the headset as output, pick a different input) is worth a line in our own
  audio docs.
- `8758dcc` *docs: macOS Accessibility after local rebuilds* — the grant is tied to the
  binary, so a rebuild silently invalidates it. Phase B will hit this the first time
  someone tests a dev build.

## 6.3 Already have it

- `afbf44c` *transcribe.cpp 0.2.0* — Selah is already on 0.2.0 across every target.

## 6.4 Not applicable

`f6fac42` (updater 2.10.1 — we pin `2.0` and take minors), `5c77861` (handy-keys, their
crate), `286e66c`, `8fd6691`, `0e50367` (bindings, nix, merge).

## 6.5 One more worth knowing

`8282c40` documents that **`fn`/Globe shortcuts only work on Apple keyboards** — `fn` is
not in the USB HID spec, Apple reports it through a vendor usage macOS honours only from
its own devices, and third-party keyboards handle it in firmware and send nothing.

This lands on the hotkey recorder shipped in 0.1.21. It already requires a modifier, and
`fn` does not register as one, so an operator cannot currently bind it — the failure mode
is a key that appears to do nothing while being recorded. Worth an explicit message if
anyone tries, rather than silence.
