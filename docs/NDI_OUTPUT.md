# NDI Output

Sends the live output over the network as an NDI source (`Selah Live Output`), so
vMix, OBS, a hardware switcher or another machine can take it as an input.

The NDI runtime is loaded at run time (`src-tauri/src/ndi_output/ndi_lib.rs`), so
releases always ship the feature and availability depends only on whether NDI
Tools is installed on the machine.

## Status

| Platform | Capture backend | Status |
|----------|-----------------|--------|
| Windows | Windows.Graphics.Capture (`capture_windows.rs`) | ✅ Confirmed working on hardware (0.1.12+) |
| macOS | ScreenCaptureKit (`capture.rs`) | ⚠️ Needs the Screen Recording permission; the gate is in place but the fix has not been reproduced on a Mac |
| Linux | XComposite + MIT-SHM (`capture_linux.rs`) | ✅ Verified against a real X server and a live libndi sender; X11/XWayland only |
| Web | — | Not applicable |

Audio is captured on macOS only. Windows (WGC) and Linux (X11) are video-only.

---

## ⬜ TODO: NDI cannot be an output on its own

**The limitation.** NDI mirrors the live output window, so you cannot use NDI as
your only output — a live output window has to be open first, which in practice
means sending the output to a screen you may not have. Turning NDI on without one
is refused with "NDI sends what the live output window shows, and it isn't open
yet."

This is weaker than EasyWorship and ProPresenter, where the program output is
rendered internally and NDI is simply one destination you tick. **It is an
artifact of how the feature was built, not a deliberate decision.**

**Why it happens.** Selah's live output is a webview (DOM) window. Nothing in the
app renders slide frames independently of a window, so the only available source
of pixels is an OS window capture — and all three backends (ScreenCaptureKit,
Windows.Graphics.Capture, XComposite) need a real, mapped window to point at. A
minimized window produces no frames on any of them.

The vestige of the other approach is still in the tree: `ndi_send_video_frame`
(`src-tauri/src/ndi_output/commands.rs`) and `ndiOutputService.sendVideoFrame`
(`src/services/ndi-output/index.ts`) exist and have **no callers** — they were
meant for a frontend that produced its own frames.

### Option 1 — NDI-only mode via an offscreen live window (smaller change)

Create the live window as usual but place it offscreen (or otherwise out of the
way) at a chosen resolution, so NDI behaves like an independent output from the
operator's point of view.

Most of the plumbing exists: `open_live_window`
(`src-tauri/src/multi_monitor/commands.rs`) already accepts a monitor,
`fullscreen`, `decorations` and `always_on_top`.

Caveats to settle before committing to it:

- The window must stay **mapped** — minimizing it yields no frames on any backend.
- The NDI resolution has to be chosen explicitly (e.g. 1920×1080) instead of
  inherited from a display.
- Whether offscreen placement captures cleanly needs testing **per backend**, not
  assuming. Linux is the most promising: the composite-pixmap path exists
  precisely so windows that aren't visible still capture — but it has only been
  exercised against a normal mapped window.

### Option 2 — Render slides to a canvas and push frames directly (correct answer)

Makes NDI genuinely independent of any window, which is how the apps above work.

Needs:

- A canvas renderer for slide content — text, image and video backgrounds,
  templates. None of this exists today.
- A binary IPC path. The current wrapper does `Array.from(data)` on the pixel
  buffer, which is unusable for ~8 MB at 30 fps.

Substantial work, not a tweak.

**Recommendation:** Option 1 is the pragmatic route to NDI as a first-class
output without rewriting the rendering layer. Option 2 only if the canvas
renderer becomes worth having for other reasons.

---

## ⬜ TODO: a second NDI feed that carries media

The main output's NDI feed carries everything — fliers, photos, video — because
it captures the live output window. The alternate output over NDI does not: it
renders its own frames on a canvas, which is what keeps its alpha channel and
lets it work with no window at all, but the canvas renderer draws text, not media.

So today: **one** NDI feed with full fidelity (the main output), plus an alternate
NDI feed that is text/graphics only. Sending the alternate output to a monitor
gives it full fidelity, because that is a real window running `LiveView`.

The fix is to let the alternate output be *captured* rather than rendered, and the
existing **Alpha channel** setting is the natural switch, because the two are
mutually exclusive on one feed:

| Alpha channel | Mechanism | Carries |
|---|---|---|
| Enabled | canvas frames (today) | text, lower thirds — with transparency |
| Disabled | capture its window | everything, opaque |

What it needs:

- An **offscreen** alternate window when the destination is NDI, since capture
  needs a real mapped window and there may be no spare display. See the offscreen
  notes in the section above — a minimized window yields no frames on any backend.
- The capture backends generalised. All three hardcode the live window
  (`LIVE_WINDOW_TITLE = "Live Output"` in `capture_windows.rs`, and the same in
  `capture.rs` / `capture_linux.rs`), and `NdiManager` holds a single sender plus
  a single `capture_stop` flag, so a second capture needs a per-window
  sender/stop pair. `PushChannels` already shows the shape.

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
