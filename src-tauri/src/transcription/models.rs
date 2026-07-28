//! Transcription model catalog + downloader.
//!
//! Engine-agnostic and free of `transcribe-rs`, so it compiles and is testable
//! on the default build. The current catalog is entirely single-file GGUF loaded
//! through `transcribe-cpp`; the retained `legacy` entries are the older
//! `.bin` files and gzipped ONNX tarballs (which extract to a directory).
//! Downloads are resumable (HTTP Range), SHA-256-verified, and report progress
//! via the `model-download-progress` Tauri event.
//!
//! Wired to Tauri commands + the engine in Phase 3; some items are unused until
//! then.
#![allow(dead_code)]

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

/// Which inference engine a model uses (mirrors transcribe-rs engines).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    /// Whisper-family and other GGUF models via transcribe-cpp (GGUF file).
    TranscribeCpp,
    /// Parakeet via ONNX (directory).
    Parakeet,
    /// Moonshine (non-streaming) via ONNX (directory).
    Moonshine,
    /// Moonshine streaming via ONNX (directory).
    MoonshineStreaming,
    /// SenseVoice via ONNX (directory).
    SenseVoice,
    /// GigaAM (Russian) via ONNX (directory).
    GigaAM,
    /// NVIDIA Canary via ONNX (directory).
    Canary,
    /// Cohere multilingual via ONNX (directory).
    Cohere,
}

/// The finest timestamp granularity a model produces, for verse-timing
/// alignment. Mirrors `transcribe_cpp::TimestampKind` minus its `Auto` request
/// variant — this describes what a model *can* emit, not what was asked for.
///
/// The engine populates `TranscriptionOutput.segments` whenever this is better
/// than [`TimestampSupport::None`]; see `engine::convert_cpp_segments`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimestampSupport {
    /// Text only — no alignment data.
    None,
    /// Segment-level start/end times (Whisper-family).
    Segment,
    /// Word-level start/end times.
    Word,
    /// Token-level start/end times (Parakeet/Nemotron families), which
    /// transcribe-cpp also groups into segment rows.
    Token,
}

/// On-disk shape of a model.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelFormat {
    /// A single file (the download is the model, e.g. a GGUF `.bin`).
    File,
    /// A directory produced by extracting a `.tar.gz` download.
    Directory,
}

/// Static metadata for a model.
#[derive(Clone, Debug, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub engine_type: EngineType,
    pub format: ModelFormat,
    /// Final on-disk name: the `.bin` filename (File) or the directory name (Directory).
    pub filename: String,
    /// Download URL. `None` means "bundled / installed out of band".
    pub url: Option<String>,
    /// Optional SHA-256 of the downloaded artifact (the `.bin` or the `.tar.gz`).
    pub sha256: Option<String>,
    /// Approximate download size, bytes.
    pub size_bytes: u64,
    /// Supported language codes; empty = all/auto (no restriction).
    pub languages: Vec<String>,
    /// 0.0–1.0 relative transcription accuracy (for UI bars).
    pub accuracy: f32,
    /// 0.0–1.0 relative speed (for UI bars).
    pub speed: f32,
    /// Whether the model can translate output to English (Whisper/Canary).
    pub supports_translation: bool,
    /// Whether the user can explicitly pick a language for this model.
    pub supports_language_selection: bool,
    /// Suggested default for new users.
    pub recommended: bool,
    /// Bundled with the app (offline default, no download).
    pub bundled: bool,
    /// Whether this model can stream live (partial) results as audio arrives,
    /// instead of only returning text after the full segment is transcribed.
    pub supports_streaming: bool,
    /// The finest timestamp granularity this model emits.
    pub timestamps: TimestampSupport,
    /// A superseded entry, kept only so a user who already downloaded it keeps
    /// working. The UI hides these unless they are present on disk, which
    /// deprecates them without breaking anyone (the same approach Handy took
    /// when it moved its catalog to GGUF).
    pub legacy: bool,
}

impl Default for ModelInfo {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: String::new(),
            url: None,
            sha256: None,
            size_bytes: 0,
            languages: Vec::new(),
            accuracy: 0.0,
            speed: 0.0,
            supports_translation: false,
            supports_language_selection: false,
            recommended: false,
            bundled: false,
            supports_streaming: false,
            timestamps: TimestampSupport::None,
            legacy: false,
        }
    }
}

/// Catalog entry plus runtime state, for the model-manager UI.
#[derive(Clone, Debug, Serialize)]
pub struct ModelStatus {
    #[serde(flatten)]
    pub info: ModelInfo,
    pub is_downloaded: bool,
    pub is_downloading: bool,
}

/// Progress event payload (`model-download-progress`).
#[derive(Clone, Debug, Serialize)]
struct DownloadProgress {
    model_id: String,
    downloaded: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

/// The built-in catalog.
///
/// The current set is **GGUF, loaded through `transcribe-cpp`, and downloaded
/// from the public `handy-computer` Hugging Face org** — one engine for every
/// model, GPU acceleration (Metal/Vulkan) on every model, and streaming plus
/// timestamps wherever the model supports them. Every entry carries the SHA-256
/// of its exact artifact (read from Hugging Face's LFS metadata, which stores the
/// file's sha256 as the blob oid), so downloads are integrity-verified.
///
/// `accuracy`/`speed` are Handy's measured benchmark scores rather than
/// hand-guessed values, normalised 0.0–1.0. They drive the comparison bars in
/// the model picker, so several previous estimates were materially misleading
/// (`whisper-base.en` was rated 0.50 against a measured 0.76; `gigaam-v3` 0.85
/// against a measured 0.69).
///
/// Entries below the GGUF set are `legacy: true`: the older ONNX tarballs and
/// `.bin` files hosted on `blob.handy.computer`. They are kept **only** so a user
/// who already downloaded one keeps working — `list_models` hides any legacy
/// entry that is not present on disk, which retires them without breaking
/// anyone. Nothing new should be added there, and the third-party CDN is no
/// longer on the path for a fresh install.
pub fn catalog() -> Vec<ModelInfo> {
    const MB: u64 = 1024 * 1024;
    let blob = |f: &str| Some(format!("https://blob.handy.computer/{}", f));
    let hf = |repo: &str, file: &str| {
        Some(format!(
            "https://huggingface.co/{}/resolve/main/{}",
            repo, file
        ))
    };
    let langs = |codes: &[&str]| codes.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let whisper_langs: Vec<String> = WHISPER_LANGUAGES.iter().map(|s| s.to_string()).collect();
    let eu25 = [
        "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt",
        "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
    ];

    vec![
        // ------------------------------------------------------------------
        // Current: GGUF via transcribe-cpp, from the handy-computer HF org.
        // Ordered roughly by how we want them presented: bundled default and
        // streaming options first, then batch/accuracy and language-specific.
        // ------------------------------------------------------------------
        ModelInfo {
            id: "moonshine-streaming-small".into(),
            name: "Moonshine Streaming Small (English)".into(),
            description: "Bundled offline default. Live English transcription — text appears as the speaker talks.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "moonshine-streaming-small-Q8_0.gguf".into(),
            url: hf("handy-computer/moonshine-streaming-small-gguf", "moonshine-streaming-small-Q8_0.gguf"),
            sha256: Some("d03670f69629b649085d0f44a63d97668b4119117cc9611a4e4ad94341713dfc".into()),
            size_bytes: 198506848,
            languages: langs(&["en"]),
            accuracy: 0.84,
            speed: 0.95,
            supports_streaming: true,
            timestamps: TimestampSupport::None,
            recommended: true,
            bundled: true,
            ..Default::default()
        },
        ModelInfo {
            id: "parakeet-unified-en-0.6b".into(),
            name: "Parakeet Unified (English, streaming)".into(),
            description: "Most accurate live English option, with token-level timing for verse alignment.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "parakeet-unified-en-0.6b-Q8_0.gguf".into(),
            url: hf("handy-computer/parakeet-unified-en-0.6b-gguf", "parakeet-unified-en-0.6b-Q8_0.gguf"),
            sha256: Some("4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795".into()),
            size_bytes: 731357568,
            languages: langs(&["en"]),
            accuracy: 0.90,
            speed: 0.79,
            supports_streaming: true,
            timestamps: TimestampSupport::Token,
            recommended: true,
            ..Default::default()
        },
        ModelInfo {
            id: "multitalker-parakeet-streaming".into(),
            name: "Multitalker Parakeet (English, streaming)".into(),
            description: "Fastest live option. Trained on overlapping speakers — good when the congregation responds.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "multitalker-parakeet-streaming-0.6b-v1-Q8_0.gguf".into(),
            url: hf("handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf", "multitalker-parakeet-streaming-0.6b-v1-Q8_0.gguf"),
            sha256: Some("4748deea0222eb9057ebdac1679eebb970bbe882ee10a96ae34596ffe83615c7".into()),
            size_bytes: 734123712,
            languages: langs(&["en"]),
            accuracy: 0.86,
            speed: 0.96,
            supports_streaming: true,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "nemotron-speech-streaming-en-0.6b".into(),
            name: "Nemotron Speech Streaming (English)".into(),
            description: "Live English transcription with token-level timing.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf".into(),
            url: hf("handy-computer/nemotron-speech-streaming-en-0.6b-gguf", "nemotron-speech-streaming-en-0.6b-Q8_0.gguf"),
            sha256: Some("90d8c89714cd31efc88be62a40c6b2bea57e0cc2063af1ffe2c28f1a228ca110".into()),
            size_bytes: 729650176,
            languages: langs(&["en"]),
            accuracy: 0.86,
            speed: 0.80,
            supports_streaming: true,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "nemotron-3.5-asr-streaming-0.6b".into(),
            name: "Nemotron Streaming 3.5 (multilingual, streaming)".into(),
            description: "Live multilingual transcription across 28 languages.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf".into(),
            url: hf("handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf", "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf"),
            sha256: Some("b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c".into()),
            size_bytes: 751094240,
            languages: langs(&["en", "es", "fr", "it", "pt", "nl", "de", "tr", "ru", "ar", "hi", "ja", "ko", "vi", "uk", "pl", "sv", "cs", "nb", "da", "bg", "fi", "hr", "sk", "zh", "hu", "ro", "et"]),
            accuracy: 0.82,
            speed: 0.84,
            supports_streaming: true,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "parakeet-ctc-0.6b".into(),
            name: "Parakeet CTC (English)".into(),
            description: "Best accuracy-per-second for English. Batch only — no live text.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "parakeet-ctc-0.6b-Q8_0.gguf".into(),
            url: hf("handy-computer/parakeet-ctc-0.6b-gguf", "parakeet-ctc-0.6b-Q8_0.gguf"),
            sha256: Some("e47ae86c1b34dbaf054334592575c29aee7de3546e75d1f0ccee05904c5c49ae".into()),
            size_bytes: 722271424,
            languages: langs(&["en"]),
            accuracy: 0.88,
            speed: 0.94,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "parakeet-tdt_ctc-110m".into(),
            name: "Parakeet Tiny (English)".into(),
            description: "Very small and very fast, with token-level timing. Batch only.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "parakeet-tdt_ctc-110m-Q8_0.gguf".into(),
            url: hf("handy-computer/parakeet-tdt_ctc-110m-gguf", "parakeet-tdt_ctc-110m-Q8_0.gguf"),
            sha256: Some("7dd44c74a331d788a4e5f8b16913b3feb29ced22cf5613aad0e0f6cd30516296".into()),
            size_bytes: 135373280,
            languages: langs(&["en"]),
            accuracy: 0.85,
            speed: 0.98,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "parakeet-tdt-0.6b-v3-gguf".into(),
            name: "Parakeet V3 (25 languages)".into(),
            description: "Accurate across 25 European languages with auto-detect.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "parakeet-tdt-0.6b-v3-Q8_0.gguf".into(),
            url: hf("handy-computer/parakeet-tdt-0.6b-v3-gguf", "parakeet-tdt-0.6b-v3-Q8_0.gguf"),
            sha256: Some("5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7".into()),
            size_bytes: 739508576,
            languages: langs(&eu25),
            accuracy: 0.88,
            speed: 0.79,
            supports_language_selection: true,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "moonshine-streaming-medium".into(),
            name: "Moonshine Streaming Medium (English)".into(),
            description: "Higher-accuracy live English transcription.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "moonshine-streaming-medium-Q8_0.gguf".into(),
            url: hf("handy-computer/moonshine-streaming-medium-gguf", "moonshine-streaming-medium-Q8_0.gguf"),
            sha256: Some("f7c9564249b508f6012927ec4f9e536087da53a7047f858ca9975bea5f75299e".into()),
            size_bytes: 295793568,
            languages: langs(&["en"]),
            accuracy: 0.87,
            speed: 0.83,
            supports_streaming: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "moonshine-base-gguf".into(),
            name: "Moonshine Base (English)".into(),
            description: "Tiny and extremely fast. Handles accents well. Batch only.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "moonshine-base-Q8_0.gguf".into(),
            url: hf("handy-computer/moonshine-base-gguf", "moonshine-base-Q8_0.gguf"),
            sha256: Some("7f0027dfd857d310b63a85ef57cadf183da712cc374f85a648f8bc18aaa2efc8".into()),
            size_bytes: 77476480,
            languages: langs(&["en"]),
            accuracy: 0.80,
            speed: 0.99,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "canary-180m-flash-gguf".into(),
            name: "Canary 180M Flash".into(),
            description: "Very fast. English, German, Spanish, French. Supports translation.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "canary-180m-flash-Q8_0.gguf".into(),
            url: hf("handy-computer/canary-180m-flash-gguf", "canary-180m-flash-Q8_0.gguf"),
            sha256: Some("e13c7f5d0952b056a027cfffec13e3a3a134d1608babed24f983568f141e297c".into()),
            size_bytes: 218447552,
            languages: langs(&["en", "de", "es", "fr"]),
            accuracy: 0.88,
            speed: 0.98,
            supports_translation: true,
            supports_language_selection: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "canary-1b-flash".into(),
            name: "Canary 1B Flash".into(),
            description: "High accuracy across English, German, Spanish, French. Supports translation.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "canary-1b-flash-Q5_K_M.gguf".into(),
            url: hf("handy-computer/canary-1b-flash-gguf", "canary-1b-flash-Q5_K_M.gguf"),
            sha256: Some("7eed3cac92f255a4adbd518c58663d3fbf65984d2619189e593f2d374b05c601".into()),
            size_bytes: 769563424,
            languages: langs(&["en", "de", "es", "fr"]),
            accuracy: 0.90,
            speed: 0.83,
            supports_translation: true,
            supports_language_selection: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "qwen3-asr-0.6b".into(),
            name: "Qwen3 ASR (30 languages)".into(),
            description: "Strong multilingual accuracy across 30 languages.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "Qwen3-ASR-0.6B-Q8_0.gguf".into(),
            url: hf("handy-computer/Qwen3-ASR-0.6B-gguf", "Qwen3-ASR-0.6B-Q8_0.gguf"),
            sha256: Some("f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8".into()),
            size_bytes: 850423456,
            languages: langs(&["zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "ro", "hu", "mk"]),
            accuracy: 0.87,
            speed: 0.63,
            supports_language_selection: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "cohere-transcribe-2026".into(),
            name: "Cohere Transcribe".into(),
            description: "Highest accuracy in the catalog. 14 languages, large and slower.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "cohere-transcribe-03-2026-Q5_K_M.gguf".into(),
            url: hf("handy-computer/cohere-transcribe-03-2026-gguf", "cohere-transcribe-03-2026-Q5_K_M.gguf"),
            sha256: Some("14d02f1ad6dd77b3a60f82639879012c3adb4fe25c50a5a47a2c4c661daf1558".into()),
            size_bytes: 1770270208,
            languages: langs(&["en", "fr", "de", "es", "it", "pt", "nl", "pl", "el", "ar", "ja", "zh", "vi", "ko"]),
            accuracy: 0.92,
            speed: 0.63,
            supports_language_selection: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "whisper-small".into(),
            name: "Whisper Small".into(),
            description: "Fast and fairly accurate. 99 languages with translation.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "whisper-small-Q8_0.gguf".into(),
            url: hf("handy-computer/whisper-small-gguf", "whisper-small-Q8_0.gguf"),
            sha256: Some("9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860".into()),
            size_bytes: 269751136,
            languages: whisper_langs.clone(),
            accuracy: 0.80,
            speed: 0.78,
            supports_translation: true,
            supports_language_selection: true,
            timestamps: TimestampSupport::Segment,
            ..Default::default()
        },
        ModelInfo {
            id: "whisper-medium".into(),
            name: "Whisper Medium".into(),
            description: "Good accuracy, medium speed. 99 languages with translation.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "whisper-medium-Q8_0.gguf".into(),
            url: hf("handy-computer/whisper-medium-gguf", "whisper-medium-Q8_0.gguf"),
            sha256: Some("09e6a65e7de377aa5b10bae24608bc6f8ca2ed04b3993ef10d4a02bcd9a82adf".into()),
            size_bytes: 831538144,
            languages: whisper_langs.clone(),
            accuracy: 0.84,
            speed: 0.42,
            supports_translation: true,
            supports_language_selection: true,
            timestamps: TimestampSupport::Segment,
            ..Default::default()
        },
        ModelInfo {
            id: "whisper-large-v3-turbo".into(),
            name: "Whisper Large v3 Turbo".into(),
            description: "High accuracy across 99 languages. Slower.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "whisper-large-v3-turbo-Q8_0.gguf".into(),
            url: hf("handy-computer/whisper-large-v3-turbo-gguf", "whisper-large-v3-turbo-Q8_0.gguf"),
            sha256: Some("b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183".into()),
            size_bytes: 886381760,
            languages: whisper_langs.clone(),
            accuracy: 0.87,
            speed: 0.35,
            supports_language_selection: true,
            timestamps: TimestampSupport::Segment,
            ..Default::default()
        },
        ModelInfo {
            id: "moss-transcribe-diarize".into(),
            name: "MOSS Transcribe + Diarize".into(),
            description: "Labels who spoke when. Too slow for live use — best for reviewing a recording afterwards.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "MOSS-Transcribe-Diarize-Q8_0.gguf".into(),
            url: hf("handy-computer/moss-transcribe-diarize-gguf", "MOSS-Transcribe-Diarize-Q8_0.gguf"),
            sha256: Some("64ec654dc6ffcfdfe180422dffce1d33422b0c30959b7edfd131bad77ee35039".into()),
            size_bytes: 986899616,
            languages: langs(&["en", "zh"]),
            accuracy: 0.88,
            speed: 0.31,
            timestamps: TimestampSupport::Segment,
            ..Default::default()
        },
        ModelInfo {
            id: "sense-voice-small".into(),
            name: "SenseVoice".into(),
            description: "Very fast. Chinese, Cantonese, English, Japanese, Korean.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "SenseVoiceSmall-Q8_0.gguf".into(),
            url: hf("handy-computer/SenseVoiceSmall-gguf", "SenseVoiceSmall-Q8_0.gguf"),
            sha256: Some("6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29".into()),
            size_bytes: 252684608,
            languages: langs(&["zh", "yue", "en", "ja", "ko"]),
            accuracy: 0.81,
            speed: 0.98,
            supports_language_selection: true,
            timestamps: TimestampSupport::None,
            ..Default::default()
        },
        ModelInfo {
            id: "gigaam-v3-e2e-ctc-gguf".into(),
            name: "GigaAM v3 (Russian)".into(),
            description: "Russian speech recognition. Very fast.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "gigaam-v3-e2e-ctc-Q8_0.gguf".into(),
            url: hf("handy-computer/gigaam-v3-e2e-ctc-gguf", "gigaam-v3-e2e-ctc-Q8_0.gguf"),
            sha256: Some("9ccce4750dc813a493d96ca15ee251712bedec15ac9a02fa3d2bd732f08ae5eb".into()),
            size_bytes: 272151136,
            languages: langs(&["ru"]),
            accuracy: 0.69,
            speed: 0.98,
            timestamps: TimestampSupport::Token,
            ..Default::default()
        },
        ModelInfo {
            id: "breeze-asr-25".into(),
            name: "Breeze ASR 25".into(),
            description: "Optimized for Taiwanese Mandarin with code-switching.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "Breeze-ASR-25-Q5_K_M.gguf".into(),
            url: hf("handy-computer/Breeze-ASR-25-gguf", "Breeze-ASR-25-Q5_K_M.gguf"),
            sha256: Some("c871fc811b33a16a5607c4d4166cfa2c0a1d359f7796e3da255e3e922f59139b".into()),
            size_bytes: 1160366080,
            languages: langs(&["zh", "en"]),
            accuracy: 0.86,
            speed: 0.23,
            supports_translation: true,
            supports_language_selection: true,
            timestamps: TimestampSupport::Segment,
            ..Default::default()
        },

        // ------------------------------------------------------------------
        // Legacy: superseded ONNX tarballs / `.bin` files on
        // blob.handy.computer. Retained so existing downloads keep working;
        // hidden by `list_models` unless present on disk. Do not extend.
        // ------------------------------------------------------------------
        ModelInfo {
            id: "whisper-base.en".into(),
            name: "Whisper Base (English)".into(),
            description: "Previous bundled default. English only, superseded by newer models.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "ggml-base.en.bin".into(),
            url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".into()),
            size_bytes: 142 * MB,
            languages: langs(&["en"]),
            accuracy: 0.76,
            speed: 0.99,
            legacy: true,
            ..Default::default()
        },
        // --- Whisper (GGUF) ---
        ModelInfo {
            id: "small".into(), name: "Whisper Small".into(),
            description: "Fast and fairly accurate.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "ggml-small.bin".into(), url: blob("ggml-small.bin"),
            sha256: Some("1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b".into()),
            size_bytes: 465 * MB, languages: whisper_langs.clone(),
            accuracy: 0.60, speed: 0.85, supports_translation: true, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "medium".into(), name: "Whisper Medium".into(),
            description: "Good accuracy, medium speed.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "whisper-medium-q4_1.bin".into(), url: blob("whisper-medium-q4_1.bin"),
            sha256: Some("79283fc1f9fe12ca3248543fbd54b73292164d8df5a16e095e2bceeaaabddf57".into()),
            size_bytes: 469 * MB, languages: whisper_langs.clone(),
            accuracy: 0.75, speed: 0.60, supports_translation: true, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "turbo".into(), name: "Whisper Turbo".into(),
            description: "Balanced accuracy and speed.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "ggml-large-v3-turbo.bin".into(), url: blob("ggml-large-v3-turbo.bin"),
            sha256: Some("1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69".into()),
            size_bytes: 1549 * MB, languages: whisper_langs.clone(),
            accuracy: 0.80, speed: 0.40, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "large".into(), name: "Whisper Large".into(),
            description: "Good accuracy, but slow.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "ggml-large-v3-q5_0.bin".into(), url: blob("ggml-large-v3-q5_0.bin"),
            sha256: Some("d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1".into()),
            size_bytes: 1031 * MB, languages: whisper_langs.clone(),
            accuracy: 0.85, speed: 0.30, supports_translation: true, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "breeze-asr".into(), name: "Breeze ASR".into(),
            description: "Optimized for Taiwanese Mandarin. Code-switching support.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "breeze-asr-q5_k.bin".into(), url: blob("breeze-asr-q5_k.bin"),
            sha256: Some("8efbf0ce8a3f50fe332b7617da787fb81354b358c288b008d3bdef8359df64c6".into()),
            size_bytes: 1030 * MB, languages: whisper_langs.clone(),
            accuracy: 0.85, speed: 0.35, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        // --- Streaming GGUF (transcribe-cpp), sourced from Hugging Face ---
        // Unlike the rest of the catalog, these download directly from the
        // public `handy-computer` HF org rather than blob.handy.computer —
        // that's genuinely where these new models are hosted, not a mirroring
        // choice. See models.rs module docs for the rest of the catalog's
        // CDN situation.
        ModelInfo {
            id: "parakeet-tdt-0.6b-v2".into(), name: "Parakeet V2".into(),
            description: "English only. The best model for English speakers.".into(),
            engine_type: EngineType::Parakeet, format: ModelFormat::Directory,
            filename: "parakeet-tdt-0.6b-v2-int8".into(), url: blob("parakeet-v2-int8.tar.gz"),
            sha256: Some("ac9b9429984dd565b25097337a887bb7f0f8ac393573661c651f0e7d31563991".into()),
            size_bytes: 451 * MB, languages: langs(&["en"]),
            accuracy: 0.85, speed: 0.85,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "parakeet-tdt-0.6b-v3".into(), name: "Parakeet V3 (auto-language)".into(),
            description: "Fast and accurate. 25 European languages, auto-detect.".into(),
            engine_type: EngineType::Parakeet, format: ModelFormat::Directory,
            filename: "parakeet-tdt-0.6b-v3-int8".into(), url: blob("parakeet-v3-int8.tar.gz"),
            sha256: Some("43d37191602727524a7d8c6da0eef11c4ba24320f5b4730f1a2497befc2efa77".into()),
            size_bytes: 456 * MB, languages: langs(&eu25),
            accuracy: 0.80, speed: 0.85, recommended: true,
            legacy: true,
            ..Default::default()
        },
        // --- Moonshine (ONNX) ---
        ModelInfo {
            id: "moonshine-base".into(), name: "Moonshine Base".into(),
            description: "Very fast, English only. Handles accents well.".into(),
            engine_type: EngineType::Moonshine, format: ModelFormat::Directory,
            filename: "moonshine-base".into(), url: blob("moonshine-base.tar.gz"),
            sha256: Some("04bf6ab012cfceebd4ac7cf88c1b31d027bbdd3cd704649b692e2e935236b7e8".into()),
            size_bytes: 55 * MB, languages: langs(&["en"]),
            accuracy: 0.70, speed: 0.90,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "moonshine-tiny-streaming-en".into(), name: "Moonshine V2 Tiny".into(),
            description: "Ultra-fast, English only.".into(),
            engine_type: EngineType::MoonshineStreaming, format: ModelFormat::Directory,
            filename: "moonshine-tiny-streaming-en".into(), url: blob("moonshine-tiny-streaming-en.tar.gz"),
            sha256: Some("465addcfca9e86117415677dfdc98b21edc53537210333a3ecdb58509a80abaf".into()),
            size_bytes: 31 * MB, languages: langs(&["en"]),
            accuracy: 0.55, speed: 0.95,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "moonshine-small-streaming-en".into(), name: "Moonshine V2 Small".into(),
            description: "Fast, English only. Good balance of speed and accuracy.".into(),
            engine_type: EngineType::MoonshineStreaming, format: ModelFormat::Directory,
            filename: "moonshine-small-streaming-en".into(), url: blob("moonshine-small-streaming-en.tar.gz"),
            sha256: Some("dbb3e1c1832bd88a4ac712f7449a136cc2c9a18c5fe33a12ed1b7cb1cfe9cdd5".into()),
            size_bytes: 99 * MB, languages: langs(&["en"]),
            accuracy: 0.65, speed: 0.90,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "moonshine-medium-streaming-en".into(), name: "Moonshine V2 Medium".into(),
            description: "English only. High quality.".into(),
            engine_type: EngineType::MoonshineStreaming, format: ModelFormat::Directory,
            filename: "moonshine-medium-streaming-en".into(), url: blob("moonshine-medium-streaming-en.tar.gz"),
            sha256: Some("07a66f3bff1c77e75a2f637e5a263928a08baae3c29c4c053fc968a9a9373d13".into()),
            size_bytes: 192 * MB, languages: langs(&["en"]),
            accuracy: 0.75, speed: 0.80,
            legacy: true,
            ..Default::default()
        },
        // --- SenseVoice (ONNX) ---
        ModelInfo {
            id: "sense-voice-int8".into(), name: "SenseVoice".into(),
            description: "Very fast. Chinese, English, Japanese, Korean, Cantonese.".into(),
            engine_type: EngineType::SenseVoice, format: ModelFormat::Directory,
            filename: "sense-voice-int8".into(), url: blob("sense-voice-int8.tar.gz"),
            sha256: Some("171d611fe5d353a50bbb741b6f3ef42559b1565685684e9aa888ef563ba3e8a4".into()),
            size_bytes: 152 * MB, languages: langs(&["zh", "zh-Hans", "zh-Hant", "en", "yue", "ja", "ko"]),
            accuracy: 0.65, speed: 0.95, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        // --- GigaAM (ONNX, Russian) ---
        ModelInfo {
            id: "gigaam-v3-e2e-ctc".into(), name: "GigaAM v3 (Russian)".into(),
            description: "Russian speech recognition. Fast and accurate.".into(),
            engine_type: EngineType::GigaAM, format: ModelFormat::Directory,
            filename: "giga-am-v3-int8".into(), url: blob("giga-am-v3-int8.tar.gz"),
            sha256: Some("d872462268430db140b69b72e0fc4b787b194c1dbe51b58de39444d55b6da45b".into()),
            size_bytes: 151 * MB, languages: langs(&["ru"]),
            accuracy: 0.85, speed: 0.75,
            legacy: true,
            ..Default::default()
        },
        // --- Canary (ONNX) ---
        ModelInfo {
            id: "canary-180m-flash".into(), name: "Canary 180M Flash".into(),
            description: "Very fast. English, German, Spanish, French. Supports translation.".into(),
            engine_type: EngineType::Canary, format: ModelFormat::Directory,
            filename: "canary-180m-flash".into(), url: blob("canary-180m-flash.tar.gz"),
            sha256: Some("6d9cfca6118b296e196eaedc1c8fa9788305a7b0f1feafdb6dc91932ab6e53f7".into()),
            size_bytes: 146 * MB, languages: langs(&["en", "de", "es", "fr"]),
            accuracy: 0.75, speed: 0.85, supports_translation: true, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        ModelInfo {
            id: "canary-1b-v2".into(), name: "Canary 1B v2".into(),
            description: "Accurate multilingual. 25 European languages. Supports translation.".into(),
            engine_type: EngineType::Canary, format: ModelFormat::Directory,
            filename: "canary-1b-v2".into(), url: blob("canary-1b-v2.tar.gz"),
            sha256: Some("02305b2a25f9cf3e7deaffa7f94df00efa44f442cd55c101c2cb9c000f904666".into()),
            size_bytes: 691 * MB, languages: langs(&eu25),
            accuracy: 0.85, speed: 0.70, supports_translation: true, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
        // --- Cohere (ONNX, large multilingual) ---
        ModelInfo {
            id: "cohere-int8".into(), name: "Cohere".into(),
            description: "A large, slower, but very accurate multilingual model.".into(),
            engine_type: EngineType::Cohere, format: ModelFormat::Directory,
            filename: "cohere-int8".into(), url: blob("cohere-int8.tar.gz"),
            sha256: Some("ea2257d52434f3644574f187dcdcf666e302cd11b92866116ab8e14cd9c887f0".into()),
            size_bytes: 1708 * MB,
            languages: langs(&["en", "fr", "de", "it", "es", "pt", "el", "nl", "pl", "zh", "zh-Hans", "zh-Hant", "ja", "ko", "vi", "ar"]),
            accuracy: 0.90, speed: 0.60, supports_language_selection: true,
            legacy: true,
            ..Default::default()
        },
    ]
}

/// Whisper's 99 supported language codes (incl. zh-Hans/zh-Hant frontend variants).
const WHISPER_LANGUAGES: &[&str] = &[
    "en", "zh", "zh-Hans", "zh-Hant", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca",
    "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu",
    "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn",
    "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
    "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am",
    "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as",
    "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
];

pub struct ModelManager {
    models_dir: PathBuf,
    catalog: Vec<ModelInfo>,
    downloading: Arc<Mutex<HashSet<String>>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

/// RAII cleanup: clears the downloading flag + cancel flag for a model on every
/// exit path of a download (success, error, or cancel).
struct DownloadCleanup {
    model_id: String,
    downloading: Arc<Mutex<HashSet<String>>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl Drop for DownloadCleanup {
    fn drop(&mut self) {
        if let Ok(mut d) = self.downloading.lock() {
            d.remove(&self.model_id);
        }
        if let Ok(mut c) = self.cancel_flags.lock() {
            c.remove(&self.model_id);
        }
    }
}

impl ModelManager {
    pub fn new(models_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&models_dir);
        Self {
            models_dir,
            catalog: catalog(),
            downloading: Arc::new(Mutex::new(HashSet::new())),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_model_info(&self, id: &str) -> Option<ModelInfo> {
        self.catalog.iter().find(|m| m.id == id).cloned()
    }

    /// Copy bundled model files (shipped as Tauri resources) into the models
    /// dir on first run, so the offline default works without a download.
    /// Only file-format bundled models are seeded (the default `base.en` GGUF).
    pub fn seed_bundled(&self, bundled_dir: &Path) {
        if !bundled_dir.is_dir() {
            return;
        }
        for info in &self.catalog {
            if !info.bundled || info.format != ModelFormat::File {
                continue;
            }
            let src = bundled_dir.join(&info.filename);
            let dest = self.models_dir.join(&info.filename);
            if src.exists() && !dest.exists() {
                match fs::copy(&src, &dest) {
                    Ok(_) => info!("[models] seeded bundled model {}", info.id),
                    Err(e) => warn!("[models] failed to seed {}: {}", info.id, e),
                }
            }
        }
    }

    /// Resolved path the engine loads: the `.bin` file or the extracted directory.
    pub fn model_path(&self, id: &str) -> Option<PathBuf> {
        self.get_model_info(id).map(|info| self.models_dir.join(&info.filename))
    }

    pub fn is_downloaded(&self, id: &str) -> bool {
        match self.get_model_info(id) {
            Some(info) => {
                let path = self.models_dir.join(&info.filename);
                match info.format {
                    ModelFormat::File => path.is_file(),
                    ModelFormat::Directory => path.is_dir(),
                }
            }
            None => false,
        }
    }

    /// Delete a downloaded model from disk. The bundled model cannot be deleted.
    pub fn delete_model(&self, id: &str) -> Result<(), String> {
        let info = self
            .get_model_info(id)
            .ok_or_else(|| format!("Unknown model: {}", id))?;
        if info.bundled {
            return Err("The bundled model cannot be deleted".to_string());
        }
        let path = self.models_dir.join(&info.filename);
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else if path.is_file() {
            fs::remove_file(&path)
        } else {
            return Ok(());
        };
        result.map_err(|e| format!("Failed to delete {}: {}", id, e))
    }

    fn is_downloading(&self, id: &str) -> bool {
        self.downloading.lock().map(|d| d.contains(id)).unwrap_or(false)
    }

    /// Catalog entries for the model-manager UI.
    ///
    /// Legacy entries (superseded ONNX/CDN models) are filtered out unless they
    /// are actually present on disk: a user who already downloaded one still
    /// sees and can use it, while a fresh install is never offered a retired
    /// model. This deprecates them without a breaking removal.
    pub fn list_models(&self) -> Vec<ModelStatus> {
        self.catalog
            .iter()
            .filter_map(|info| {
                let is_downloaded = self.is_downloaded(&info.id);
                if info.legacy && !is_downloaded {
                    return None;
                }
                Some(ModelStatus {
                    info: info.clone(),
                    is_downloaded,
                    is_downloading: self.is_downloading(&info.id),
                })
            })
            .collect()
    }

    /// Signal a cancel for an in-flight download.
    pub fn cancel_download(&self, id: &str) {
        if let Ok(flags) = self.cancel_flags.lock() {
            if let Some(flag) = flags.get(id) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Download (and, for Parakeet, extract) a model. Resumable + verified.
    pub async fn download_model(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let info = self
            .get_model_info(id)
            .ok_or_else(|| format!("Unknown model: {}", id))?;
        let url = info
            .url
            .clone()
            .ok_or_else(|| format!("Model {} has no download URL", id))?;

        if self.is_downloaded(id) {
            return Ok(());
        }

        // Register as downloading (reject duplicates) + arm cancel flag.
        let cancel = {
            let mut downloading = self.downloading.lock().map_err(|_| "lock poisoned")?;
            if downloading.contains(id) {
                return Err("Download already in progress".to_string());
            }
            downloading.insert(id.to_string());
            let flag = Arc::new(AtomicBool::new(false));
            self.cancel_flags
                .lock()
                .map_err(|_| "lock poisoned")?
                .insert(id.to_string(), flag.clone());
            flag
        };
        let _cleanup = DownloadCleanup {
            model_id: id.to_string(),
            downloading: self.downloading.clone(),
            cancel_flags: self.cancel_flags.clone(),
        };

        // The download target: the file itself, or a temp tarball for directory models.
        let download_target = match info.format {
            ModelFormat::File => self.models_dir.join(&info.filename),
            ModelFormat::Directory => self.models_dir.join(format!("{}.tar.gz", info.filename)),
        };
        let partial = self.models_dir.join(format!("{}.partial", info.filename));

        let result = self
            .download_to(&url, &partial, &cancel, app, id, info.size_bytes)
            .await;

        if let Err(e) = result {
            self.emit_progress(app, id, 0, None, false, Some(e.clone()));
            return Err(e);
        }

        // Verify checksum if we have one.
        if let Some(expected) = &info.sha256 {
            match sha256_file(&partial) {
                Ok(actual) if actual.eq_ignore_ascii_case(expected) => {}
                Ok(actual) => {
                    let _ = fs::remove_file(&partial);
                    let msg = format!("Checksum mismatch (expected {}, got {})", expected, actual);
                    self.emit_progress(app, id, 0, None, false, Some(msg.clone()));
                    return Err(msg);
                }
                Err(e) => warn!("[models] could not hash {}: {}", id, e),
            }
        }

        // Finalize: move into place (File) or extract (Directory).
        match info.format {
            ModelFormat::File => {
                fs::rename(&partial, &download_target)
                    .map_err(|e| format!("Failed to finalize download: {}", e))?;
            }
            ModelFormat::Directory => {
                fs::rename(&partial, &download_target)
                    .map_err(|e| format!("Failed to finalize archive: {}", e))?;
                let dest = self.models_dir.join(&info.filename);
                extract_tar_gz(&download_target, &self.models_dir)
                    .map_err(|e| format!("Failed to extract {}: {}", id, e))?;
                let _ = fs::remove_file(&download_target);
                if !dest.is_dir() {
                    return Err(format!(
                        "Archive extracted but expected directory {} not found",
                        dest.display()
                    ));
                }
            }
        }

        self.emit_progress(app, id, info.size_bytes, Some(info.size_bytes), true, None);
        info!("[models] downloaded {}", id);
        Ok(())
    }

    /// Stream the URL into `partial`, resuming if a partial file already exists.
    async fn download_to(
        &self,
        url: &str,
        partial: &Path,
        cancel: &Arc<AtomicBool>,
        app: &AppHandle,
        model_id: &str,
        size_hint: u64,
    ) -> Result<(), String> {
        use reqwest::header::{CONTENT_RANGE, RANGE};

        let mut downloaded = fs::metadata(partial).map(|m| m.len()).unwrap_or(0);

        let client = reqwest::Client::new();
        let mut req = client.get(url);
        if downloaded > 0 {
            req = req.header(RANGE, format!("bytes={}-", downloaded));
        }
        let mut resp = req.send().await.map_err(|e| format!("Request failed: {}", e))?;

        // If we asked to resume but the server replied 200 (not 206), it ignored
        // the Range header — restart from scratch to avoid a corrupt concatenation.
        if downloaded > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            let _ = resp.headers().get(CONTENT_RANGE); // (diagnostic only)
            let _ = fs::remove_file(partial);
            downloaded = 0;
        }
        if !resp.status().is_success() {
            return Err(format!("Server returned {}", resp.status()));
        }

        let total = resp
            .content_length()
            .map(|len| len + downloaded)
            .or(if size_hint > 0 { Some(size_hint) } else { None });

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(downloaded > 0)
            .write(true)
            .open(partial)
            .map_err(|e| format!("Cannot open partial file: {}", e))?;

        let mut last_emit = Instant::now();
        let mut since_emit: u64 = 0;

        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("Download cancelled".to_string());
            }
            let chunk = resp
                .chunk()
                .await
                .map_err(|e| format!("Stream error: {}", e))?;
            let Some(bytes) = chunk else { break };
            file.write_all(&bytes).map_err(|e| format!("Write error: {}", e))?;
            downloaded += bytes.len() as u64;
            since_emit += bytes.len() as u64;

            // Throttle progress to ~4/sec or every 4 MB.
            if since_emit >= 4 * 1024 * 1024 || last_emit.elapsed().as_millis() >= 250 {
                self.emit_progress(app, model_id, downloaded, total, false, None);
                last_emit = Instant::now();
                since_emit = 0;
            }
        }

        file.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    fn emit_progress(
        &self,
        app: &AppHandle,
        model_id: &str,
        downloaded: u64,
        total: Option<u64>,
        done: bool,
        error: Option<String>,
    ) {
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress {
                model_id: model_id.to_string(),
                downloaded,
                total,
                done,
                error,
            },
        );
    }
}

/// Compute the SHA-256 of a file, streaming to avoid loading it all in memory.
fn sha256_file(path: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Extract a `.tar.gz` archive into `dest_dir`.
fn extract_tar_gz(archive: &Path, dest_dir: &Path) -> std::io::Result<()> {
    use flate2::read::GzDecoder;
    use tar::Archive;
    let file = fs::File::open(archive)?;
    let gz = GzDecoder::new(file);
    let mut tar = Archive::new(gz);
    tar.unpack(dest_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Ids are the key used by settings, the engine and the frontend, so a
    /// duplicate would make `get_model_info` silently resolve to whichever came
    /// first. This is the guard that caught the ONNX→GGUF id collisions during
    /// the migration (`moonshine-base`, `canary-180m-flash`, `gigaam-v3-e2e-ctc`,
    /// `parakeet-tdt-0.6b-v3`).
    #[test]
    fn catalog_ids_are_unique() {
        let mut seen = HashSet::new();
        for m in catalog() {
            assert!(seen.insert(m.id.clone()), "duplicate catalog id: {}", m.id);
        }
    }

    /// Two files landing on the same on-disk name would have each download
    /// overwrite the other, and `is_downloaded` would report the wrong model.
    #[test]
    fn catalog_filenames_are_unique() {
        let mut seen = HashSet::new();
        for m in catalog() {
            assert!(
                seen.insert(m.filename.clone()),
                "duplicate filename {} (model {})",
                m.filename,
                m.id
            );
        }
    }

    /// Exactly one bundled model — it is the offline default and what a stale or
    /// missing selection falls back to.
    #[test]
    fn exactly_one_bundled_model() {
        let bundled: Vec<_> = catalog().into_iter().filter(|m| m.bundled).collect();
        assert_eq!(
            bundled.len(),
            1,
            "expected 1 bundled model, got {:?}",
            bundled.iter().map(|m| &m.id).collect::<Vec<_>>()
        );
        // The bundled model must work with zero network access.
        assert!(!bundled[0].legacy, "bundled model must not be legacy");
    }

    /// The whole point of the GGUF migration: a fresh install must never be
    /// offered a `blob.handy.computer` artifact. Legacy entries may still carry
    /// those URLs, but they are hidden unless already on disk.
    #[test]
    fn non_legacy_models_do_not_use_the_third_party_cdn() {
        for m in catalog().into_iter().filter(|m| !m.legacy) {
            let url = m.url.clone().unwrap_or_default();
            assert!(
                !url.contains("blob.handy.computer"),
                "non-legacy model {} still points at the retired CDN",
                m.id
            );
        }
    }

    /// Downloads are verified, so a missing hash would silently skip
    /// verification for that model.
    #[test]
    fn current_models_are_hash_pinned() {
        for m in catalog().into_iter().filter(|m| !m.legacy) {
            assert!(
                m.sha256.as_deref().is_some_and(|h| h.len() == 64),
                "model {} has no valid sha256",
                m.id
            );
            assert!(m.size_bytes > 0, "model {} has no size", m.id);
        }
    }

    /// UI bars read these directly; an out-of-range value would render wrong.
    #[test]
    fn scores_are_normalised() {
        for m in catalog() {
            assert!(
                (0.0..=1.0).contains(&m.accuracy),
                "{} accuracy {}",
                m.id,
                m.accuracy
            );
            assert!((0.0..=1.0).contains(&m.speed), "{} speed {}", m.id, m.speed);
        }
    }

    /// Streaming is only implemented for transcribe-cpp sessions (the engine
    /// gates on the loaded model's own capabilities), so advertising a streaming
    /// ONNX model in the catalog would promise live text we cannot deliver.
    #[test]
    fn only_transcribe_cpp_models_advertise_streaming() {
        for m in catalog().into_iter().filter(|m| m.supports_streaming) {
            assert_eq!(
                m.engine_type,
                EngineType::TranscribeCpp,
                "{} advertises streaming but is not a transcribe-cpp model",
                m.id
            );
        }
    }

    /// Legacy entries exist purely for continuity; every one of them must still
    /// be resolvable by id so an existing setting keeps working.
    #[test]
    fn legacy_ids_from_the_pre_gguf_catalog_are_still_resolvable() {
        // The exact ids the catalog shipped before the GGUF migration.
        const PRE_GGUF_IDS: &[&str] = &[
            "whisper-base.en",
            "small",
            "medium",
            "turbo",
            "large",
            "breeze-asr",
            "parakeet-unified-en-0.6b",
            "nemotron-3.5-asr-streaming-0.6b",
            "parakeet-tdt-0.6b-v2",
            "parakeet-tdt-0.6b-v3",
            "moonshine-base",
            "moonshine-tiny-streaming-en",
            "moonshine-small-streaming-en",
            "moonshine-medium-streaming-en",
            "sense-voice-int8",
            "gigaam-v3-e2e-ctc",
            "canary-180m-flash",
            "canary-1b-v2",
            "cohere-int8",
        ];
        let ids: HashSet<String> = catalog().into_iter().map(|m| m.id).collect();
        for id in PRE_GGUF_IDS {
            assert!(
                ids.contains(*id),
                "id {} disappeared from the catalog; an existing user's saved \
                 model selection would stop resolving",
                id
            );
        }
    }
}
