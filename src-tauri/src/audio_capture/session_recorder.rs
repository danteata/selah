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
