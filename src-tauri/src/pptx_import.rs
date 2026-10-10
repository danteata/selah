//! PowerPoint import (`.pptx`, `.ppsx`, `.potx`).
//!
//! deckcraft (storytold/deckcraft, MIT OR Apache-2.0; see THIRD_PARTY_NOTICES.md)
//! reads the package into its document model and works out each text box's
//! effective formatting through slide → layout → master → theme. This module
//! turns that model into a neutral, JSON-friendly description of each slide:
//! paragraphs of styled runs, the box the text sat in, the background and the
//! speaker notes. The frontend (`src/lib/import/pptxToSlides.ts`) builds slide
//! HTML from it, so the mapping onto Selah's single auto-fitted text block is
//! testable without a desktop build, and no HTML is made here.
//!
//! A deck is an untrusted zip. deckcraft's own ceilings are generous (2 GB of
//! decompressed data), so the container is checked against tighter limits
//! first, by inflating every entry into a sink before deckcraft sees it. CFB
//! files (password-protected decks and legacy binary `.ppt`) are turned away
//! with an error that says which one it was.
//!
//! The work runs on a blocking thread, reports progress as
//! `pptx-import://progress` events and checks a cancel flag between zip
//! entries and between slides.

// Without `pptx-import` only the commands' "not in this build" answers remain.
#![cfg_attr(not(feature = "pptx-import"), allow(dead_code))]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Largest deck accepted, on disk.
pub const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Most zip entries accepted. A real deck has a few hundred; 10,000 slides
/// would need well over this.
pub const MAX_ENTRIES: usize = 10_000;
/// Largest single entry once inflated.
pub const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
/// Largest total once every entry is inflated.
pub const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

/// Event the frontend listens on for progress.
pub const PROGRESS_EVENT: &str = "pptx-import://progress";

/// Compound File Binary magic: legacy `.ppt` and password-protected OOXML.
const CFB_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// A picture covering at least this share of the slide becomes the background.
const BACKGROUND_COVERAGE: f64 = 0.8;

/// The container limits, as a value so tests can shrink them.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_file: u64,
    pub max_entries: usize,
    pub max_entry: u64,
    pub max_total: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_file: MAX_FILE_BYTES,
            max_entries: MAX_ENTRIES,
            max_entry: MAX_ENTRY_BYTES,
            max_total: MAX_TOTAL_BYTES,
        }
    }
}

// --- wire types -------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    /// Text, background and notes, editable in Selah.
    Editable,
    /// Each slide rendered to a picture (the `pptx-images` feature).
    Images,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// This build has no PowerPoint import, or not the mode asked for.
    #[cfg_attr(feature = "pptx-images", allow(dead_code))]
    NotSupported,
    TooLarge,
    TooManyEntries,
    /// An entry, or the whole package, inflates past the limits.
    ZipBomb,
    Encrypted,
    LegacyPpt,
    /// Not a presentation, or damaged beyond reading.
    NotPptx,
    Cancelled,
    Io,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PptxImportError {
    pub kind: ErrorKind,
    /// A sentence the operator can act on.
    pub message: String,
}

impl PptxImportError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        PptxImportError { kind, message: message.into() }
    }
    fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "The import was cancelled.")
    }
    fn not_pptx() -> Self {
        Self::new(
            ErrorKind::NotPptx,
            "This file isn't a PowerPoint presentation, or it is damaged.",
        )
    }
}

impl std::fmt::Display for PptxImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PptxImportResult {
    pub deck_name: String,
    /// Slide width over height (16:9 ≈ 1.778, 4:3 ≈ 1.333).
    pub aspect: f64,
    pub warnings: Vec<String>,
    pub slides: Vec<ImportedSlide>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSlide {
    /// 0-based position in the deck.
    pub index: usize,
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Title first, then body placeholders, then other text by position.
    pub paragraphs: Vec<ImportedParagraph>,
    /// The union of the text boxes, as fractions of the slide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#box: Option<TextBox>,
    pub background: ImportedBackground,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Images mode: the rendered slide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedParagraph {
    pub align: Align,
    /// Outline level, 0–8.
    pub level: u8,
    pub bullet: BulletKind,
    pub runs: Vec<ImportedRun>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRun {
    /// `\n` is a line break inside the paragraph.
    pub text: String,
    pub b: bool,
    pub i: bool,
    pub u: bool,
    /// `#rrggbb`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The family the deck asked for, theme references resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BulletKind {
    None,
    Bullet,
    Number,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct TextBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    /// 0–1.
    pub pos: f64,
    pub color: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ImportedBackground {
    None,
    Color {
        color: String,
    },
    Gradient {
        /// DrawingML degrees: clockwise, 0 = left to right.
        angle: f64,
        radial: bool,
        stops: Vec<GradientStop>,
    },
    Image {
        path: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Checking,
    Reading,
    Converting,
    #[cfg_attr(not(feature = "pptx-images"), allow(dead_code))]
    Rendering,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    import_id: &'a str,
    stage: Stage,
    done: usize,
    total: usize,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct PptxImportCapabilities {
    pub editable: bool,
    pub images: bool,
}

// --- commands ---------------------------------------------------------------

/// Cancel flags of the imports in flight, by import id.
static CANCELS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Holds an import's cancel flag and forgets it when the import ends.
struct CancelRegistration {
    id: String,
    flag: Arc<AtomicBool>,
}

impl CancelRegistration {
    fn new(id: &str) -> Self {
        let flag = Arc::new(AtomicBool::new(false));
        CANCELS.lock().insert(id.to_string(), flag.clone());
        CancelRegistration { id: id.to_string(), flag }
    }
}

impl Drop for CancelRegistration {
    fn drop(&mut self) {
        CANCELS.lock().remove(&self.id);
    }
}

/// What this build can import, so the dialog only offers what will work.
#[tauri::command]
pub fn pptx_import_capabilities() -> PptxImportCapabilities {
    PptxImportCapabilities {
        editable: cfg!(feature = "pptx-import"),
        images: cfg!(feature = "pptx-images"),
    }
}

/// Import the deck at `path`. Pictures it needs (backgrounds, or the rendered
/// slides in images mode) are written under `media-library/pptx-<import_id>/`
/// in the app data directory, and the result points at them.
#[tauri::command]
pub async fn pptx_import(
    app: AppHandle,
    path: String,
    mode: ImportMode,
    import_id: String,
) -> Result<PptxImportResult, PptxImportError> {
    let id = checked_import_id(&import_id)?;
    let registration = CancelRegistration::new(&id);
    let cancel = registration.flag.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_import(&app, &path, mode, &id, &cancel)
    })
    .await
    .map_err(|e| PptxImportError::new(ErrorKind::Io, format!("The import stopped unexpectedly: {e}")))?;
    drop(registration);
    result
}

/// Ask a running import to stop. It stops at the next zip entry or slide.
#[tauri::command]
pub fn pptx_import_cancel(import_id: String) {
    if let Some(flag) = CANCELS.lock().get(&import_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// The id names a directory, so only plain characters get through.
fn checked_import_id(id: &str) -> Result<String, PptxImportError> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id.to_string())
    } else {
        Err(PptxImportError::new(ErrorKind::Io, "Invalid import id."))
    }
}

#[cfg(not(feature = "pptx-import"))]
fn run_import(
    _app: &AppHandle,
    _path: &str,
    _mode: ImportMode,
    _id: &str,
    _cancel: &AtomicBool,
) -> Result<PptxImportResult, PptxImportError> {
    Err(PptxImportError::new(
        ErrorKind::NotSupported,
        "This build of Selah was made without PowerPoint import.",
    ))
}

#[cfg(feature = "pptx-import")]
fn run_import(
    app: &AppHandle,
    path: &str,
    mode: ImportMode,
    id: &str,
    cancel: &AtomicBool,
) -> Result<PptxImportResult, PptxImportError> {
    use tauri::{Emitter, Manager};

    let mut progress = |stage: Stage, done: usize, total: usize| {
        let _ = app.emit(PROGRESS_EVENT, ProgressEvent { import_id: id, stage, done, total });
    };
    let bytes = read_deck(std::path::Path::new(path), &Limits::default())?;
    let deck_name = std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Presentation".to_string());
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PptxImportError::new(ErrorKind::Io, format!("No app data directory: {e}")))?
        .join("media-library")
        .join(format!("pptx-{id}"));
    let mut sink = DirSink { dir, created: false };
    let result = import_bytes(&bytes, &deck_name, mode, &Limits::default(), &mut sink, cancel, &mut progress);
    if result.is_err() && sink.created {
        // Nothing points at what was written; don't leave it behind.
        let _ = std::fs::remove_dir_all(&sink.dir);
    }
    if let Ok(r) = &result {
        tracing::info!(
            "[pptx] imported {} slides from {} ({:?})",
            r.slides.len(),
            deck_name,
            mode
        );
    }
    result
}

/// Read the file, refusing one over the size limit before reading it.
#[cfg(feature = "pptx-import")]
fn read_deck(path: &std::path::Path, limits: &Limits) -> Result<Vec<u8>, PptxImportError> {
    let io = |e: std::io::Error| PptxImportError::new(ErrorKind::Io, format!("Couldn't read the file: {e}"));
    let len = std::fs::metadata(path).map_err(io)?.len();
    if len > limits.max_file {
        return Err(too_large(limits));
    }
    std::fs::read(path).map_err(io)
}

#[cfg(feature = "pptx-import")]
fn too_large(limits: &Limits) -> PptxImportError {
    PptxImportError::new(
        ErrorKind::TooLarge,
        format!(
            "The file is larger than {} MB, the most Selah imports.",
            limits.max_file / (1024 * 1024)
        ),
    )
}

// --- the import -------------------------------------------------------------

/// Where pictures the slides need are stored.
#[cfg(feature = "pptx-import")]
pub(crate) trait ImageSink {
    /// Store `bytes` as `<name>.<ext>` and return the path slides reference.
    fn store(&mut self, name: &str, ext: &str, bytes: &[u8]) -> Result<String, String>;
}

#[cfg(feature = "pptx-import")]
struct DirSink {
    dir: std::path::PathBuf,
    created: bool,
}

#[cfg(feature = "pptx-import")]
impl ImageSink for DirSink {
    fn store(&mut self, name: &str, ext: &str, bytes: &[u8]) -> Result<String, String> {
        if !self.created {
            std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
            self.created = true;
        }
        let path = self.dir.join(format!("{name}.{ext}"));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
}

/// Check, read and convert a deck already in memory.
#[cfg(feature = "pptx-import")]
pub(crate) fn import_bytes(
    bytes: &[u8],
    deck_name: &str,
    mode: ImportMode,
    limits: &Limits,
    sink: &mut dyn ImageSink,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(Stage, usize, usize),
) -> Result<PptxImportResult, PptxImportError> {
    check_package(bytes, limits, cancel, progress)?;
    progress(Stage::Reading, 0, 1);
    let pres = deckcraft_pptx::import(bytes).map_err(|e| {
        tracing::warn!("[pptx] deckcraft could not read the deck: {e}");
        PptxImportError::not_pptx()
    })?;
    progress(Stage::Reading, 1, 1);
    let mut result = convert::convert(&pres, deck_name, sink, cancel, progress)?;
    if mode == ImportMode::Images {
        render_images(&pres, &mut result, sink, cancel, progress)?;
    }
    Ok(result)
}

#[cfg(all(feature = "pptx-import", not(feature = "pptx-images")))]
fn render_images(
    _pres: &deckcraft_model::Presentation,
    _result: &mut PptxImportResult,
    _sink: &mut dyn ImageSink,
    _cancel: &AtomicBool,
    _progress: &mut dyn FnMut(Stage, usize, usize),
) -> Result<(), PptxImportError> {
    Err(PptxImportError::new(
        ErrorKind::NotSupported,
        "This build of Selah can't import slides as pictures.",
    ))
}

#[cfg(feature = "pptx-images")]
fn render_images(
    pres: &deckcraft_model::Presentation,
    result: &mut PptxImportResult,
    sink: &mut dyn ImageSink,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(Stage, usize, usize),
) -> Result<(), PptxImportError> {
    images::render(pres, result, sink, cancel, progress)
}

/// Check the container against [`Limits`] before deckcraft reads it.
#[cfg(feature = "pptx-import")]
pub(crate) fn check_package(
    bytes: &[u8],
    limits: &Limits,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(Stage, usize, usize),
) -> Result<(), PptxImportError> {
    use std::io::Read;

    if bytes.len() as u64 > limits.max_file {
        return Err(too_large(limits));
    }
    if bytes.starts_with(&CFB_MAGIC) {
        return Err(cfb_error(bytes));
    }
    if !bytes.starts_with(b"PK") {
        return Err(PptxImportError::not_pptx());
    }
    let too_many = || {
        PptxImportError::new(
            ErrorKind::TooManyEntries,
            format!(
                "The file holds more than {} parts, which no real presentation needs.",
                limits.max_entries
            ),
        )
    };
    // The end record's count, before the zip crate allocates per entry.
    if eocd_entry_count(bytes).is_some_and(|n| n > limits.max_entries) {
        return Err(too_many());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| PptxImportError::not_pptx())?;
    let entries = zip.len();
    if entries > limits.max_entries {
        return Err(too_many());
    }
    if zip.index_for_name("[Content_Types].xml").is_none() {
        return Err(PptxImportError::not_pptx());
    }
    let bomb = || {
        PptxImportError::new(
            ErrorKind::ZipBomb,
            "The file expands to far more data than a presentation holds, so it wasn't opened.",
        )
    };
    let mut total: u64 = 0;
    // Throttled to whole percents: 10,000 events would swamp the webview.
    let mut last_pct = usize::MAX;
    for i in 0..entries {
        if cancel.load(Ordering::Relaxed) {
            return Err(PptxImportError::cancelled());
        }
        let pct = i * 100 / entries.max(1);
        if pct != last_pct {
            last_pct = pct;
            progress(Stage::Checking, i, entries);
        }
        // An entry the zip crate can't open is one deckcraft skips too.
        let Ok(mut file) = zip.by_index(i) else { continue };
        if file.is_dir() {
            continue;
        }
        let mut counter = CountingSink(0);
        // Bytes inflated before a read error still count.
        let _ = std::io::copy(&mut (&mut file).take(limits.max_entry.saturating_add(1)), &mut counter);
        if counter.0 > limits.max_entry {
            return Err(bomb());
        }
        total = total.saturating_add(counter.0);
        if total > limits.max_total {
            return Err(bomb());
        }
    }
    progress(Stage::Checking, entries, entries);
    Ok(())
}

/// Counts what is written to it and keeps none of it.
#[cfg(feature = "pptx-import")]
struct CountingSink(u64);

#[cfg(feature = "pptx-import")]
impl std::io::Write for CountingSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(buf.len() as u64);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Entry count from the end-of-central-directory record, when there is one.
/// `None` for a damaged file or Zip64 (the zip crate's own count applies).
#[cfg(feature = "pptx-import")]
fn eocd_entry_count(bytes: &[u8]) -> Option<usize> {
    const SIG: [u8; 4] = [0x50, 0x4B, 0x05, 0x06];
    // The record is 22 bytes plus a comment of up to 65,535.
    let start = bytes.len().saturating_sub(22 + 65_535);
    let tail = bytes.get(start..)?;
    let at = tail.windows(4).rposition(|w| w == SIG)?;
    let count = tail.get(at + 10..at + 12)?;
    let n = u16::from_le_bytes([count[0], count[1]]);
    (n != u16::MAX).then_some(n as usize)
}

/// Both a password-protected deck and a legacy `.ppt` are CFB files. An
/// encrypted OOXML package keeps its contents in an `EncryptedPackage`
/// stream, whose name (UTF-16) is in the directory.
#[cfg(feature = "pptx-import")]
fn cfb_error(bytes: &[u8]) -> PptxImportError {
    let name: Vec<u8> = "EncryptedPackage".encode_utf16().flat_map(u16::to_le_bytes).collect();
    if bytes.windows(name.len()).any(|w| w == name.as_slice()) {
        PptxImportError::new(
            ErrorKind::Encrypted,
            "This presentation is password-protected. Remove the password in PowerPoint (File ▸ Info ▸ Protect Presentation) and import it again.",
        )
    } else {
        PptxImportError::new(
            ErrorKind::LegacyPpt,
            "This is an older PowerPoint 97–2003 (.ppt) file. Open it in PowerPoint or Keynote, save it as .pptx, and import that.",
        )
    }
}

#[cfg(feature = "pptx-import")]
mod convert {
    //! deckcraft's model → [`PptxImportResult`].

    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};

    use deckcraft_model::resolve::{self, Ctx};
    use deckcraft_model::style::{Fill, GradientShape};
    use deckcraft_model::text::{self, Bullet, Caps, RunKind};
    use deckcraft_model::{MediaId, PhType, Presentation, Rgba, Shape, ShapeKind, Slide, Xfrm};

    use super::{
        Align, BulletKind, GradientStop, ImageSink, ImportedBackground, ImportedParagraph,
        ImportedRun, ImportedSlide, PptxImportError, PptxImportResult, Stage, TextBox,
        BACKGROUND_COVERAGE,
    };

    /// Shape trees deeper than this are not followed (deckcraft's own bound).
    const MAX_DEPTH: usize = 64;

    /// Maps a group's child coordinates onto the slide: `x' = tx + sx·x`.
    #[derive(Clone, Copy)]
    struct Map {
        sx: f64,
        sy: f64,
        tx: f64,
        ty: f64,
    }

    impl Map {
        const IDENTITY: Map = Map { sx: 1.0, sy: 1.0, tx: 0.0, ty: 0.0 };

        fn rect(&self, x: &Xfrm) -> Rect {
            Rect {
                x: self.tx + self.sx * x.x,
                y: self.ty + self.sy * x.y,
                w: self.sx * x.w,
                h: self.sy * x.h,
            }
        }

        /// The map for the children of a group placed at `at` with child
        /// space `child`.
        fn for_group(&self, at: &Xfrm, child: &Xfrm) -> Map {
            let kx = if child.w.abs() > f64::EPSILON { at.w / child.w } else { 1.0 };
            let ky = if child.h.abs() > f64::EPSILON { at.h / child.h } else { 1.0 };
            Map {
                sx: self.sx * kx,
                sy: self.sy * ky,
                tx: self.tx + self.sx * (at.x - child.x * kx),
                ty: self.ty + self.sy * (at.y - child.y * ky),
            }
        }
    }

    #[derive(Clone, Copy, Debug)]
    struct Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    impl Rect {
        /// Share of a `w × h` slide this covers.
        fn coverage(&self, w: f64, h: f64) -> f64 {
            let x0 = self.x.max(0.0);
            let y0 = self.y.max(0.0);
            let x1 = (self.x + self.w).min(w);
            let y1 = (self.y + self.h).min(h);
            if x1 <= x0 || y1 <= y0 || w <= 0.0 || h <= 0.0 {
                return 0.0;
            }
            (x1 - x0) * (y1 - y0) / (w * h)
        }
    }

    struct TextShape<'a> {
        shape: &'a Shape,
        rect: Rect,
        /// 0 title, 1 body placeholder, 2 anything else.
        rank: u8,
    }

    /// What a slide had that editable import leaves out, for its warnings.
    #[derive(Default)]
    struct Dropped {
        pictures: usize,
        charts: usize,
        tables: usize,
        videos: usize,
        audio: usize,
        /// SmartArt without a drawing, OLE objects and the like, by label.
        objects: Vec<String>,
    }

    impl Dropped {
        fn warnings(&self) -> Vec<String> {
            let mut out = vec![];
            let mut add = |n: usize, one: &str, many: &str| match n {
                0 => {}
                1 => out.push(format!("Left out {one}")),
                n => out.push(format!("Left out {n} {many}")),
            };
            add(self.pictures, "a picture", "pictures");
            add(self.charts, "a chart", "charts");
            add(self.tables, "a table", "tables");
            add(self.videos, "a video", "videos");
            add(self.audio, "an audio clip", "audio clips");
            let mut labels = self.objects.clone();
            labels.sort();
            labels.dedup();
            for label in labels {
                out.push(format!("Left out {label}"));
            }
            out
        }
    }

    /// A picture that may become the background, topmost last.
    struct Picture {
        media: MediaId,
        coverage: f64,
    }

    /// Images already written, by media id (`None`: not a format Selah shows).
    type Written = HashMap<MediaId, Option<String>>;

    pub(super) fn convert(
        pres: &Presentation,
        deck_name: &str,
        sink: &mut dyn ImageSink,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Stage, usize, usize),
    ) -> Result<PptxImportResult, PptxImportError> {
        let size = pres.slide_size;
        let total = pres.slides.len();
        let mut written = Written::new();
        let mut slides = Vec::with_capacity(total);
        for (index, slide) in pres.slides.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err(PptxImportError::cancelled());
            }
            progress(Stage::Converting, index, total);
            slides.push(convert_slide(pres, slide, index, sink, &mut written));
        }
        progress(Stage::Converting, total, total);
        let mut warnings = vec![];
        if slides.is_empty() {
            warnings.push("The presentation has no slides.".to_string());
        }
        let aspect = if size.height > 0.0 { size.width / size.height } else { 16.0 / 9.0 };
        Ok(PptxImportResult {
            deck_name: deck_name.to_string(),
            aspect: (aspect * 1000.0).round() / 1000.0,
            warnings,
            slides,
        })
    }

    fn convert_slide(
        pres: &Presentation,
        slide: &Slide,
        index: usize,
        sink: &mut dyn ImageSink,
        written: &mut Written,
    ) -> ImportedSlide {
        let mut out = ImportedSlide {
            index,
            hidden: slide.hidden,
            title: Some(slide.title().trim().to_string()).filter(|t| !t.is_empty()),
            paragraphs: vec![],
            r#box: None,
            background: ImportedBackground::None,
            notes: Some(slide.notes_text().replace('\u{b}', "\n").trim().to_string())
                .filter(|n| !n.is_empty()),
            image_path: None,
            warnings: vec![],
        };
        let Some(ctx) = Ctx::for_slide(pres, slide) else {
            // No master at all: deckcraft substitutes one, so this is defensive.
            out.warnings.push("Couldn't read this slide's layout".to_string());
            return out;
        };

        let mut texts = vec![];
        let mut pictures = vec![];
        let mut dropped = Dropped::default();
        collect(&ctx, &slide.shapes, Map::IDENTITY, 0, true, &mut texts, &mut pictures, &mut dropped);

        // Reading order: title, body placeholders, then the rest by position.
        texts.sort_by(|a, b| {
            a.rank
                .cmp(&b.rank)
                .then(a.rect.y.total_cmp(&b.rect.y))
                .then(a.rect.x.total_cmp(&b.rect.x))
        });
        let (w, h) = (pres.slide_size.width, pres.slide_size.height);
        let mut union: Option<(f64, f64, f64, f64)> = None;
        for t in &texts {
            out.paragraphs.extend(paragraphs(&ctx, t.shape));
            let r = t.rect;
            union = Some(match union {
                None => (r.x, r.y, r.x + r.w, r.y + r.h),
                Some((x0, y0, x1, y1)) => (x0.min(r.x), y0.min(r.y), x1.max(r.x + r.w), y1.max(r.y + r.h)),
            });
        }
        if let (Some((x0, y0, x1, y1)), true) = (union, w > 0.0 && h > 0.0) {
            let fx = |v: f64| round4((v / w).clamp(0.0, 1.0));
            let fy = |v: f64| round4((v / h).clamp(0.0, 1.0));
            let (bx, by) = (fx(x0), fy(y0));
            out.r#box = Some(TextBox { x: bx, y: by, w: round4(fx(x1) - bx), h: round4(fy(y1) - by) });
        }

        // A picture that (nearly) fills the slide is its background. The
        // topmost one shows: slide pictures sit over the layout's, which sit
        // over the master's, which sit over the background fill. Layout and
        // master pictures that don't fill the slide are decoration, not
        // content, so only the slide's own count as left out.
        dropped.pictures += pictures.iter().filter(|p| p.coverage < BACKGROUND_COVERAGE).count();
        let (show_layout, show_master) = resolve::show_master_shapes(slide, ctx.layout);
        if let (true, Some(layout)) = (show_layout, ctx.layout) {
            let mut layout_pictures = vec![];
            collect(&ctx, &layout.shapes, Map::IDENTITY, 0, false, &mut vec![], &mut layout_pictures, &mut Dropped::default());
            pictures.splice(0..0, layout_pictures);
        }
        if show_master {
            let mut master_pictures = vec![];
            collect(&ctx, &ctx.master.shapes, Map::IDENTITY, 0, false, &mut vec![], &mut master_pictures, &mut Dropped::default());
            pictures.splice(0..0, master_pictures);
        }
        let mut background = None;
        for p in pictures.iter().rev().filter(|p| p.coverage >= BACKGROUND_COVERAGE) {
            if let Some(path) = image_path(pres, p.media, sink, written) {
                background = Some(ImportedBackground::Image { path });
                break;
            }
            out.warnings.push("Left out a picture in a format Selah can't show".to_string());
        }
        out.background = match background {
            Some(b) => b,
            None => fill_background(&ctx, slide, pres, sink, written, &mut out.warnings),
        };
        out.warnings.extend(dropped.warnings());
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn collect<'a>(
        ctx: &Ctx,
        shapes: &'a [Shape],
        map: Map,
        depth: usize,
        is_slide: bool,
        texts: &mut Vec<TextShape<'a>>,
        pictures: &mut Vec<Picture>,
        dropped: &mut Dropped,
    ) {
        if depth > MAX_DEPTH {
            return;
        }
        let size = ctx.pres.slide_size;
        for s in shapes {
            if s.hidden {
                continue;
            }
            match &s.kind {
                ShapeKind::Group { children, child } => {
                    let inner = match s.xfrm {
                        Some(at) => map.for_group(&at, child),
                        None => map,
                    };
                    collect(ctx, children, inner, depth + 1, is_slide, texts, pictures, dropped);
                }
                ShapeKind::Picture { fill } => {
                    // Layout and master placeholders are prompts, not pictures.
                    if !is_slide && s.ph.is_some() {
                        continue;
                    }
                    let rect = map.rect(&resolve::xfrm(ctx, s));
                    pictures.push(Picture { media: fill.media, coverage: rect.coverage(size.width, size.height) });
                }
                ShapeKind::Shape => {
                    // Footer-row placeholders and layout/master prompt text
                    // aren't slide content.
                    if !is_slide {
                        if let (None, Some(Fill::Picture(pf))) = (&s.ph, &s.fill) {
                            let rect = map.rect(&resolve::xfrm(ctx, s));
                            pictures.push(Picture { media: pf.media, coverage: rect.coverage(size.width, size.height) });
                        }
                        continue;
                    }
                    if s.ph_type().is_some_and(|k| k.is_footer_kind() || k == PhType::SlideImage) {
                        continue;
                    }
                    let rect = map.rect(&resolve::xfrm(ctx, s));
                    // A rectangle filled with a photo is a picture too.
                    if let Some(Fill::Picture(pf)) = &s.fill {
                        pictures.push(Picture { media: pf.media, coverage: rect.coverage(size.width, size.height) });
                    }
                    let has_text = s.text.as_ref().is_some_and(|t| !t.is_empty());
                    if has_text {
                        let rank = match s.ph_type() {
                            Some(k) if k.is_title() => 0,
                            Some(_) => 1,
                            None => 2,
                        };
                        texts.push(TextShape { shape: s, rect, rank });
                    }
                }
                ShapeKind::Table(_) if is_slide => dropped.tables += 1,
                ShapeKind::Chart(_) if is_slide => dropped.charts += 1,
                ShapeKind::Media(m) if is_slide => {
                    if m.video {
                        dropped.videos += 1;
                    } else {
                        dropped.audio += 1;
                    }
                }
                ShapeKind::Opaque { label, .. } if is_slide => {
                    let label = match label.as_str() {
                        "SmartArt" => "SmartArt".to_string(),
                        "Chart" => {
                            dropped.charts += 1;
                            continue;
                        }
                        _ => "an embedded object".to_string(),
                    };
                    dropped.objects.push(label);
                }
                // Lines, connectors and ink are decoration.
                _ => {}
            }
        }
    }

    fn paragraphs(ctx: &Ctx, shape: &Shape) -> Vec<ImportedParagraph> {
        let Some(body) = &shape.text else { return vec![] };
        body.paragraphs
            .iter()
            .map(|para| {
                let pp = resolve::para(ctx, shape, para);
                let align = match pp.align {
                    Some(text::Align::Center) => Align::Center,
                    Some(text::Align::Right) => Align::Right,
                    Some(text::Align::Justify | text::Align::JustLow | text::Align::Distributed) => Align::Justify,
                    _ => Align::Left,
                };
                let bullet = match pp.bullet {
                    Some(Bullet::Char { .. } | Bullet::Picture { .. }) => BulletKind::Bullet,
                    Some(Bullet::AutoNum { .. }) => BulletKind::Number,
                    Some(Bullet::None) | None => BulletKind::None,
                };
                let mut runs: Vec<ImportedRun> = vec![];
                for run in &para.runs {
                    let rp = resolve::run(ctx, shape, para, &run.props);
                    let text = match &run.kind {
                        RunKind::Break => "\n".to_string(),
                        _ if rp.caps == Some(Caps::All) => run.text.to_uppercase(),
                        _ => run.text.clone(),
                    };
                    if text.is_empty() {
                        continue;
                    }
                    let color = resolve::text_color(ctx, &rp);
                    let font = resolve::font_family(ctx, &rp);
                    let next = ImportedRun {
                        text,
                        b: rp.bold.unwrap_or(false),
                        i: rp.italic.unwrap_or(false),
                        u: rp.underline.as_deref().is_some_and(|u| u != "none"),
                        color: (color.a > 0).then(|| hex(color)),
                        font: Some(font.trim().to_string()).filter(|f| !f.is_empty()),
                    };
                    // A line break takes the look of the text around it.
                    match runs.last_mut() {
                        Some(last) if next.text == "\n" || same_look(last, &next) => last.text.push_str(&next.text),
                        _ => runs.push(next),
                    }
                }
                ImportedParagraph { align, level: para.level.min(8), bullet, runs }
            })
            .collect()
    }

    fn same_look(a: &ImportedRun, b: &ImportedRun) -> bool {
        a.b == b.b && a.i == b.i && a.u == b.u && a.color == b.color && a.font == b.font
    }

    fn fill_background(
        ctx: &Ctx,
        slide: &Slide,
        pres: &Presentation,
        sink: &mut dyn ImageSink,
        written: &mut Written,
        warnings: &mut Vec<String>,
    ) -> ImportedBackground {
        let (fill, ph) = resolve::background(ctx, Some(slide));
        match fill {
            Fill::Solid { color } => ImportedBackground::Color { color: hex(ctx.color(&color, ph)) },
            Fill::Gradient(g) if !g.stops.is_empty() => {
                let (angle, radial) = match g.shape {
                    GradientShape::Linear { angle, .. } => (angle, false),
                    GradientShape::Path { .. } => (0.0, true),
                };
                let mut stops: Vec<GradientStop> = g
                    .stops
                    .iter()
                    .map(|s| GradientStop { pos: round4(s.pos.clamp(0.0, 1.0)), color: hex(ctx.color(&s.color, ph)) })
                    .collect();
                stops.sort_by(|a, b| a.pos.total_cmp(&b.pos));
                ImportedBackground::Gradient { angle: round4(angle.rem_euclid(360.0)), radial, stops }
            }
            Fill::Picture(pf) => match image_path(pres, pf.media, sink, written) {
                Some(path) => ImportedBackground::Image { path },
                None => {
                    warnings.push("Left out a background picture in a format Selah can't show".to_string());
                    ImportedBackground::None
                }
            },
            Fill::Pattern(p) => ImportedBackground::Color { color: hex(ctx.color(&p.bg, ph)) },
            _ => ImportedBackground::None,
        }
    }

    /// Write a media item once and return its path, or `None` when it isn't a
    /// picture Selah can show (EMF/WMF, TIFF, SVG, missing or linked).
    fn image_path(pres: &Presentation, id: MediaId, sink: &mut dyn ImageSink, written: &mut Written) -> Option<String> {
        if let Some(done) = written.get(&id) {
            return done.clone();
        }
        let path = pres.media(id).and_then(|m| {
            let ext = sniff_image(&m.data)?;
            match sink.store(&format!("image-{}", id.0), ext, &m.data) {
                Ok(path) => Some(path),
                Err(e) => {
                    tracing::warn!("[pptx] couldn't write image {}: {e}", m.name);
                    None
                }
            }
        });
        written.insert(id, path.clone());
        path
    }

    /// The extension for bytes that really are a picture the webview shows,
    /// by content rather than by what the package claims.
    pub(super) fn sniff_image(b: &[u8]) -> Option<&'static str> {
        if b.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some("png")
        } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some("jpg")
        } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
            Some("gif")
        } else if b.len() >= 12 && b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP") {
            Some("webp")
        } else if b.starts_with(b"BM") && b.len() > 26 {
            Some("bmp")
        } else {
            None
        }
    }

    fn hex(c: Rgba) -> String {
        format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
    }

    fn round4(v: f64) -> f64 {
        (v * 10_000.0).round() / 10_000.0
    }
}

#[cfg(feature = "pptx-images")]
mod images {
    //! Images mode: each slide drawn by deckcraft's renderer to a picture the
    //! slide shows full-frame. Fidelity is deckcraft's: fonts the deck asks for
    //! come from the system (or its substitutes), so it is the fallback for
    //! decks whose design matters more than editing them.

    use std::sync::atomic::{AtomicBool, Ordering};

    use deckcraft_model::Presentation;
    use deckcraft_render::{render_slide, RenderOpts};

    use super::{ImageSink, PptxImportError, PptxImportResult, Stage};

    /// Width the slides are drawn at, Selah's output frame.
    const RENDER_WIDTH: f64 = 1920.0;
    /// Slides are opaque, so JPEG: a tenth of a PNG's size for photos.
    const JPEG_QUALITY: u8 = 90;

    pub(super) fn render(
        pres: &Presentation,
        result: &mut PptxImportResult,
        sink: &mut dyn ImageSink,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Stage, usize, usize),
    ) -> Result<(), PptxImportError> {
        let width = pres.slide_size.width;
        let scale = if width > 0.0 { RENDER_WIDTH / width } else { 1.0 };
        let total = result.slides.len();
        for (n, slide) in result.slides.iter_mut().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err(PptxImportError::cancelled());
            }
            progress(Stage::Rendering, n, total);
            let image = render_slide(pres, slide.index, &RenderOpts { scale, ..Default::default() });
            let jpeg = if image.width > 0 && image.height > 0 { image.to_jpeg(JPEG_QUALITY) } else { Vec::new() };
            if jpeg.is_empty() {
                slide.warnings.push("Couldn't draw this slide as a picture".to_string());
                continue;
            }
            match sink.store(&format!("slide-{}", slide.index + 1), "jpg", &jpeg) {
                Ok(path) => slide.image_path = Some(path),
                Err(e) => {
                    tracing::warn!("[pptx] couldn't write slide {}: {e}", slide.index + 1);
                    slide.warnings.push("Couldn't save this slide's picture".to_string());
                }
            }
        }
        progress(Stage::Rendering, total, total);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
