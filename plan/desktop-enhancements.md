# Desktop App Enhancements Plan

**Last reviewed:** 2026-08-23 (audited against the shipped code at 0.1.20)

Originally written before the desktop app existed. Most of it has since shipped — often in a
different shape than proposed. This revision records what is actually there, so the remaining
items are visible without re-reading the codebase.

## Status at a glance

| # | Enhancement | Status | Notes |
|---|---|---|---|
| 1 | Native multi-monitor | ✅ Shipped | `src-tauri/src/multi_monitor/`, `useNativeMultiMonitor`, `ScreenPicker` |
| 2 | Global hotkeys | ❌ **Open** | No `tauri-plugin-global-shortcut`. See below |
| 3 | System tray | ✅ Shipped (reduced scope) | `main.rs:229` — Show / Toggle listening / Quit |
| 4 | Local Whisper | ✅ Shipped (different design) | In-process engine, not a sidecar binary |
| 5 | Native file dialogs & drag-drop | 🟡 Partial | Plugins installed; drag-drop is still web-based |
| 6 | Auto-update | ✅ Shipped | `tauri-plugin-updater`, `useAppUpdater`, signed `latest.json` |
| 7 | Window state persistence | ✅ Shipped | `useWindowStatePersistence` |
| 8 | Custom title bar | ❌ Open | Low priority — see below |

---

## Shipped — for reference

### 1. Native multi-monitor ✅
Built as proposed: a real second Tauri window, positioned on the chosen display, true
fullscreen, no permission prompt. `src-tauri/src/multi_monitor/` plus `ScreenPicker` in the
UI. The Presentation API path is still there as the browser fallback.

### 3. System tray ✅ (reduced scope)
`setup_tray` in `main.rs:229` gives Show Selah / Start–Stop Listening / Quit, plus
left-click-to-reveal. The original proposal also wanted a slide thumbnail, next/previous
buttons, and a recents list in the tray menu. Those were not built and, on reflection, mostly
belong in global hotkeys (#2) rather than a menu the operator has to open and aim at.

### 4. Local Whisper ✅ (different design)
The proposal was a bundled `whisper.cpp` binary driven through Tauri's sidecar feature. What
shipped is better: an **in-process** engine (`src-tauri/src/transcription/engine.rs`) over
`transcribe-cpp` (GGUF/Whisper family) and `transcribe-rs` (ONNX — Parakeet, Moonshine,
SenseVoice, GigaAM, Canary), behind the `native-transcription` feature flag. No subprocess, no
IPC serialisation per chunk, per-platform GPU backends, and a model idle-unload timer.
Model download happens at build time via `scripts/download-gguf-model.mjs`.

### 6. Auto-update ✅
Shipped with a deliberate correction to the original design: `check_update` only *reports*;
`install_update` installs. Nothing restarts the app on its own — an auto-restart mid-service
was the failure mode worth designing out. See `docs/UPDATER.md` and `useAppUpdater.ts`.

### 7. Window state persistence ✅
`useWindowStatePersistence` restores controller position and the live-output display.

---

## Still open

### 2. Global hotkeys — **the remaining Phase 1 item**

**Problem:** Web apps cannot register system-wide keyboard shortcuts. An operator running
Selah behind a lyrics-projection window, a browser, or ProPresenter cannot advance a slide
without alt-tabbing back.

**Solution:** `tauri-plugin-global-shortcut`, with **one registry owning every binding**.

| Hotkey | Action |
|--------|--------|
| `Ctrl/Cmd + Right` | Next slide |
| `Ctrl/Cmd + Left` | Previous slide |
| `Ctrl/Cmd + Space` | Go live / Clear |
| `Ctrl/Cmd + B` | Blank screen |
| `Escape` | Emergency clear |

Three constraints learned since this was written:

1. **Rebinding must not require a restart.** A hotkey registered once at startup and never
   re-registered is a well-known trap — the setting changes, the binding does not, and the
   operator concludes the feature is broken. The registry must support atomic
   re-registration when settings change.
2. **Conflicts must be detectable.** Both against the OS (`Cmd+Space` is Spotlight on macOS —
   the table above is aspirational, not final) and against other Selah bindings.
3. **`Escape` cannot be a global shortcut.** Registering it system-wide would swallow Escape
   in every other application on the machine. Emergency clear stays app-scoped.

> ⚠️ **Coordinate with `plan/dictation-mode-and-distribution.md` Phase A**, which needs the
> same plugin for the dictation push-to-talk key. Whichever lands first builds
> `src-tauri/src/shortcuts.rs`; the other registers into it. Do not build two registries.

### 5. Native file dialogs & drag-drop — partial

`tauri-plugin-dialog` and `tauri-plugin-fs` are installed and used. Drag-and-drop
(`MediaUpload.tsx`, `SongMigrationWizard.tsx`) is still the web `onDrop` path, which works but
cannot accept a file dragged from Finder onto the dock icon or the window chrome, and gives no
access to the real filesystem path.

Remaining, in rough value order:
- Tauri's `onDragDrop` webview event for real OS file drops
- Watch-folder support for a media directory
- Export to PDF / PPTX (not started; larger than it looks)

### 8. Custom title bar — open, low priority

`decorations` is still default-true. Worth doing only alongside a broader chrome pass; the
space it reclaims is not currently the constraint on the dashboard layout.

---

## Revised priority

| Priority | Item | Impact | Complexity |
|---|---|---|---|
| 1 | Global hotkeys (#2) | High | Low–Medium |
| 2 | OS file drag-drop (#5) | Medium | Low |
| 3 | Watch folders (#5) | Medium | Medium |
| 4 | Tray: next/prev/go-live (#3) | Low | Low — largely obsoleted by #2 |
| 5 | Export to PDF/PPTX (#5) | Medium | High |
| 6 | Custom title bar (#8) | Low | Medium |

## Answers to the original open questions

The four questions at the foot of the original document have been settled by what shipped:
local Whisper was prioritised and built, the tray app exists in reduced form, and
multi-monitor came first. No outstanding decisions here — the live ones now live in
`plan/dictation-mode-and-distribution.md` §1.8.
