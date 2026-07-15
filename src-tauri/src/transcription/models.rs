//! Transcription model catalog + downloader.
//!
//! Engine-agnostic and free of `transcribe-rs`, so it compiles and is testable
//! on the default build. Whisper models are GGUF `.bin` files (whisper.cpp);
//! Parakeet ships as a gzipped tarball that extracts to a directory of ONNX
//! files. Downloads are resumable (HTTP Range), optionally SHA-256-verified,
//! and report progress via the `model-download-progress` Tauri event.
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
/// The bundled `whisper-base.en` GGUF (public whisper.cpp HF repo) is the
/// offline default. Most other models download on demand from Handy's own
/// CDN (`blob.handy.computer`) — the exact GGUF / int8-ONNX artifacts
/// `transcribe-rs`/`transcribe-cpp` expect, with pinned SHA-256 hashes.
///
/// NOTE: those `blob.handy.computer` URLs are a pre-existing TODO — mirror
/// the artifacts to Selah-controlled storage before production; the hashes
/// are host-independent. The streaming GGUF entries (Parakeet Unified,
/// Nemotron Streaming) are the exception: they're genuinely hosted on the
/// public `handy-computer` Hugging Face org, so those download straight from
/// HF and have no CDN migration to do.
pub fn catalog() -> Vec<ModelInfo> {
    const MB: u64 = 1024 * 1024;
    let blob = |f: &str| Some(format!("https://blob.handy.computer/{}", f));
    let langs = |codes: &[&str]| codes.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let whisper_langs: Vec<String> = WHISPER_LANGUAGES.iter().map(|s| s.to_string()).collect();
    let eu25 = [
        "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt",
        "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
    ];

    vec![
        // Bundled offline default (GGUF from HF; copied in by seed_bundled).
        ModelInfo {
            id: "whisper-base.en".into(),
            name: "Whisper Base (English)".into(),
            description: "Bundled offline default. Solid speed/accuracy for English.".into(),
            engine_type: EngineType::TranscribeCpp,
            format: ModelFormat::File,
            filename: "ggml-base.en.bin".into(),
            url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin".into()),
            size_bytes: 142 * MB,
            languages: langs(&["en"]),
            accuracy: 0.50,
            speed: 0.90,
            bundled: true,
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
            ..Default::default()
        },
        // --- Streaming GGUF (transcribe-cpp), sourced from Hugging Face ---
        // Unlike the rest of the catalog, these download directly from the
        // public `handy-computer` HF org rather than blob.handy.computer —
        // that's genuinely where these new models are hosted, not a mirroring
        // choice. See models.rs module docs for the rest of the catalog's
        // CDN situation.
        ModelInfo {
            id: "parakeet-unified-en-0.6b".into(), name: "Parakeet Unified (English, streaming)".into(),
            description: "Fast, accurate live English transcription. See text as you speak.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "parakeet-unified-en-0.6b-Q8_0.gguf".into(),
            url: Some("https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/parakeet-unified-en-0.6b-Q8_0.gguf".into()),
            size_bytes: 731_357_568, languages: langs(&["en"]),
            accuracy: 0.90, speed: 0.79, supports_streaming: true, recommended: true,
            ..Default::default()
        },
        ModelInfo {
            id: "nemotron-3.5-asr-streaming-0.6b".into(), name: "Nemotron Streaming 3.5 (multilingual, streaming)".into(),
            description: "Live multilingual transcription across 28 languages.".into(),
            engine_type: EngineType::TranscribeCpp, format: ModelFormat::File,
            filename: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf".into(),
            url: Some("https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf".into()),
            size_bytes: 751_094_240,
            languages: langs(&[
                "en", "es", "fr", "it", "pt", "nl", "de", "tr", "ru", "ar", "hi", "ja", "ko", "vi",
                "uk", "pl", "sv", "cs", "nb", "da", "bg", "fi", "hr", "sk", "zh", "hu", "ro", "et",
            ]),
            accuracy: 0.82, speed: 0.84, supports_streaming: true,
            ..Default::default()
        },
        // --- Parakeet (ONNX) ---
        ModelInfo {
            id: "parakeet-tdt-0.6b-v2".into(), name: "Parakeet V2".into(),
            description: "English only. The best model for English speakers.".into(),
            engine_type: EngineType::Parakeet, format: ModelFormat::Directory,
            filename: "parakeet-tdt-0.6b-v2-int8".into(), url: blob("parakeet-v2-int8.tar.gz"),
            sha256: Some("ac9b9429984dd565b25097337a887bb7f0f8ac393573661c651f0e7d31563991".into()),
            size_bytes: 451 * MB, languages: langs(&["en"]),
            accuracy: 0.85, speed: 0.85,
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

    pub fn list_models(&self) -> Vec<ModelStatus> {
        self.catalog
            .iter()
            .map(|info| ModelStatus {
                info: info.clone(),
                is_downloaded: self.is_downloaded(&info.id),
                is_downloading: self.is_downloading(&info.id),
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
