//! Dev-only session audio recorder.
//!
//! Records the raw, continuous (pre-VAD) audio for a sermon-listener session
//! to a WAV file on disk, so it can later be re-transcribed offline with a
//! bigger/more-accurate model and compared against what the live detector
//! flagged in realtime. This is developer tooling only — compiled out of
//! release builds entirely via `#[cfg(debug_assertions)]` at the call sites
//! in `mod.rs`.
//!
//! Recording the raw buffer (not just VAD-flagged speech segments) matters:
//! a VAD false negative would otherwise be invisible to both the live
//! detector AND the offline "ground truth" pass, defeating the point of an
//! independent comparison.
//!
//! Known caveat: if the app is force-quit before `finish()` runs, the WAV's
//! RIFF header will have a stale/zero size (hound only patches it in
//! `finalize()`). Acceptable for dev tooling; not handled in v1.

use hound::{WavSpec, WavWriter};
use parking_lot::Mutex;
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};

pub struct SessionRecorder {
    writer: Mutex<Option<WavWriter<BufWriter<File>>>>,
    #[allow(dead_code)]
    pub path: PathBuf,
}

impl SessionRecorder {
    pub fn start(path: PathBuf, sample_rate: u32) -> Result<Self, String> {
        let spec = WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let writer = WavWriter::create(&path, spec)
            .map_err(|e| format!("Failed to create session recording: {e}"))?;
        Ok(Self { writer: Mutex::new(Some(writer)), path })
    }

    /// Append raw samples (mono, matching the sample rate passed to `start`).
    pub fn append(&self, samples: &[f32]) {
        let mut guard = self.writer.lock();
        if let Some(w) = guard.as_mut() {
            for &s in samples {
                let clamped = s.clamp(-1.0, 1.0);
                let _ = w.write_sample((clamped * 32767.0) as i16);
            }
        }
    }

    /// Finalize the WAV (patches the RIFF/data chunk sizes). Consumes the
    /// writer so a second `finish()` call is a no-op.
    pub fn finish(&self) -> Result<(), String> {
        if let Some(w) = self.writer.lock().take() {
            w.finalize().map_err(|e| format!("Failed to finalize session recording: {e}"))?;
        }
        Ok(())
    }
}

/// Keep at most `keep` most-recent `.wav` recordings (plus their `.json`
/// sidecars, if present) in `dir`, deleting the oldest by modified time.
/// Called at recording START (not stop) so a crash mid-recording doesn't
/// wedge future cleanup — the next session that starts still prunes.
pub fn prune_to_last_n(dir: &Path, keep: usize) -> Result<(), String> {
    let mut wavs: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()), // directory doesn't exist yet — nothing to prune
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                wavs.push((path, modified));
            }
        }
    }

    if wavs.len() <= keep {
        return Ok(());
    }

    // Oldest first.
    wavs.sort_by_key(|(_, modified)| *modified);
    let excess = wavs.len() - keep;

    for (path, _) in wavs.into_iter().take(excess) {
        let _ = fs::remove_file(&path);
        // Best-effort: remove the matching sidecar JSON/report too, if any.
        let json_sidecar = path.with_extension("json");
        let _ = fs::remove_file(&json_sidecar);
        let report_sidecar = path.with_file_name(format!(
            "{}-report.md",
            path.file_stem().and_then(|s| s.to_str()).unwrap_or_default()
        ));
        let _ = fs::remove_file(&report_sidecar);
    }

    Ok(())
}

// --- production sermon recordings -------------------------------------------
//
// The helpers below serve the operator-facing sermon archive, not the dev
// accuracy tooling above. They live here because they share `SessionRecorder`
// and the WAV format it writes.

/// One recording on disk, as the frontend sees it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingFile {
    /// The session id, taken from the filename stem.
    pub session_id: String,
    pub path: String,
    pub bytes: u64,
    /// Milliseconds since the Unix epoch, from the file's modified time.
    pub modified_ms: u64,
    /// Playing length, read from the WAV header. `None` if it could not be
    /// parsed — a truncated or in-progress file.
    pub duration_secs: Option<f64>,
}

/// Offset of the 32-bit RIFF chunk size, and the fixed header prelude length.
const RIFF_SIZE_OFFSET: u64 = 4;
const RIFF_PRELUDE: u64 = 12; // "RIFF" + size + "WAVE"

fn read_u32_le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// Locate the `data` chunk: returns (offset of its size field, declared size).
fn find_data_chunk(file: &mut File) -> Option<(u64, u32)> {
    use std::io::{Read, Seek, SeekFrom};

    let len = file.metadata().ok()?.len();
    let mut cursor = RIFF_PRELUDE;

    while cursor + 8 <= len {
        file.seek(SeekFrom::Start(cursor)).ok()?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header).ok()?;
        let size = read_u32_le(&header[4..8]);

        if &header[0..4] == b"data" {
            return Some((cursor + 4, size));
        }
        // Chunks are word-aligned: an odd size is followed by a pad byte.
        cursor += 8 + u64::from(size) + u64::from(size % 2);
    }
    None
}

/// Repair a WAV whose header sizes were never patched.
///
/// `hound` only writes the real RIFF/data sizes in `finalize()`, so a process
/// that dies mid-recording leaves a file whose header claims zero samples. For
/// dev tooling that was an acceptable known caveat; for a sermon nobody can
/// re-record it is the difference between an archive and a dead file. The audio
/// itself is intact — only the two length fields are wrong — so this recomputes
/// them from the actual file length.
///
/// Returns `Ok(true)` when it changed something. Safe to call on a healthy
/// file: the sizes already agree and it does nothing.
pub fn repair_wav_header(path: &Path) -> Result<bool, String> {
    use std::io::{Seek, SeekFrom, Write};

    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("could not open {}: {e}", path.display()))?;

    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len < RIFF_PRELUDE + 8 {
        return Err("file is too short to be a WAV".to_string());
    }

    let (data_size_offset, declared_data) =
        find_data_chunk(&mut file).ok_or_else(|| "no data chunk found".to_string())?;

    let actual_data = len - (data_size_offset + 4);
    let actual_riff = len - 8;

    file.seek(SeekFrom::Start(RIFF_SIZE_OFFSET))
        .map_err(|e| e.to_string())?;
    let mut riff_bytes = [0u8; 4];
    use std::io::Read;
    file.read_exact(&mut riff_bytes).map_err(|e| e.to_string())?;
    let declared_riff = read_u32_le(&riff_bytes);

    if u64::from(declared_riff) == actual_riff && u64::from(declared_data) == actual_data {
        return Ok(false);
    }

    // A file larger than 4 GiB cannot be described by these fields at all;
    // refuse rather than write a wrapped value that looks plausible.
    if actual_riff > u64::from(u32::MAX) || actual_data > u64::from(u32::MAX) {
        return Err("recording exceeds the 4 GiB WAV limit".to_string());
    }

    file.seek(SeekFrom::Start(RIFF_SIZE_OFFSET))
        .map_err(|e| e.to_string())?;
    file.write_all(&(actual_riff as u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(data_size_offset))
        .map_err(|e| e.to_string())?;
    file.write_all(&(actual_data as u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;

    Ok(true)
}

/// Playing length in seconds, from the `fmt ` and `data` chunks.
fn wav_duration_secs(path: &Path) -> Option<f64> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();

    // byte rate lives at offset 8 within the `fmt ` chunk body.
    let mut cursor = RIFF_PRELUDE;
    let mut byte_rate: Option<u32> = None;

    while cursor + 8 <= len {
        file.seek(SeekFrom::Start(cursor)).ok()?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header).ok()?;
        let size = read_u32_le(&header[4..8]);

        if &header[0..4] == b"fmt " && size >= 16 {
            let mut body = [0u8; 16];
            file.read_exact(&mut body).ok()?;
            byte_rate = Some(read_u32_le(&body[8..12]));
        } else if &header[0..4] == b"data" {
            // Trust the file length rather than the declared size: an
            // unrepaired file declares zero, and the bytes are still there.
            let actual = len - (cursor + 8);
            let rate = byte_rate?;
            if rate == 0 {
                return None;
            }
            return Some(actual as f64 / f64::from(rate));
        }
        cursor += 8 + u64::from(size) + u64::from(size % 2);
    }
    None
}

/// Every recording in `dir`, newest first.
pub fn list_recordings(dir: &Path) -> Vec<RecordingFile> {
    let mut out: Vec<RecordingFile> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out, // not created yet — no recordings
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Some(session_id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else { continue };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        out.push(RecordingFile {
            session_id: session_id.to_string(),
            path: path.to_string_lossy().to_string(),
            bytes: metadata.len(),
            modified_ms,
            duration_secs: wav_duration_secs(&path),
        });
    }

    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom, Write};

    /// A real WAV, written the way `SessionRecorder` writes one.
    fn write_wav(path: &Path, samples: usize) {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = WavWriter::create(path, spec).expect("create wav");
        for i in 0..samples {
            writer.write_sample((i % 1000) as i16).expect("write sample");
        }
        writer.finalize().expect("finalize");
    }

    /// Reproduce what a force-quit leaves behind: all the audio, but the two
    /// length fields never patched, so every player sees an empty file.
    fn zero_the_lengths(path: &Path) {
        let mut file = fs::OpenOptions::new().read(true).write(true).open(path).unwrap();
        let (data_size_offset, _) = find_data_chunk(&mut file).expect("data chunk");
        file.seek(SeekFrom::Start(RIFF_SIZE_OFFSET)).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap();
        file.seek(SeekFrom::Start(data_size_offset)).unwrap();
        file.write_all(&0u32.to_le_bytes()).unwrap();
    }

    fn read_u32_at(path: &Path, offset: u64) -> u32 {
        let mut file = File::open(path).unwrap();
        file.seek(SeekFrom::Start(offset)).unwrap();
        let mut buf = [0u8; 4];
        file.read_exact(&mut buf).unwrap();
        u32::from_le_bytes(buf)
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("selah-recorder-tests");
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn repairs_a_recording_the_app_died_during() {
        let path = temp_path("crashed.wav");
        write_wav(&path, 16_000); // one second
        let healthy_len = fs::metadata(&path).unwrap().len();
        zero_the_lengths(&path);

        assert_eq!(read_u32_at(&path, RIFF_SIZE_OFFSET), 0, "precondition");
        assert_eq!(wav_duration_secs(&path), Some(1.0), "audio is intact either way");

        let changed = repair_wav_header(&path).expect("repair");

        assert!(changed);
        assert_eq!(read_u32_at(&path, RIFF_SIZE_OFFSET), (healthy_len - 8) as u32);
        assert_eq!(wav_duration_secs(&path), Some(1.0));
        fs::remove_file(&path).ok();
    }

    #[test]
    fn leaves_a_healthy_recording_untouched() {
        let path = temp_path("healthy.wav");
        write_wav(&path, 8_000);
        let before = fs::read(&path).unwrap();

        let changed = repair_wav_header(&path).expect("repair");

        assert!(!changed, "a finalized file needs no repair");
        assert_eq!(fs::read(&path).unwrap(), before, "bytes must not move");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn repairing_twice_is_a_no_op_the_second_time() {
        let path = temp_path("twice.wav");
        write_wav(&path, 4_000);
        zero_the_lengths(&path);

        assert!(repair_wav_header(&path).unwrap());
        assert!(!repair_wav_header(&path).unwrap());
        fs::remove_file(&path).ok();
    }

    #[test]
    fn refuses_a_file_that_is_not_a_wav() {
        let path = temp_path("truncated.bin");
        fs::write(&path, b"RIFF").unwrap();

        assert!(repair_wav_header(&path).is_err());
        fs::remove_file(&path).ok();
    }

    #[test]
    fn duration_reads_the_real_length_not_the_declared_one() {
        // The case that matters for the archive list: an unrepaired file must
        // still report how long it is, or the row shows "length unknown" for a
        // recording that is perfectly playable once repaired.
        let path = temp_path("duration.wav");
        write_wav(&path, 16_000 * 3);
        zero_the_lengths(&path);

        let secs = wav_duration_secs(&path).expect("duration");
        assert!((secs - 3.0).abs() < 0.01, "expected ~3s, got {secs}");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn lists_newest_first_and_skips_non_wav_files() {
        let dir = std::env::temp_dir().join("selah-recorder-tests-list");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        write_wav(&dir.join("older.wav"), 1_000);
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_wav(&dir.join("newer.wav"), 1_000);
        fs::write(dir.join("notes.txt"), b"ignore me").unwrap();

        let listed = list_recordings(&dir);

        assert_eq!(listed.len(), 2, "the .txt must not be listed");
        assert_eq!(listed[0].session_id, "newer");
        assert_eq!(listed[1].session_id, "older");
        let _ = fs::remove_dir_all(&dir);
    }
}
