//! Offline replay of a recorded service through the real capture pipeline.
//!
//! Every question in this area so far — did the VAD stop producing segments,
//! or did something downstream stop transcribing them; is the back half of a
//! song inaudible to Silero or merely hard for the ASR — has been answered by
//! playing audio into the running app, screenshotting, and reading a log
//! afterwards. That loop is slow, not reproducible, and mixes the pipeline in
//! with the UI, the renderer and the network.
//!
//! This runs the same audio through the same `VadSegmenter` and the same
//! engine, from a file, and prints what happened. It is deliberately built on
//! the shipping types rather than a copy of them: a harness that agrees with
//! a reimplementation of the pipeline proves nothing about the pipeline.
//!
//! Ignored by default because it needs a model and a recording on disk.
//!
//! ```text
//! ffmpeg -i song.mp3 -ar 16000 -ac 1 -c:a pcm_s16le /tmp/song.wav
//!
//! SELAH_PROBE_WAV=/tmp/song.wav \
//! SELAH_PROBE_MODEL="$HOME/Library/Application Support/app.selah.desktop/\
//! transcription-models/parakeet-unified-en-0.6b-Q8_0.gguf" \
//!   cargo test --all-features offline_probe -- --ignored --nocapture
//! ```
//!
//! Leave `SELAH_PROBE_MODEL` unset to time the segmentation alone, which is
//! fast and needs no ASR model.

use super::vad::{SegmentCause, VadConfig, VadSegmenter};
use std::path::PathBuf;

/// Samples handed to the VAD per tick. The capture loop drains its buffer
/// every 10 ms, so replaying in the same size keeps segment boundaries
/// comparable with a live run rather than merely similar.
const TICK_SAMPLES: usize = 160;
const SAMPLE_RATE: u32 = 16_000;

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key).ok().filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Read a 16 kHz mono WAV as f32 samples.
fn read_wav(path: &PathBuf) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("open {path:?}: {e}"))?;
    let spec = reader.spec();
    if spec.sample_rate != SAMPLE_RATE || spec.channels != 1 {
        return Err(format!(
            "expected 16 kHz mono, got {} Hz / {} channel(s) — reconvert with ffmpeg",
            spec.sample_rate, spec.channels
        ));
    }
    match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| format!("read f32: {e}")),
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()
                .map_err(|e| format!("read int: {e}"))
        }
    }
}

fn mmss(ms: u32) -> String {
    format!("{}:{:02}", ms / 60_000, (ms % 60_000) / 1000)
}

#[test]
#[ignore = "needs SELAH_PROBE_WAV (and optionally SELAH_PROBE_MODEL) on disk"]
fn offline_probe() {
    let Some(wav) = env_path("SELAH_PROBE_WAV") else {
        panic!("set SELAH_PROBE_WAV to a 16 kHz mono WAV — see the module docs");
    };
    let samples = read_wav(&wav).expect("read wav");
    let total_ms = (samples.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
    println!("\naudio: {} ({})", wav.display(), mmss(total_ms));

    let vad_model = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("silero_vad.onnx");
    // `SELAH_PROBE_NO_FALLBACK=1` reproduces the behaviour before the
    // audible-audio fallback existed, so the two runs can be compared directly
    // instead of the fallback's value being argued from first principles.
    let mut config = VadConfig::default();
    if std::env::var("SELAH_PROBE_NO_FALLBACK").is_ok() {
        config.fallback_after_ms = 0;
        println!("fallback: DISABLED (pre-fallback behaviour)");
    }
    let mut segmenter = VadSegmenter::with_config(&vad_model, config).expect("load silero");

    #[cfg(feature = "native-transcription")]
    let mut session = env_path("SELAH_PROBE_MODEL").map(|path| {
        use transcribe_cpp::{Model, ModelOptions};
        let model = Model::load_with(&path, &ModelOptions::default()).expect("load asr model");
        println!("model: {}", path.display());
        model.session().expect("asr session")
    });

    println!("\n{:>7} {:>8}  {:<18} {}", "start", "dur", "cause", "text");
    println!("{}", "-".repeat(100));

    let mut segments = 0usize;
    let mut by_cause = std::collections::BTreeMap::<&str, usize>::new();
    let mut voiced_ms: u64 = 0;
    let mut empty_text = 0usize;
    // Split by duration: a segment too short to carry a phrase tends to decode
    // to nothing at all, and that is a segmentation problem rather than a model
    // one — worth seeing separately from the overall empty rate.
    let (mut short_total, mut short_empty) = (0usize, 0usize);
    let (mut long_total, mut long_empty) = (0usize, 0usize);
    let mut empty_by_cause = std::collections::BTreeMap::<&str, usize>::new();
    let mut last_end_ms = 0u32;
    let mut gaps: Vec<(u32, u32)> = Vec::new();

    for tick in samples.chunks(TICK_SAMPLES) {
        let Some(segment) = segmenter.process(tick).expect("vad") else {
            continue;
        };
        segments += 1;
        let dur_ms = (segment.samples.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
        voiced_ms += dur_ms as u64;
        *by_cause.entry(segment.cause.as_str()).or_default() += 1;

        // A long stretch with no segment at all is the failure this whole
        // investigation has been chasing; record it rather than leaving it to
        // be eyeballed out of the table.
        if segment.start_ms > last_end_ms + 8_000 {
            gaps.push((last_end_ms, segment.start_ms));
        }
        last_end_ms = segment.start_ms + dur_ms;

        let text = {
            #[cfg(feature = "native-transcription")]
            {
                use transcribe_cpp::RunOptions;
                match session.as_mut() {
                    Some(s) => s
                        .run(&segment.samples, &RunOptions::default())
                        .map(|r| r.text.trim().to_string())
                        .unwrap_or_else(|e| format!("<error: {e}>")),
                    None => String::new(),
                }
            }
            #[cfg(not(feature = "native-transcription"))]
            String::new()
        };
        if dur_ms < 1_500 {
            short_total += 1;
        } else {
            long_total += 1;
        }
        if text.is_empty() {
            empty_text += 1;
            *empty_by_cause.entry(segment.cause.as_str()).or_default() += 1;
            if dur_ms < 1_500 {
                short_empty += 1;
            } else {
                long_empty += 1;
            }
        }

        println!(
            "{:>7} {:>7}ms {:<18}  {}",
            mmss(segment.start_ms),
            dur_ms,
            segment.cause.as_str(),
            if text.is_empty() { "<empty>" } else { &text }
        );
    }
    if let Some(segment) = segmenter.flush() {
        segments += 1;
        println!("{:>7} {:>7}ms  (flush)", mmss(segment.start_ms), 0);
    }

    if total_ms > last_end_ms + 8_000 {
        gaps.push((last_end_ms, total_ms));
    }

    println!("\n{}", "=".repeat(100));
    println!("segments        : {segments}");
    for (cause, n) in &by_cause {
        println!("  {cause:<16}: {n}");
    }
    println!(
        "coverage        : {} of {} ({:.0}% of the audio reached the engine)",
        mmss(voiced_ms as u32),
        mmss(total_ms),
        voiced_ms as f64 / total_ms.max(1) as f64 * 100.0
    );
    let pct = |n: usize, d: usize| if d == 0 { 0.0 } else { n as f64 / d as f64 * 100.0 };
    println!(
        "empty text      : {empty_text} of {segments} ({:.0}%)",
        pct(empty_text, segments)
    );
    for (cause, n) in &empty_by_cause {
        println!("  {cause:<16}: {n}");
    }
    println!(
        "  {:<16}: {}/{} ({:.0}%)  <- fragments too short to carry a phrase",
        "under 1.5s",
        short_empty,
        short_total,
        pct(short_empty, short_total)
    );
    println!(
        "  {:<16}: {}/{} ({:.0}%)",
        "1.5s and over",
        long_empty,
        long_total,
        pct(long_empty, long_total)
    );
    if gaps.is_empty() {
        println!("gaps >8s        : none");
    } else {
        println!("gaps >8s        : {} — this is the transcript going quiet", gaps.len());
        for (from, to) in &gaps {
            println!("  {} .. {} ({}s)", mmss(*from), mmss(*to), (to - from) / 1000);
        }
    }
    println!("{}", "=".repeat(100));

    assert!(segments > 0, "no segments at all — the VAD heard nothing in this file");
    let _ = SegmentCause::Silence;
}
