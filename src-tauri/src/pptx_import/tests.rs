//! Golden output for the fixture decks (`scripts/pptx-fixtures/make_fixtures.py`)
//! and the hostile files the container check must turn away. Refresh the
//! goldens with `UPDATE_GOLDEN=1 cargo test … pptx_import` after an
//! intended change, and read the diff.
#![cfg(feature = "pptx-import")]

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use super::*;

/// Records what was stored and hands back a stable, machine-independent path.
#[derive(Default)]
struct FakeSink {
    stored: Vec<String>,
}

impl ImageSink for FakeSink {
    fn store(&mut self, name: &str, ext: &str, _bytes: &[u8]) -> Result<String, String> {
        let path = format!("media/{name}.{ext}");
        self.stored.push(path.clone());
        Ok(path)
    }
}

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pptx")
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(name)).unwrap()
}

fn import_with(bytes: &[u8], limits: &Limits, sink: &mut FakeSink, cancel: bool) -> Result<PptxImportResult, PptxImportError> {
    let cancel = AtomicBool::new(cancel);
    import_bytes(bytes, "deck", ImportMode::Editable, limits, sink, &cancel, &mut |_, _, _| {})
}

fn import(bytes: &[u8]) -> Result<PptxImportResult, PptxImportError> {
    import_with(bytes, &Limits::default(), &mut FakeSink::default(), false)
}

fn kind(r: Result<PptxImportResult, PptxImportError>) -> ErrorKind {
    r.unwrap_err().kind
}

fn check_golden(name: &str) {
    let result = import(&fixture(&format!("{name}.pptx"))).unwrap();
    let actual = serde_json::to_string_pretty(&result).unwrap() + "\n";
    let path = fixtures().join(format!("{name}.golden.json"));
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap();
    assert_eq!(actual, expected, "{name} differs from its golden; rerun with UPDATE_GOLDEN=1 if intended");
}

#[test]
fn lyric_deck_matches_golden() {
    check_golden("lyric-16x9");
}

#[test]
fn announce_deck_matches_golden() {
    check_golden("announce-4x3");
}

fn texts(slide: &ImportedSlide) -> Vec<String> {
    slide.paragraphs.iter().map(|p| p.runs.iter().map(|r| r.text.as_str()).collect()).collect()
}

#[test]
fn lyric_deck_keeps_text_backgrounds_and_notes() {
    let mut sink = FakeSink::default();
    let r = import_with(&fixture("lyric-16x9.pptx"), &Limits::default(), &mut sink, false).unwrap();
    assert_eq!(r.slides.len(), 4);
    assert!((r.aspect - 16.0 / 9.0).abs() < 0.001);

    let s = &r.slides[0];
    assert_eq!(s.title.as_deref(), Some("Amazing Grace"));
    assert_eq!(texts(s)[0], "Amazing Grace");
    assert_eq!(texts(s)[4], "Was blind, but now I see");
    assert!(s.paragraphs.iter().all(|p| p.align == Align::Center && p.bullet == BulletKind::None));
    // Dark theme: tx1 maps to lt1.
    assert_eq!(s.paragraphs[0].runs[0].color.as_deref(), Some("#ffffff"));
    assert_eq!(s.paragraphs[0].runs[0].font.as_deref(), Some("Calibri Light"));
    assert_eq!(s.paragraphs[1].runs[0].font.as_deref(), Some("Calibri"));
    // The master's picture, written once for every slide that shows it.
    let master_bg = ImportedBackground::Image { path: sink.stored[0].clone() };
    assert_eq!(s.background, master_bg);
    assert_eq!(r.slides[1].background, master_bg);
    assert_eq!(sink.stored.len(), 1);

    let twi = &r.slides[1];
    assert_eq!(twi.title, None);
    assert_eq!(texts(twi)[0], "Ɛyɛ me dɛ sɛ meyɛ wo dea\nƆdɔ a ɛnni awieeɛ");
    assert_eq!(texts(twi)[1], "");
    assert_eq!(twi.notes.as_deref(), Some("Sing twice\nKey of G"));

    let hidden = &r.slides[2];
    assert!(hidden.hidden);
    let runs = &hidden.paragraphs[1].runs;
    assert_eq!(hidden.paragraphs[1].align, Align::Left);
    assert!(runs.iter().any(|r| r.text == "great" && r.b && !r.i));
    assert!(runs.iter().any(|r| r.text == "our God" && r.i && r.u && r.color.as_deref() == Some("#ffc000")));
    assert!(runs.iter().any(|r| r.text == ", sing with me" && r.font.as_deref() == Some("Montserrat")));

    assert_eq!(r.slides[3].background, ImportedBackground::Color { color: "#1f3864".into() });
    assert!(r.slides.iter().all(|s| s.warnings.is_empty()));
}

#[test]
fn announce_deck_maps_layout_and_drops_what_it_cannot_edit() {
    let r = import(&fixture("announce-4x3.pptx")).unwrap();
    assert_eq!(r.slides.len(), 4);
    assert!((r.aspect - 4.0 / 3.0).abs() < 0.001);

    let s = &r.slides[0];
    assert_eq!(texts(s), ["Church Announcements", "Youth camp", "Register by Friday", "Choir practice"]);
    assert_eq!(s.paragraphs[1].bullet, BulletKind::Bullet);
    assert_eq!(s.paragraphs[2].level, 1);
    assert_eq!(s.paragraphs[2].bullet, BulletKind::Bullet);
    assert_eq!(s.paragraphs[0].bullet, BulletKind::None);
    assert_eq!(s.paragraphs[0].runs[0].color.as_deref(), Some("#000000"));
    assert_eq!(s.notes.as_deref(), Some("Mention the deadline"));
    assert!(s.warnings.contains(&"Left out a picture".to_string()), "{:?}", s.warnings);
    assert!(s.warnings.contains(&"Left out a chart".to_string()), "{:?}", s.warnings);
    // Light theme, no picture: bg1 → lt1.
    assert_eq!(s.background, ImportedBackground::Color { color: "#ffffff".into() });

    let photo = &r.slides[1];
    assert!(matches!(photo.background, ImportedBackground::Image { .. }));
    assert_eq!(photo.paragraphs[0].runs[0].font.as_deref(), Some("Georgia"));
    assert_eq!(photo.paragraphs[0].align, Align::Center);
    assert_eq!(photo.warnings, ["Left out SmartArt"]);

    let grouped = &r.slides[2];
    let ImportedBackground::Gradient { angle, radial, stops } = &grouped.background else {
        panic!("expected a gradient, got {:?}", grouped.background)
    };
    assert_eq!((*angle, *radial), (90.0, false));
    assert_eq!(stops.iter().map(|s| s.color.as_str()).collect::<Vec<_>>(), ["#0f0c29", "#302b63"]);
    // The grouped text box maps from child space onto the slide, and the box
    // is the union of it and the list below.
    assert_eq!(grouped.r#box, Some(TextBox { x: 0.1, y: 0.1333, w: 0.8, h: 0.7667 }));
    assert_eq!(texts(grouped)[0], "Fish & Chips <script>alert(\"x\")</script>");
    assert_eq!(grouped.paragraphs[0].align, Align::Right);
    assert!(grouped.paragraphs[1..].iter().all(|p| p.bullet == BulletKind::Number));

    let emf = &r.slides[3];
    assert_eq!(emf.warnings, ["Left out a picture in a format Selah can't show"]);
    assert_eq!(emf.background, ImportedBackground::Color { color: "#ffffff".into() });
    assert_eq!(texts(emf), ["Offering"]);
}

fn zip_of(entries: &[(&str, &[u8])], method: zip::CompressionMethod) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(method);
    for (name, data) in entries {
        z.start_file(*name, opts).unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap().into_inner()
}

const CONTENT_TYPES: (&str, &[u8]) = ("[Content_Types].xml", b"<Types/>");

fn small_limits() -> Limits {
    Limits { max_entry: 1024 * 1024, max_total: 2 * 1024 * 1024, ..Limits::default() }
}

#[test]
fn an_entry_that_inflates_past_the_limit_is_a_zip_bomb() {
    let zeros = vec![0u8; 3 * 1024 * 1024];
    let bomb = zip_of(&[CONTENT_TYPES, ("ppt/media/huge.bin", &zeros)], zip::CompressionMethod::Deflated);
    assert!(bomb.len() < 64 * 1024, "the bomb should be small on disk");
    let r = import_with(&bomb, &small_limits(), &mut FakeSink::default(), false);
    assert_eq!(kind(r), ErrorKind::ZipBomb);
}

#[test]
fn entries_that_together_inflate_past_the_limit_are_a_zip_bomb() {
    let part = vec![0u8; 900 * 1024];
    let bomb = zip_of(
        &[CONTENT_TYPES, ("a.bin", &part), ("b.bin", &part), ("c.bin", &part)],
        zip::CompressionMethod::Deflated,
    );
    let r = import_with(&bomb, &small_limits(), &mut FakeSink::default(), false);
    assert_eq!(kind(r), ErrorKind::ZipBomb);
}

#[test]
fn too_many_entries_are_refused() {
    let names: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("e{i}")).collect();
    let mut entries: Vec<(&str, &[u8])> = vec![CONTENT_TYPES];
    entries.extend(names.iter().map(|n| (n.as_str(), &b""[..])));
    let z = zip_of(&entries, zip::CompressionMethod::Stored);
    assert_eq!(kind(import(&z)), ErrorKind::TooManyEntries);
}

#[test]
fn a_truncated_file_is_an_error_not_a_panic() {
    let v = fixture("lyric-16x9.pptx");
    for cut in [0, 2, 10, v.len() / 4, v.len() / 2, v.len() - 30, v.len() - 1] {
        assert_eq!(kind(import(&v[..cut])), ErrorKind::NotPptx, "cut at {cut}");
    }
}

fn cfb_with_stream(name: &str) -> Vec<u8> {
    let mut v = CFB_MAGIC.to_vec();
    v.resize(512, 0);
    v.extend(name.encode_utf16().flat_map(u16::to_le_bytes));
    v.resize(2048, 0);
    v
}

#[test]
fn a_password_protected_deck_says_so() {
    let r = import(&cfb_with_stream("EncryptedPackage"));
    let e = r.unwrap_err();
    assert_eq!(e.kind, ErrorKind::Encrypted);
    assert!(e.message.contains("password"));
}

#[test]
fn a_legacy_ppt_says_so() {
    let e = import(&cfb_with_stream("PowerPoint Document")).unwrap_err();
    assert_eq!(e.kind, ErrorKind::LegacyPpt);
    assert!(e.message.contains(".pptx"));
}

#[test]
fn other_files_are_not_presentations() {
    assert_eq!(kind(import(b"")), ErrorKind::NotPptx);
    assert_eq!(kind(import(b"%PDF-1.7 not a deck")), ErrorKind::NotPptx);
    let no_types = zip_of(&[("hello.txt", b"hi")], zip::CompressionMethod::Deflated);
    assert_eq!(kind(import(&no_types)), ErrorKind::NotPptx);
    let no_presentation = zip_of(&[CONTENT_TYPES, ("hello.txt", b"hi")], zip::CompressionMethod::Deflated);
    assert_eq!(kind(import(&no_presentation)), ErrorKind::NotPptx);
}

#[test]
fn a_file_over_the_size_limit_is_refused() {
    let limits = Limits { max_file: 1024, ..Limits::default() };
    let r = import_with(&fixture("lyric-16x9.pptx"), &limits, &mut FakeSink::default(), false);
    assert_eq!(kind(r), ErrorKind::TooLarge);
}

#[test]
fn cancelling_stops_the_import() {
    let r = import_with(&fixture("lyric-16x9.pptx"), &Limits::default(), &mut FakeSink::default(), true);
    assert_eq!(kind(r), ErrorKind::Cancelled);
}

#[test]
fn progress_reaches_the_end_of_each_stage() {
    let mut seen = vec![];
    let cancel = AtomicBool::new(false);
    import_bytes(
        &fixture("announce-4x3.pptx"),
        "deck",
        ImportMode::Editable,
        &Limits::default(),
        &mut FakeSink::default(),
        &cancel,
        &mut |stage, done, total| seen.push((stage, done, total)),
    )
    .unwrap();
    for stage in [Stage::Checking, Stage::Reading, Stage::Converting] {
        assert!(seen.iter().any(|&(s, d, t)| s == stage && d == t), "{stage:?} never finished: {seen:?}");
    }
    assert!(seen.contains(&(Stage::Converting, 4, 4)));
}

#[test]
fn the_limits_are_the_documented_ones() {
    let l = Limits::default();
    assert_eq!(l.max_file, 200 * 1024 * 1024);
    assert_eq!(l.max_entries, 10_000);
    assert_eq!(l.max_entry, 256 * 1024 * 1024);
    assert_eq!(l.max_total, 1024 * 1024 * 1024);
}

#[test]
fn import_ids_are_plain_names() {
    assert!(checked_import_id("pptx-1a2B_3").is_ok());
    for bad in ["", "../escape", "a/b", "a b", &"x".repeat(65)] {
        assert!(checked_import_id(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn only_pictures_the_webview_shows_are_written() {
    assert_eq!(convert::sniff_image(b"\x89PNG\r\n\x1a\n...."), Some("png"));
    assert_eq!(convert::sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
    assert_eq!(convert::sniff_image(b"GIF89a.."), Some("gif"));
    assert_eq!(convert::sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
    assert_eq!(convert::sniff_image(&[1, 0, 0, 0, 108, 0, 0, 0]), None);
    assert_eq!(convert::sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
}

#[test]
fn the_wire_format_is_camel_case() {
    let e = PptxImportError::new(ErrorKind::TooManyEntries, "x");
    assert_eq!(serde_json::to_value(&e).unwrap(), serde_json::json!({ "kind": "tooManyEntries", "message": "x" }));
    let mode: ImportMode = serde_json::from_str("\"images\"").unwrap();
    assert_eq!(mode, ImportMode::Images);
}
