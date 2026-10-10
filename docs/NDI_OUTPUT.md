# NDI Output

Sends the live output over the network as an NDI source (`Selah Live Output`), so
vMix, OBS, a hardware switcher or another machine can take it as an input.

The NDI runtime is loaded at run time (`src-tauri/src/ndi_output/ndi_lib.rs`), and
**the runtime itself now ships in the app** on Windows and Linux — see
`src-tauri/ndi-runtime/`. Those platforms need no NDI Tools install. macOS still
does, until its dylib is added.

The bundled copy is searched *before* the system one, so an older NDI Tools install
cannot shadow the version a release was tested against. The bare library name
remains a candidate, so anyone pointing `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` at
their own build still wins over the guessed system locations.

## Status

| Platform | Capture backend | Status |
|----------|-----------------|--------|
| Windows | Windows.Graphics.Capture (`capture_windows.rs`) | ✅ Confirmed working on hardware (0.1.12+) |
| macOS | ScreenCaptureKit (`capture.rs`) | ⚠️ Needs the Screen Recording permission; the gate is in place but the fix has not been reproduced on a Mac |
| Linux | XComposite + MIT-SHM (`capture_linux.rs`) | ✅ Verified against a real X server and a live libndi sender; X11/XWayland only |
| Web | — | Not applicable |

Audio is captured on macOS only. Windows (WGC) and Linux (X11) are video-only.

---

## NDI without a live window: the canvas feed

**Settings › Outputs › Alternate output**, destination **NDI**, content **Follow
main output**, **Alpha channel** off. This is a program feed that needs no live
output window and no spare display, the way EasyWorship and ProPresenter treat
NDI: one destination among others.

The main output's NDI toggle still mirrors the live output window, and still
refuses to start without one. It is the only feed that carries **video**
backgrounds (see below).

### How it works

`src/hooks/useAlternateOutput.ts` → `src/services/ndi-output/canvasFeed.ts` →
`ndi_push_frame` → `src-tauri/src/ndi_output/push.rs`.

- **Rendering.** `renderSlideToCanvas` (`src/lib/graphics/renderSlide.ts`) draws
  the slide. With alpha off it paints the slide's backdrop too, through
  `renderBackdrop.ts`, dimmed and blurred by the slide's own settings:
  - colours;
  - CSS gradients (`cssGradient.ts`);
  - images, cover-fit;
  - motion backgrounds.

  It also draws running countdowns, follows the slide's text alignment, and
  crossfades between slides over the transition duration. With alpha on, only
  the text goes out, on transparency, for a switcher to key.
- **Frame clock.** `CanvasFeed` draws a frame only when something changed or is
  moving: a new slide, a crossfade, a motion background, a running countdown. Its
  ticks come from a dedicated worker (`feedClock.worker.ts`), because a hidden or
  minimised window's own timers are throttled to about 1 Hz and
  `requestAnimationFrame` stops. A frame that can't go out because the previous
  one is still being sent is skipped, not queued.
- **Transfer.** Each frame is read back with `getImageData` (RGBA, straight
  alpha: NDI's own format) and sent as a raw IPC body with its size in headers,
  never as a JSON array.
  - Budget: 8.3 MB per 1080p frame, so 250 MB/s at 30 fps while something moves.
  - A still picture costs one transfer, because Rust repeats it.
- **Pacing.** `push.rs` gives each channel a one-frame mailbox and a pacing
  thread (filmcraft's playback design).
  - `ndi_push_frame` drops the frame in the mailbox and returns, so the main
    thread never waits on NDI's `clock_video`.
  - The thread sends at the output's frame rate (its **format**: 30 or 60 Hz).
    It sends the newest frame, or repeats the last one, so receivers see a steady
    source.
  - Repeats go straight from the buffer, without a copy.
- **Health.** `ndi_push_stats` counts frames submitted, sent, dropped (replaced
  in the mailbox before they went out), repeated and late. The alternate output's
  badge in Program Output shows them on hover.
- **One driver.** Settings and the live panel both use the hook, but only the
  first mounted instance drives the feed.

### What the canvas feed doesn't draw

| | Why | Instead |
|---|---|---|
| Video backgrounds | Needs decoding a `<video>` into the canvas, frame by frame | The slide goes out as its text, and the badge reads **ALT — TEXT ONLY** |
| Lower-third text build-ins, word morph | DOM-only animations (`useTextBuildIn`, `useWordMorph`) | The text appears with the slide's crossfade |
| The beat-reactive visualizer and kinetic text | DOM-only | — |
| Alerts | Not drawn on the projector either | — |

### Still to do

- **Video backgrounds.** Draw a hidden `<video>` into the frame
  (`drawImage(video)`, or `VideoFrame` from `requestVideoFrameCallback`). Video
  decode stays on the main thread, so it can still stall while the window is
  hidden.
- **Workers can be throttled too** under OS power saving. 2D `OffscreenCanvas` in
  a worker would move the drawing itself off the main thread. It's not supported
  on older WebKitGTK and WKWebView, so it needs feature detection.
- **1080p60 over IPC** hasn't been measured on low-end machines. If it doesn't
  keep up, have the worker `fetch` the IPC endpoint directly, then consider
  BGRA/UYVY or half-resolution frames.

## ⬜ TODO: macOS builds are unsigned, so the Screen Recording grant doesn't stick

Symptom: the main output re-asks for "screen and audio" on every start, even with
Selah enabled under Privacy & Security › Screen & System Audio Recording.

Cause: macOS keys a TCC grant to the app's code signature. Nothing in
`.github/workflows/build-desktop.yml` or `tauri.conf.json` signs or notarises the
macOS bundle, so each build has a different identity and the previous grant does
not apply to it. Re-adding the app in System Settings fixes it until the next
build.

Two mitigations are in place, neither a cure:

- `capture.rs` no longer polls `SCShareableContent::get()` while the grant is
  missing. That call *is* what raises the prompt, and the wait-for-window loop ran
  every two seconds — so an unrecognised grant produced a dialog every two
  seconds. It now stops with an explanation instead.
- Audio capture is opt-in (`NdiOutputConfig::default`), so the prompt asks for the
  screen alone. Only the macOS backend can capture audio anyway, and system audio
  is a stricter grant on macOS 15.

The fix is to sign and notarise the macOS build: an Apple Developer ID
certificate, `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` /
`APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` in the
workflow secrets, and `hardenedRuntime` in the bundle config. tauri-action picks
those up. That also removes the Gatekeeper warning on first launch, so it is worth
doing for its own sake.

## Other known gaps

- **Wayland is not supported on Linux.** A natively-Wayland Selah has no X11
  window to capture. `capture_linux::preflight` says so and suggests
  `GDK_BACKEND=x11`. The real fix is a PipeWire/xdg-desktop-portal backend, which
  is roughly 3–4× the work of the X11 one and needs `ashpd`/`pipewire-rs` (not
  currently in the tree) plus testing on a real Wayland desktop.
- **No audio on Windows or Linux.** WGC is video-only; the X11 path likewise.
- **NDI output is Pro-only** — `LiveOutput` checks `isPro` before starting.

## Operator-facing failures

All of these refuse *before* a sender is announced, because announcing a source
that never receives a pixel shows up as a black feed that looks like a working
output with a blank slide:

| Situation | What the operator sees |
|-----------|------------------------|
| No live output window | "NDI sends what the live output window shows…" plus an **Open live output** button (tagged with `LIVE_WINDOW_MISSING_CODE`, mirrored by `NDI_LIVE_WINDOW_MISSING` in `src/hooks/useNdiOutput.ts`) |
| macOS Screen Recording denied | Instructions to grant it in System Settings › Privacy & Security › Screen & System Audio Recording |
| Windows older than 10 1903 | Windows.Graphics.Capture is unavailable |
| Linux without X11/MIT-SHM | The `GDK_BACKEND=x11` hint |
| No NDI runtime installed | Install NDI Tools from ndi.video |

The status badge in Program Output reads **NDI — NO FRAMES** until the sender has
actually pushed frames, so "running" can never again mean "announced but silent".

## Testing

```sh
# Linux: capture + the whole loop against a real libndi sender.
# Both skip cleanly without an X display or without the runtime.
NDI_RUNTIME_DIR_V6="/path/to/NDI SDK for Linux/lib/x86_64-linux-gnu" \
  cargo test --no-default-features --features custom-protocol,ndi capture_linux -- --nocapture
```
