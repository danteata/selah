# Dictation Mode & Distribution — Plan

**Status:** Proposed · **Created:** 2026-08-23 · **Owner:** unassigned

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
- [ ] Dictation history (reuse the saved-transcript IndexedDB pattern), with copy

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
