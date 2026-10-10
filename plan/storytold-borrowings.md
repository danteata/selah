# Borrowing from the storytold "Craft" apps

## Overview

[storytold](https://github.com/storytold) publishes clean-room Rust reimplementations of
creative apps. Four of them have something Selah can use: deckcraft (PowerPoint), effectcraft
(After Effects), filmcraft (Premiere) and soundcraft (Pro Tools). This plan covers the pieces
worth taking and the Selah bugs found while comparing the two codebases.

### Licensing

| Repo | Licence | What we can take |
|---|---|---|
| deckcraft, effectcraft, filmcraft, soundcraft, craft-fonts (code) | MIT OR Apache-2.0 | Code, with the notice "Copyright (c) 2026 ArtCraft Team and the <X>Craft contributors" |
| craft-fonts (font files) | OFL-1.1 | Bundling is fine if `OFL.txt` ships with them |
| artcraft | ArtCraft License (fair-source, no commercial use) | **Ideas only** |
| ArtCraft brand assets (`docs/brand/`) | Trademark | Nothing |

Every port gets a header comment naming the upstream file and the copyright line. All notices
go in a new `THIRD_PARTY_NOTICES.md` (linked from `docs/LICENSING.md`), and fonts get their own
`THIRD_PARTY_FONTS.md`.

### How far to trust upstream

These repos were written almost entirely by AI agents within the last few weeks. Their parity
figures are self-graded: effectcraft's own `docs/gaps.md` puts real-work readiness at 30–50%.
The code is clean: lints ban `unwrap`/`todo!`, and there are real unit tests. But it is barely
proven against real files. deckcraft's PPTX reader has only read decks deckcraft itself wrote.
The one exception is effectcraft's keyframe easing, which was checked against live After
Effects to 3e-11. **Treat everything we take as a reference to port and test, not proven
code.**

### Selah bugs found along the way

These need fixing whether or not anything is borrowed:

1. **Slide fonts are never loaded.** The editor offers Inter, Montserrat, Poppins, etc., but
   `src/index.css:2` loads only Crimson Pro and DM Sans. The output machine falls back to
   whatever it has installed (Track 1.1).
2. **Canvas font strings are unquoted.** `fontForRun` (`src/lib/graphics/textRuns.ts:148`)
   builds `600 48px Source Sans 3`, which is invalid, so the browser silently ignores it. The
   same goes for `style={{fontFamily}}` in `SlideView.tsx:154`, `SlideCard.tsx:80` and
   `SettingsModal.tsx:763` (Track 1.1).
3. **std `Mutex::lock().unwrap()` in the transcription engine.** At
   `transcription/engine.rs:206-231` the engine runs under `catch_unwind`, so a caught panic
   poisons the lock and the next call panics (Track 1.3).
4. **The macOS system-audio callback blocks the audio thread.** `macos.rs:81-86` runs the
   preprocessor, allocates and takes the shared `audio_buffer` lock on the ScreenCaptureKit
   queue (Track 1.2).
5. **Linux system audio is reported as supported, but starting it fails.** `mod.rs:120`
   returns `true`, while the dispatch at `mod.rs:300` errors. `linux.rs` is dead code
   (Track 1.2).
6. **The alternate NDI feed runs twice while Settings is open.** `useAlternateOutput()` is
   mounted in both `LiveOutput.tsx:111` and `SettingsModal.tsx:309`, each with its own
   heartbeat and canvas (Track 4.2).
7. **`ndi_push_frame` can stall the main thread.** The sender is created with
   `clock_video: true` (`ndi_lib.rs:364`), so `send_video` blocks for up to one frame interval
   inside a synchronous command. The 500 ms heartbeat hides this today; 30 fps would not
   (Track 4.2).
8. **`useSlideTransition.ts` is dead code.** Nothing imports it. The output only fades the new
   slide in on remount (`SlideView.tsx:386-389`), so the old slide vanishes instantly.
9. **`docs/NDI_OUTPUT.md` is stale.** It says the canvas renderer and the binary push "don't
   exist", but `renderSlide.ts` and `ndi_push_frame` with raw-body headers both do.
10. **No CI runs tests or clippy.** `.github/workflows/build-desktop.yml` only builds on `v*`
    tags.

## Sequencing

| Order | Work | Effort | Why this order |
|---|---|---|---|
| 1 | Track 1: quick fixes (fonts, macOS audio callback, no-panic lints + CI) | ~3 days | Fixes live bugs. 1.2 fits the current `fix/transcription-falls-behind` branch. The fonts are a prerequisite for 3, 4 and golden tests |
| 2 | Track 4.1: golden-image tests | 2–3 days | A safety net before touching rendering in Tracks 3 and 4.2 |
| 3 | Track 3.B: keyframes + text build-ins (DOM) | ~3.5 days | Small, pure-math port with exact upstream test vectors |
| 4 | Track 3.A: lyric morph | 4–5 days | Brings back real transitions, starting with the one other worship apps don't have |
| 5 | Track 2: PowerPoint import, Phase 0 spike, then MVP | 1–2 days + 6–8 days | The spike decides whether the dependency cost is acceptable |
| 6 | Track 4.2: standalone NDI | ~3 weeks | Largest item; benefits from goldens, fonts and the build-in animations being in place |

Suggested branches: one per numbered item, all off `main`. Exception: Track 1.2 can land on
`fix/transcription-falls-behind`. It only touches the capture front end below `audio_buffer`
and does not conflict with the `job_fate`/session work in `mod.rs` and `engine.rs`.

---

## Track 1: Quick fixes

### 1.1 Bundle the slide fonts (1 day)

**Goal:** every font the editor offers renders the same on the projector, the NDI/alternate
canvas and the operator preview, even offline.

**How fonts are stored:** `slideStyle.font` (`src/types/index.ts:393`, Convex `v.any()`),
`settings.defaultFont` (`appStore.ts:185`, default `'Inter'`), and inline TipTap
`font-family` spans (`TipTapEditor.tsx:81,99`). The live output is a route in the same bundle,
so CSS imported from `main.tsx` reaches it too.

**Steps**

1. Create `src/lib/fonts.ts`:
   - `SLIDE_FONTS = [{ label, family, fallback }]`, one list replacing the two diverging
     copies (`SlideEditor.tsx:99-102`, `SettingsModal.tsx:340-343`).
   - `cssFontStack(name)`, which quotes the family and appends its fallback.
   - `LEGACY_LABEL`, a map so stored names still show as selected.
2. Add static `@fontsource/*` packages: inter, roboto, open-sans, lato, montserrat,
   source-sans-3, poppins, nunito, raleway, playfair-display, gelasio, crimson-pro, dm-sans.
   - **Not** the `-variable` packages: they register `"Inter Variable"`, which wouldn't match
     stored names.
   - In `src/styles/slide-fonts.css`, import weights 400/600/700 plus italics. Keep all
     subsets, because `unicode-range` downloads only what's used and latin-ext covers Twi
     ɛ/ɔ.
3. Alias the renamed family instead of migrating data: add `@font-face` rules named
   `'Source Sans Pro'` that point at the Source Sans 3 files. New picks store "Source Sans 3".
4. Georgia can't be redistributed, so ship Gelasio, its metric-compatible OFL substitute:
   `cssFontStack('Georgia')` returns `Georgia, "Gelasio", serif`. Ubuntu uses the Ubuntu Font
   Licence, not OFL, so drop it or list it separately.
5. Use `cssFontStack` in `fontForRun`, the `renderSlide.ts:83` / `renderLowerThird.ts:195`
   defaults and the DOM `fontFamily` call sites.
6. In `useAlternateOutput.ts` (~127-141), `await document.fonts.load(...)` for 400/600/700
   per family before drawing (cached), then redraw once. The DOM path already waits on
   `document.fonts.ready` (`AutoFitText.tsx:113`).
7. Remove the Google Fonts `@import` and drop `fonts.googleapis.com` / `fonts.gstatic.com` from
   the CSP in `src-tauri/tauri.conf.json:55-57` and `nginx-security-headers.conf:15`.
8. Write `THIRD_PARTY_FONTS.md`, following craft-fonts' `ATTRIBUTION.md` table, with each
   package's OFL text.

**Cost:** about 1.5–2 MB of woff2 in `dist`. Fontsource CSS also emits `.woff`, which doubles
that. If it matters, hand-write woff2-only `@font-face` rules.

**Verify:** vitest for `cssFontStack`, `fontForRun` (quoted output) and the legacy alias. Then
on a Linux VM with no extra fonts installed, check that projector, NDI and preview match for
every font, and that the network tab shows no Google requests.

### 1.2 Keep work out of the real-time audio callbacks (1–1.5 days)

`microphone.rs` already does this right, with a wait-free `rtrb` ring, a consumer thread,
overrun counting and a resampler flush on stop. The other platforms should share it.

1. Extract `push_frames`, `drain_ring` and `capture_ring` (`microphone.rs:256-312`) into
   `audio_capture/ring.rs` as
   `CaptureRing { consumer, pre, overrun: Arc<AtomicU64> }` with `drain()` and `finish()`
   (drain plus `pre.flush()`). Move the existing ring tests (`microphone.rs:664-742`) with it.
2. **macOS (the real hazard):**
   - `AudioHandler` owns the `Producer<f32>`, behind a lock only the callback touches, taken
     with `try_lock`.
   - `extract_audio_from_buffers` (129-183) writes into `write_chunk_uninit` instead of
     building `Vec`s.
   - The capture thread swaps `stop_rx.recv()` for a `recv_timeout` drain loop that calls
     `finish()` on stop.
3. **Windows:** this is a pull loop, not an OS callback, so it's lower priority. Reuse one
   preallocated buffer, push into the ring, and call `finish()` on exit. This fixes the
   dropped resampler tail.
4. **Linux:** delete `linux.rs` and route `CaptureType::System` to `start_microphone_capture`
   with the first input device whose name contains "monitor". That reuses the supervisor and
   rebuild logic and fixes bug 5. Otherwise, make `mod.rs:120` return `false`.
5. Overruns and cpal `err_fn` go through `tracing::warn!`/`error!` instead of `eprintln!`,
   which never reaches the log file.

**Skip:** soundcraft's audio-thread log marker. cpal's `err_fn` fires once when a stream dies,
not on every buffer.

**Verify:** ring tests plus a new test that `finish()` returns the flushed tail. Then a manual
30-minute macOS system-audio session with zero logged overruns.

### 1.3 No-panic lints + CI (half a day + ~2 h CI)

The raw grep finds 96 `unwrap`/`expect` calls, but about 80 are in `#[cfg(test)]` or
`offline_probe.rs`. About 17 are in production code:

| Site | Fix |
|---|---|
| `transcription/engine.rs:206,214,222,231`, `oauth_listener.rs:67` (std Mutex) | Switch to `parking_lot::Mutex` (already a dependency) |
| `embeddings.rs:134,183` | `let … else` / `get_or_insert` |
| `ndi_output/capture_windows.rs:161,235,311` (D3D out-params) | Map to `Err` |
| `multi_monitor/commands.rs:312`, `dictation_pill.rs:58` (URL parse) | `map_err` |
| `oauth_listener.rs:222` (static header) | `#[allow(…, reason = "…")]` |
| `main.rs:420,499,505`, `logging.rs:63` (startup) | `#[allow(clippy::expect_used, reason = "…")]` |

1. In `src-tauri/Cargo.toml`, set `[lints.clippy]` `unwrap_used`, `expect_used`, `panic`,
   `todo` and `unimplemented` to `"warn"`. Add `src-tauri/clippy.toml` with
   `allow-{unwrap,expect,panic}-in-tests = true`.
2. Convert the sites above, then flip the lints to `"deny"`.
3. In `logging.rs`, install a panic hook after `set_global_default`, modelled on deckcraft
   `crates/engine/src/guard.rs`. It logs location and payload via `tracing::error!`, then
   chains to the previous hook.
4. New `.github/workflows/lint.yml` on `pull_request`:
   - `cargo clippy --all-targets -- -D warnings` and `cargo test --no-default-features`
     (skips ggml/NDI to keep it fast);
   - Linux system deps copied from `build-desktop.yml:129-158`;
   - a `bun run test` job, unless Track 4.1's `test.yml` lands first.

---

## Track 2: PowerPoint import

Source: deckcraft `crates/pptx` (lenient reader), `crates/model/src/resolve.rs` (works out each
text box's effective formatting through slide → layout → master → theme), `crates/render`
(slide to RGBA), and `crates/fonts/src/fontdb.rs` `substitutes()`.

### What we're mapping onto

- Slides belong to a schedule (`convex/schema.ts` ~246-292). There are no positioned text
  boxes: `contents: string[]` is **HTML** (`TipTapEditor.tsx:66` saves `getHTML()`),
  rendered as one auto-fitted block (`SlideView.tsx:230/314`).
- `data` (`v.any()`) and `slideStyle` (`windowPadding`, `alignment`, `font`) can carry what we
  need.
- Desktop media is local-first: files are copied to `appDataDir()/media-library`
  (`src/services/localMediaFiles.ts`), and slides reference them with `localFilePath`.
- Slides are created client-side (`useSlideCreation.ts`), added with `appendActiveSlide`
  (`appStore.ts:509`) and saved through the schedule outbox.

### Decisions

1. **Use a git dependency pinned to a commit**, behind Cargo features:
   ```toml
   deckcraft-pptx   = { git = "https://github.com/storytold/deckcraft", rev = "84acb49895c8190396b686c1eb9f20c730e48633", optional = true }
   deckcraft-model  = { git = "…", rev = "…", optional = true }
   deckcraft-render = { git = "…", rev = "…", optional = true }

   [features]
   pptx-import = ["dep:deckcraft-pptx", "dep:deckcraft-model"]
   pptx-images = ["pptx-import", "dep:deckcraft-render"]
   ```
   - The 2024-edition crates compile under Selah's edition 2021. They need rustc 1.90 or newer
     (local is 1.93).
   - quick-xml 0.38 and thiserror 2 are already in `Cargo.lock`.
   - Fall back to vendoring `pptx`/`model`/`geom`/`color` under `src-tauri/vendor/deckcraft/`
     if we need patches.
2. **Append imported slides to the active schedule**, or create a schedule named after the file
   if none is open.
3. **Desktop only**, gated by `isDesktop()` (`src/platform/index.ts:49`). On web the action is
   disabled with "Available in Selah desktop".
4. **Rust returns a neutral intermediate format; TypeScript builds the HTML**
   (`src/lib/import/pptxToSlides.ts`), so the mapping is unit-testable.

### Mapping (editable mode)

- **Text:**
  - Order: title placeholder, then body, then the remaining shapes sorted by y, x.
  - Effective properties come from `resolve::run` / `resolve::para` / `resolve::text_color`.
  - Output: `<p style="text-align">`, `<strong>`/`<em>`/`<u>`,
    `<span style="color;font-family">`, and `<ul>/<ol>/<li>` for bullets by level.
  - **Escape all text and allowlist the tags and styles**, because this HTML ends up in
    `innerHTML`.
- **Position:** the union of the text shapes' boxes becomes `slideStyle.windowPadding` (%).
  The most common alignment becomes `slideStyle.alignment`. Point sizes are dropped, since
  AutoFit sizes the text.
- **Fonts:** use `substitutes()`, restricted to `SLIDE_FONTS` (Track 1.1). If nothing matches,
  leave the font unset and use the template default.
- **Background:**
  - solid colour becomes `color`;
  - a gradient becomes CSS `gradient`;
  - an image fill, or a picture covering at least 80% of the slide, becomes `image`. It is
    written to `media-library/pptx-<id>/` and referenced by `localFilePath`.
  - Other pictures, EMF/WMF files, SmartArt, charts and video are dropped with a per-slide
    warning.
- **Notes:** stored as `slide.data = { source: 'pptx', deckName, slideNumber, notes }`, with
  the type added to the `Slide['data']` union.

### Tauri command (`src-tauri/src/pptx_import.rs`)

```rust
#[tauri::command]
async fn pptx_import(app: AppHandle, path: String, mode: ImportMode /* editable | images */,
                     import_id: String) -> Result<PptxImportResult, PptxImportError>;
#[tauri::command]
fn pptx_import_cancel(import_id: String);
```

- **Input:** the path comes from `platform.dialog.open` with the
  `pptx`/`ppsx`/`potx` filter.
- **Limits:** deckcraft's `Package::open` allows 2 GB of decompressed data, so we enforce our
  own limits first:
  - file size 200 MB or less;
  - 10,000 zip entries or fewer;
  - a pre-pass with our zip 4 that inflates each entry into `io::sink` through `take()`,
    capped at 256 MB per entry and 1 GB in total.
- Reject encrypted files (CFB magic `D0CF11E0`) and legacy `.ppt` with clear errors.
- Run in `spawn_blocking` (pattern at `embeddings.rs:195`). Emit
  `pptx-import://progress {importId, stage, done, total}` and check the cancel flag between
  slides.
- **Output:**
  `{ deckName, aspect, warnings[], slides: [{ index, hidden, title?, paragraphs: [{ align, level, bullet, runs: [{ text, b, i, u, color?, font? }] }], box?, background, notes?, imagePath?, warnings[] }] }`.

### UI

- Add an `importPptx` entry to `appWideActions` and quick actions (`src/types/index.ts`
  ~905), so the CommandBar can find it.
- `useQuickActionHandlers.ts` opens a new `src/components/media/PptxImportModal.tsx` with the
  mode choice, progress, warnings and per-slide preview.
- Add an `appendActiveSlides` batch action to the store.

### Testing

- **Test decks** in `src-tauri/tests/fixtures/pptx/` (only files we may redistribute; keep
  larger ones private):
  - PowerPoint 365 lyric decks: placeholders only, and one with a master background image;
  - announcement decks with photos, a table, SmartArt and video;
  - Keynote and Google Slides exports;
  - 4:3 and 16:9, `.ppsx`, grouped and rotated shapes;
  - Twi/Ga text (Ɛ, Ɔ).
- **Rust:** compare the intermediate output to checked-in JSON golden files. Hostile cases:
  zip bomb, truncated file, 10,000 slides, encrypted file, following deckcraft
  `tests/malformed.rs`.
- **Vitest:** HTML generation (escaping, bullets, colours, alignment, padding), plus the modal
  with `invoke` mocked.

### Phases

| Phase | Scope | Effort | Main risk |
|---|---|---|---|
| 0 | Spike: add the dependency, measure binary size and build time on all 3 OSes (estimate: under 1.5 MB / ~30 s for import, 4–8 MB / 1–2 min for render) | 1–2 d | Cost on Windows CI |
| 1 | MVP: editable text, background colour/image, notes, limits, modal | 6–8 d | Reading order on Keynote and Google exports; deckcraft untested on real-world files |
| 2 | Images mode (`render_slide` at 1920 px into media slides) behind `pptx-images` | 4–6 d | Font fidelity; Ubuntu Font Licence notice for the fonts deckcraft embeds |
| 3 | Hybrid mode (render the background without text, overlay editable text), lyric decks to a library Song, save as template, web fallback with JSZip | 5–8 d | Scope creep |

**Zero-cost alternative to Phase 2, which already works:** export PNGs from PowerPoint and
multi-select them in Add Media (`createMultipleMediaSlides`).

**Open question:** which plan tier gets this. Add Media is Pro; editable import could be free.

---

## Track 3: Motion

No Convex schema changes: `slideStyle` is `v.any()` (`schema.ts:278,341`), and templates
spread it onto slides (`useSlideCreation.ts` ~66, `templateStyle.ts:50`).

### 3.A Word-by-word lyric morph (4–5 days)

Source: deckcraft `crates/render/src/morph_text.rs` and `crates/anim/src/morph.rs`.

**Upstream algorithm**

- **Tokens:** a token is a run of non-whitespace characters within one paragraph, merged
  across style runs. `<b>Ho</b>ly` is one token, and punctuation stays attached.
- **Pairing:** greedy, in reading order. Each new token takes the first unused old token with
  an equal key (case-sensitive), so duplicates pair in order.
- **Paired tokens** lerp their position and scale by the font-size ratio. If their look
  differs, the old copy fades out while the new one fades in along the same path.
- **Unpaired tokens** fade while following an average affine map `F(p) = s·p + c` fitted to
  the pairs. With no pairs at all, this amounts to a crossfade.
- **Easing:** smoothstep `p²(3−2p)`.

**New files**

- `src/lib/animation/wordMorph.ts` (pure functions):
  - `wrapWords(html)`: DOMParser wraps each text-node piece of a word in a plain inline
    `<span data-mw="i">`. A word split across tags gets several spans with one index, and
    `<br>` and block boundaries end a word. Plain inline spans don't change layout, so AutoFit
    measures the same thing.
  - `tokenKeys`, `matchTokens(a, b, { normalize })` and `fitAffine(pairs)`.
  - `normalize` is a Selah option, off by default. It lowercases and trims edge punctuation, so
    "Grace," pairs with "grace", then crossfades the glyphs along the shared path.
- `src/components/live/MorphTextLayer.tsx`: an overlay of absolutely positioned clones. Real
  inline spans can't be transformed, and switching them to inline-block would break AutoFit
  and underline inheritance.
  1. After AutoFit's layout effect, measure word rects in both layers, relative to the
     SlideView root. Divide out KineticText's scale, or skip morph while it's active.
  2. Hide both layers' text with `visibility:hidden`, which keeps their layout.
  3. Render clones that copy computed font, colour, decoration, shadow and stroke, with
     `white-space:pre` and `transform-origin:0 0`.
  4. Drive one framer-motion `animate(0, 1, { onUpdate })` that writes transforms and opacity
     directly to the DOM.
  5. On completion, remove the overlay and reveal the new layer.

**Changes**

- `SlideView.tsx`:
  - Keep `prevSlideRef`. For `morph`, render the outgoing layer alongside the incoming one.
    Morph only text-to-text slides with the same layout; anything else crossfades.
  - Memoised `wrapWords(slideBodyHtml(...))` at lines 230 and 314.
  - Captions and verse references crossfade.
- `useSlideTransition.ts`: add `'morph'` to `SlideTransitionType` (reuse the type, delete the
  dead hook body).
- Settings, in `types/index.ts`:
  - `AppSettings.slideTransition?: 'fade' | 'morph' | 'none'`;
  - `SlideStyle.transition?` as a per-template or per-song override;
  - `SlideViewSettings.slideTransition`.
- Plumbing:
  - `useLiveSync.ts:32` sends it to the projector;
  - defaults in `LiveView.tsx:272` and `appStore.ts:203`;
  - pickers in `SettingsModal.tsx` (~800) and `CreateTemplateModal.tsx:433`.

**Edge cases**

- **Different font sizes:** the scale is the ratio of AutoFit's fitted px values.
- **Rewrapping:** positions are measured after layout, so it is handled naturally.
- **Rapid advancing:** snap the running morph to its end state, then start the new one.
- **Reduced motion, or `animations === false`:** no transition.
- **Late font loads:** measure after `document.fonts.ready`.
- **Blanked output:** no morph.
- **Canvas/NDI:** a cut. Note this in `renderSlide.ts`; Track 4.2 can add a crossfade.

**Tests** (`src/lib/animation/__tests__/wordMorph.test.ts`)

- Tokenising "Hello big  world\nHello" gives `["Hello","big","world","Hello"]`.
- "Hello wide world" to "world says Hello" pairs as `[2, null, 0]`.
- Duplicates pair in order, and pairing is case-sensitive unless `normalize` is on.
- `wrapWords` preserves `<b>`/`<u>`/`<sup>` and the visible text.
- `fitAffine` round-trips.
- A happy-dom smoke test that the overlay mounts and unmounts.

**Risks:** clone styling drifting from the real text (outline, `textTransform`, highlight),
measurement cost on long scripture slides, and interaction with KineticText.

### 3.B Animated lower thirds and text build-ins (~3.5 days DOM + 2 days canvas)

Sources: effectcraft `crates/keyframe/src/lib.rs` and `crates/text/src/selectors.rs`.

**Port**

- `src/lib/animation/keyframe.ts`:
  - Port `Interp`, `Ease`, `EASY`, `Keyframe`, `hold()`, `eased()`, `bez`, `bezD`, `solveU`
    (including the exact cbrt branch), `easeProgress`, `evaluate`, the non-spatial
    `segmentValue`, `velocity` and `setKey`.
  - Skip spatial/arc-length, roving and time-reverse.
- `src/lib/animation/textSelectors.ts`:
  - Port `Shape`, `Mode`, `BasedOn`, `Range`, `shapeValue`, `ease`, `rangeValue` and
    `wigglyValue`.
  - `splitmix`, `randomOrder` and `noise1` use **BigInt with `BigInt.asUintN(64, …)`** to
    reproduce u64 wrapping exactly.
- `src/lib/animation/textPresets.ts`. Presets are data; s=1 means fully hidden or offset:

  | Preset | Unit | Shape | Animated range | Properties |
  |---|---|---|---|---|
  | typewriter | characters | Square, smoothness 0 | start 0→1, linear | opacity −1 |
  | word-rise | words | RampUp | offset −1→1, eased | y +0.6em, opacity −1 |
  | letter-fade | characters excl. spaces | RampUp | offset −1→1, linear | opacity −1 |
  | slide-in | lines | Square, smoothness 1 | start 0→1, eased | x −40u, opacity −1 |

- `src/components/live/AnimatedText.tsx`:
  - Splits text into one span per unit; inline-block only for presets that move text.
  - A rAF loop like KineticText's evaluates keyframes → `rangeValue` → styles.
  - It plays on mount, which is already keyed by slide id. Reduced motion shows the final
    frame.

**Where it's used:** the lower-third body and caption (`SlideView.tsx:194-240`; the
LowerThirdEditor title is plain text) and scripture reference captions (`captionNode`).
`SlideStyle.textAnimation?: { preset, duration?, delay? }`, with pickers in
`LowerThirdEditor.tsx` and `CreateTemplateModal.tsx:433`.

**Not covered:** alerts. `activeAlert` is synced (`useLiveSync.ts:70`), but nothing renders it
on the output. That is a separate gap worth its own ticket.

**Canvas parity (phase 2):**

- `renderLowerThird.ts` gets a `timeSeconds` option and draws per unit with `globalAlpha` and
  offsets (add `globalAlpha` to `Canvas2DLike` in `renderRuns.ts`).
- The alternate feed pushes on a short rAF loop for the length of the build-in.
- Best done after Track 4.2's mailbox, so that frames are paced instead of stalling the main
  thread.

**Tests:** port the upstream expected values exactly:

- `temporal_ease_matches_live_ae_with_overlapping_influences`: all three After Effects sample
  sets to 1e-7.
- Maximum-influence flat midpoint, `linear_and_hold`, and the scalar half of the hold-key test
  (expects 25).
- Easy-ease symmetry, bezier with linear speed equals linear, and `set_key` replacing the same
  time.
- A seeded loop in place of proptest.
- All six selector tests (square smoothness, shape profiles, ease high/low, modes, seeded
  permutation, wiggly bounds and determinism).
- Preset snapshots at t = 0, mid and end.

**Risks:** getting BigInt noise exactly right, per-character inline-block losing kerning and
ligatures, and AutoFit needing to measure the static layout first.

---

## Track 4: Testing and NDI

### 4.1 Golden-image tests (2–3 days)

Source (idea): filmcraft `crates/golden` and `crates/testkit/src/golden.rs`.

Today `renderSlide.test.ts` and `motionBackgrounds.test.tsx` assert draw calls against fake
contexts. Neither produces pixels.

**Runner:** Vitest 3 browser mode (`@vitest/browser` + `playwright`, Chromium). It reuses the
Vite aliases, draws canvas the way WebView2 does, and can screenshot DOM `SlideView`.
node-canvas and `@napi-rs/canvas` are rejected: Skia/Cairo draws text differently, they can't
render DOM, and they're native dependencies.

1. Add dev dependencies: `@vitest/browser`, `playwright`, `pixelmatch`, `pngjs`. Fonts come
   from Track 1.1.
2. `vitest.golden.config.ts`:
   - includes `src/**/*.golden.test.{ts,tsx}`;
   - headless Chromium with `--disable-gpu --force-color-profile=srgb --font-render-hinting=none`;
   - a `test:golden` script, kept out of `npm test`.
3. `src/test/golden/commands.ts` (Node-side `browser.commands`):
   - `compareGolden(name, pngDataUrl, tol)` compares with pixelmatch (`threshold 0.1`,
     `includeAA: false`).
   - Tolerance tiers: `EXACT` (0 differing pixels) and `RENDER` (≤0.1% of pixels differ).
   - `SELAH_BLESS=1` writes the golden instead of comparing. A missing golden fails with a hint
     to run it.
   - On failure, write `test-results/golden/<name>.{actual,expected,diff}.png`.
   - Refuse goldens over 50 KB.
4. Fonts: the setup file imports the fontsource CSS. Each test awaits `document.fonts.load(...)`
   and asserts `document.fonts.check(...)`, so a silent fallback font fails the test.
5. Move `hash()` from `MotionCanvas.tsx` into `motionBackgrounds.ts` as an exported
   `motionSeed(id)`.
6. First cases, about 16 goldens at 640×360, stored in `__goldens__/` next to the tests:
   - All 7 `MOTION_BACKGROUNDS` at t=12 (`EXACT`).
   - Canvas renderer: text slide, captioned scripture, lower third, opaque vs transparent
     (`RENDER`).
   - Two built-in templates through both `withTemplateStyle` and the canvas, and a mounted
     `SlideView` screenshot (`RENDER`). Freeze CSS animations and stub Convex/Zustand.
   - Report-only: canvas vs `SlideView` PSNR.
7. `.github/workflows/test.yml` on PRs and pushes to `main`:
   - `unit`: `bun install && bun run test`.
   - `golden`: runs in `mcr.microsoft.com/playwright:v<pinned>-noble` and uploads the diffs on
     failure.
   - **Bless only inside that image.** Document how in `docs/TESTING.md`.

**Verify:** bless, then re-run (passes). Change one `galaxy` colour stop: the test fails and
writes a diff. Delete a golden: the error mentions `SELAH_BLESS`.

### 4.2 Frame-paced standalone NDI output (~3 weeks)

Source (idea): filmcraft `crates/ui-egui/src/frames.rs` (`playback_plan`, `PREROLL_FRAMES`,
`PlaybackMeter`) and `docs/architecture.md` §5.

**What exists:** the alternate feed (`ALTERNATE_CHANNEL`, `useAlternateOutput.ts`). It draws
`renderSlideToCanvas` onto a detached canvas, then `getImageData`, then binary IPC to
`PushChannels::send_frame` (`push.rs`). It pushes on change plus a 500 ms heartbeat.

**What it lacks** compared with the live window: image, video and motion backgrounds,
transitions, alerts, ticking countdowns, kinetic text and the visualizer. Nothing animates.

**Steps**

1. **Rust: a mailbox plus a pacing thread per channel** (`push.rs`, `sender.rs`). Fixes bug 7.
   - `ndi_push_frame` copies the frame into a single-slot mailbox and returns immediately.
   - A per-channel thread ticks at the configured fps. Each tick it sends the newest frame or
     repeats the last one, with `clock_video` pacing it.
   - Counters: `submitted`, `replaced_unsent` (dropped), `repeated`, `late_ticks`.
   - Derive `frame_rate_n/d` from the fps, replacing the hard-coded `30/1` at `sender.rs:175`.
   - `ndi_push_stats` replaces `ndi_push_frames_sent`.
2. **Render in a Worker:** `src/services/ndi-output/programRenderer.worker.ts` with
   `OffscreenCanvas`.
   - **Why a Worker:** `MotionCanvas` uses rAF, which stops when the main window is hidden.
     Hidden-page timers are throttled to about 1 Hz on WebView2 and WebKitGTK. Tauri's
     `backgroundThrottling` only helps on macOS 14+.
   - Clock: a `1000/fps` timer, with the frame index taken from `performance.now()`.
   - Static content: render on change only, and let Rust repeat the frame.
   - Animating content: render every tick and skip frames that are already late (the spirit
     of `playback_plan`'s lead/stride).
   - Port `PlaybackMeter`: shown and dropped counts, with `resync` after a pause.
   - Preroll: on a slide change, wait for backgrounds to decode, up to 0.5 s.
3. **Build the render model on the main thread** (`src/lib/graphics/renderModel.ts`).
   `parseTextRuns` needs `DOMParser`, which Workers don't have, and the fallback at
   `textRuns.ts:73` strips styling. Post plain objects only when they change: runs, style,
   background descriptor, countdown `endsAt`, the alert, and the transition kind.
4. **Extend `renderSlide.ts`** so it is worker-safe through `Canvas2DLike`:
   - image backgrounds (`fetch` → `createImageBitmap`);
   - motion backgrounds (call `scene.draw`; Galaxy's `document.createElement` needs an
     `OffscreenCanvas` fallback);
   - countdowns from `endsAt`;
   - an alert bar;
   - a `globalAlpha` crossfade between slides.
   - Video comes last: a hidden main-thread `<video>`, with `VideoFrame`/`createImageBitmap`
     posted to the worker.
5. **Transfer budget:** a 1080p RGBA frame is 8.3 MB, about 250 MB/s at 30 fps.
   - The worker transfers the `ArrayBuffer`, and the main thread invokes `ndi_push_frame`.
   - Measure it. If IPC is the bottleneck, have the worker `fetch` the `ipc.localhost` endpoint
     directly, then consider BGRA/UYVY or half resolution.
6. **One push service** (`src/services/ndi-output/standaloneOutput.ts`). `useAlternateOutput`
   becomes a thin subscriber, which fixes bug 6. Add a `program` channel so NDI can be the only
   output, with no live window.
7. **UI:** fps, dropped/late and repeated counters next to the NDI badge in `LiveOutput.tsx`.
8. **Docs** (`docs/NDI_OUTPUT.md`):
   - Option 2 is the chosen route; fix the stale statements (bug 9).
   - Document the clock, mailbox, counters, Worker rationale and transfer budget.
   - Delete the dead `ndi_send_video_frame` and `sendVideoFrame`.

**Effort:**
- mailbox, Worker, single service and UI: about 1 week;
- backgrounds, motion and countdowns: about 1 week;
- video, transitions and alerts: about 1 week.

**Verify:**
- Rust tests: an overwritten frame counts as dropped, and an empty tick repeats.
- Clock tests with a fake `performance.now`.
- Goldens (4.1) for the new drawing.
- Manual: OBS on `Selah Alternate` with the main window minimised for 5 minutes. Check the
  counters and the motion smoothness.

**Risks:**
- 2D `OffscreenCanvas` in Workers may be missing on WebKitGTK and older WKWebView.
  Feature-detect, and fall back to main-thread rendering with a "keep the window visible"
  warning.
- OS power saving can throttle Workers too.
- `asset://` fetch from a Worker is unverified.
- 1080p60 over IPC may not keep up.
- Video decoding stays on the main thread.

---

## Considered and rejected

- **Pure-Rust video decoders** (deckcraft, filmcraft, soundcraft): the webview already
  hardware-decodes video.
- **deckcraft's vello renderer and filmcraft's wgpu compositor as the NDI source:** they draw
  their own models, not our TipTap HTML and canvas backgrounds, so we'd be maintaining a
  second renderer. We grow `renderSlide.ts` instead.
- **effectcraft's WGSL shaders:** they're compute shaders with storage buffers. Selah has no
  WebGL; `motionBackgrounds.ts` is Canvas 2D. Revisit only if we build a WebGL background host.
  The maths in `effects/src/transition.rs`, `noise3.rs` and `fx_light.wgsl` would then
  transcribe to GLSL at about half a day to a day each.
- **egui UI, plugin hosting, the mixer, the 300+ effect catalogue, charts/SmartArt, and PPTX
  export.**
- **soundcraft's audio engine:** Selah's capture is already better (wait-free ring, rubato
  instead of linear resampling, device rebuild, lag bounds). Possibly later:
  - `dsp/src/meter.rs` (BS.1770 loudness) for adaptive input gain, replacing the fixed +3 dB in
    `audio_capture/types.rs`;
  - `audio-io/src/flac.rs` for exporting sermon recordings.
- **The command registry + MCP control channel:** a good idea for Stream Deck/Companion
  control and agent-driven UI checks, but a re-architecture. Worth its own plan if remote
  control becomes a priority.
- **craft-libs:** the repo is empty.
- **Their CI practice:** they run no tests on PRs. Track 1.3 and 4.1 do the opposite.
