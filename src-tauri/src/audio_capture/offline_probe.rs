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
//!
//! `SELAH_PROBE_PROMPT=<file>` supplies a decode prompt — the set list's
//! lyrics, say — to measure what contextual biasing is worth. Only whisper
//! models accept one: transcribe-cpp exposes `initial_prompt` on the whisper
//! run extension alone, because an RNN-T like Parakeet has no text input to
//! condition on. The engine reports the capability, so this asks rather than
//! assumes, and says so when a prompt is supplied to a model that will ignore
//! it.

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

/// What one configuration did with the recording.
#[derive(Default)]
struct Run {
    segments: usize,
    by_cause: std::collections::BTreeMap<&'static str, usize>,
    voiced_ms: u64,
    empty: usize,
    empty_by_cause: std::collections::BTreeMap<&'static str, usize>,
    short_total: usize,
    short_empty: usize,
    long_total: usize,
    long_empty: usize,
    /// Words of transcript produced. The matcher works on words, so this is
    /// closer to "usable signal delivered" than segment count is: a config can
    /// raise segment count while cutting phrases into pieces too small to say
    /// anything.
    words: usize,
    /// Distinct word types across the whole run. `words` is inflated by any
    /// overlap between windows — the same audio decoded twice yields the same
    /// words twice — so it cannot show whether overlap actually recovers
    /// anything. Vocabulary can: if overlap only duplicates, this stays flat;
    /// if it genuinely rescues phrases cut at a boundary, it rises.
    vocab: std::collections::BTreeSet<String>,
    gaps: Vec<(u32, u32)>,
}

/// A segment shorter than this rarely survives decoding — see the split in the
/// summary, where sub-1.5s segments come back empty several times as often.
const SHORT_SEGMENT_MS: u32 = 1_500;
/// A silence long enough that the transcript has visibly stopped.
const GAP_MS: u32 = 8_000;

#[allow(unused_variables, unused_mut)]
fn replay(
    samples: &[f32],
    total_ms: u32,
    vad_model: &PathBuf,
    config: VadConfig,
    session: &mut Option<transcribe_cpp::Session>,
    verbose: bool,
) -> Run {
    let mut segmenter = VadSegmenter::with_config(vad_model, config).expect("load silero");
    let mut run = Run::default();
    let mut last_end_ms = 0u32;

    for tick in samples.chunks(TICK_SAMPLES) {
        let Some(segment) = segmenter.process(tick).expect("vad") else {
            continue;
        };
        let dur_ms = (segment.samples.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
        run.segments += 1;
        run.voiced_ms += dur_ms as u64;
        *run.by_cause.entry(segment.cause.as_str()).or_default() += 1;

        // A long stretch with no segment at all is the failure this whole
        // investigation has been chasing; record it rather than leaving it to
        // be eyeballed out of the table.
        if segment.start_ms > last_end_ms + GAP_MS {
            run.gaps.push((last_end_ms, segment.start_ms));
        }
        last_end_ms = segment.start_ms + dur_ms;

        let text = {
            #[cfg(feature = "native-transcription")]
            {
                match session.as_mut() {
                    Some(s) => {
                        let opts = run_options(s);
                        s.run(&segment.samples, &opts)
                            .map(|r| r.text.trim().to_string())
                            .unwrap_or_else(|e| format!("<error: {e}>"))
                    }
                    None => String::new(),
                }
            }
            #[cfg(not(feature = "native-transcription"))]
            String::new()
        };

        run.words += text.split_whitespace().count();
        for word in text.split_whitespace() {
            run.vocab.insert(
                word.to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string(),
            );
        }
        if dur_ms < SHORT_SEGMENT_MS {
            run.short_total += 1;
        } else {
            run.long_total += 1;
        }
        if text.is_empty() {
            run.empty += 1;
            *run.empty_by_cause.entry(segment.cause.as_str()).or_default() += 1;
            if dur_ms < SHORT_SEGMENT_MS {
                run.short_empty += 1;
            } else {
                run.long_empty += 1;
            }
        }

        if verbose {
            println!(
                "{:>7} {:>7}ms {:<18}  {}",
                mmss(segment.start_ms),
                dur_ms,
                segment.cause.as_str(),
                if text.is_empty() { "<empty>" } else { &text }
            );
        }
    }

    if total_ms > last_end_ms + GAP_MS {
        run.gaps.push((last_end_ms, total_ms));
    }
    run
}

fn load_inputs() -> (Vec<f32>, u32, PathBuf, Option<transcribe_cpp::Session>) {
    let Some(wav) = env_path("SELAH_PROBE_WAV") else {
        panic!("set SELAH_PROBE_WAV to a 16 kHz mono WAV — see the module docs");
    };
    let samples = read_wav(&wav).expect("read wav");
    let total_ms = (samples.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
    println!("\naudio: {} ({})", wav.display(), mmss(total_ms));

    let vad_model = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("silero_vad.onnx");

    #[cfg(feature = "native-transcription")]
    let session = env_path("SELAH_PROBE_MODEL").map(|path| {
        use transcribe_cpp::{Feature, Model, ModelOptions};
        let model = Model::load_with(&path, &ModelOptions::default()).expect("load asr model");
        println!("model: {} (arch {})", path.display(), model.arch());
        if prompt().is_some() {
            if model.supports(Feature::InitialPrompt) {
                println!("prompt: supplied, and this model accepts one");
            } else {
                println!(
                    "prompt: supplied but IGNORED — {} has no text input to condition on",
                    model.arch()
                );
            }
        }
        model.session().expect("asr session")
    });
    #[cfg(not(feature = "native-transcription"))]
    let session = None;

    (samples, total_ms, vad_model, session)
}

/// Decode prompt for biasing, read from `SELAH_PROBE_PROMPT`.
fn prompt() -> Option<String> {
    let path = env_path("SELAH_PROBE_PROMPT")?;
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read prompt {path:?}: {e}"));
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Run options carrying the prompt when the loaded model can use one.
#[cfg(feature = "native-transcription")]
fn run_options(session: &transcribe_cpp::Session) -> transcribe_cpp::RunOptions {
    use transcribe_cpp::{RunExtension, RunOptions, WhisperRunOptions};
    let family = prompt().filter(|_| session.model().arch() == "whisper").map(|text| {
        RunExtension::Whisper(WhisperRunOptions {
            initial_prompt: Some(text),
            ..Default::default()
        })
    });
    RunOptions {
        family,
        ..Default::default()
    }
}

#[test]
#[ignore = "needs SELAH_PROBE_WAV (and optionally SELAH_PROBE_MODEL) on disk"]
fn offline_probe() {
    let (samples, total_ms, vad_model, mut session) = load_inputs();

    // `SELAH_PROBE_NO_FALLBACK=1` reproduces the behaviour before the
    // audible-audio fallback existed, so the two runs can be compared directly
    // instead of the fallback's value being argued from first principles.
    let mut config = VadConfig::default();
    if std::env::var("SELAH_PROBE_NO_FALLBACK").is_ok() {
        config.fallback_after_ms = 0;
        println!("fallback: DISABLED (pre-fallback behaviour)");
    }

    println!("\n{:>7} {:>8}  {:<18} {}", "start", "dur", "cause", "text");
    println!("{}", "-".repeat(100));
    let run = replay(&samples, total_ms, &vad_model, config, &mut session, true);

    let pct = |n: usize, d: usize| if d == 0 { 0.0 } else { n as f64 / d as f64 * 100.0 };
    println!("\n{}", "=".repeat(100));
    println!("segments        : {}", run.segments);
    for (cause, n) in &run.by_cause {
        println!("  {cause:<16}: {n}");
    }
    println!(
        "coverage        : {} of {} ({:.0}% of the audio reached the engine)",
        mmss(run.voiced_ms as u32),
        mmss(total_ms),
        run.voiced_ms as f64 / total_ms.max(1) as f64 * 100.0
    );
    println!("words           : {} ({} distinct)", run.words, run.vocab.len());
    println!(
        "empty text      : {} of {} ({:.0}%)",
        run.empty,
        run.segments,
        pct(run.empty, run.segments)
    );
    for (cause, n) in &run.empty_by_cause {
        println!("  {cause:<16}: {n}");
    }
    println!(
        "  {:<16}: {}/{} ({:.0}%)  <- fragments too short to carry a phrase",
        "under 1.5s",
        run.short_empty,
        run.short_total,
        pct(run.short_empty, run.short_total)
    );
    println!(
        "  {:<16}: {}/{} ({:.0}%)",
        "1.5s and over",
        run.long_empty,
        run.long_total,
        pct(run.long_empty, run.long_total)
    );
    if run.gaps.is_empty() {
        println!("gaps >8s        : none");
    } else {
        println!(
            "gaps >8s        : {} — this is the transcript going quiet",
            run.gaps.len()
        );
        for (from, to) in &run.gaps {
            println!("  {} .. {} ({}s)", mmss(*from), mmss(*to), (to - from) / 1000);
        }
    }
    println!("{}", "=".repeat(100));

    assert!(
        run.segments > 0,
        "no segments at all — the VAD heard nothing in this file"
    );
    let _ = SegmentCause::Silence;
}

/// Sweep the segmentation parameters over one recording, so a default is
/// chosen against measurements from real audio rather than intuition.
///
/// The column that matters most is `words`: the matcher consumes words, and a
/// setting can raise segment count while chopping phrases into pieces too
/// short for the model to decode at all.
#[test]
#[ignore = "needs SELAH_PROBE_WAV and SELAH_PROBE_MODEL; runs the whole file many times"]
fn offline_probe_sweep() {
    let (samples, total_ms, vad_model, mut session) = load_inputs();
    let defaults = VadConfig::default();

    println!(
        "\n{:>10} {:>10} {:>10} {:>6} {:>6} {:>7} {:>7} {:>6} {:>5}",
        "silence_ms", "speech_ms", "overlap", "segs", "cover", "empty", "words", "vocab", "gaps"
    );
    println!("{}", "-".repeat(78));

    // `min_speech_ms` moved the numbers barely at all across an earlier sweep
    // (250 vs 500 differed by under 1%), so it is pinned here and the grid
    // spends its time on the two that matter. Edit freely — the point of the
    // harness is that re-measuring is cheap.
    for &min_silence_ms in &[100u32, 300] {
        for &min_speech_ms in &[250u32] {
            for &fallback_after_ms in &[8_000u32] {
                for &fallback_overlap_ms in &[0u32, 1_000, 1_500, 2_500] {
                let config = VadConfig {
                    min_silence_ms,
                    min_speech_ms,
                    fallback_after_ms,
                    fallback_overlap_ms,
                    ..VadConfig::default()
                };
                let run = replay(&samples, total_ms, &vad_model, config, &mut session, false);
                let mark = if min_silence_ms == defaults.min_silence_ms
                    && min_speech_ms == defaults.min_speech_ms
                    && fallback_after_ms == defaults.fallback_after_ms
                {
                    " <- current"
                } else {
                    ""
                };
                println!(
                    "{:>10} {:>10} {:>10} {:>6} {:>5.0}% {:>6.0}% {:>7} {:>6} {:>5}{}",
                    min_silence_ms,
                    min_speech_ms,
                    fallback_overlap_ms,
                    run.segments,
                    run.voiced_ms as f64 / total_ms.max(1) as f64 * 100.0,
                    if run.segments == 0 {
                        0.0
                    } else {
                        run.empty as f64 / run.segments as f64 * 100.0
                    },
                    run.words,
                    run.vocab.len(),
                    run.gaps.len(),
                    mark,
                );
                }
            }
        }
    }
}
