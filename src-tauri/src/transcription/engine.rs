//! In-process transcription engine (Phase 1 of the transcribe-rs migration).
//!
//! Runs Whisper (whisper.cpp / GGUF) and Parakeet (ONNX) **inside the Rust
//! process** via the `transcribe-rs` crate — no Python sidecar, no HTTP. The
//! VAD pipeline can hand its `Vec<f32>` speech segments straight to
//! [`TranscriptionManager::transcribe`].
//!
//! This entire module is gated behind the `native-transcription` Cargo feature
//! so the existing sidecar path and default build are untouched until cutover.
//!
//! Robustness patterns ported from Handy's `managers/transcription.rs`:
//!   - `catch_unwind` around the engine call so a native panic unloads the
//!     engine instead of poisoning the mutex and hanging the app,
//!   - poison-tolerant `lock_engine`,
//!   - `LoadingGuard` (RAII) so the loading flag can never stick,
//!   - an idle watcher that unloads the model after inactivity,
//!   - structured `model-state-changed` events for the UI.

use anyhow::Result;
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

use transcribe_rs::{
    onnx::{
        canary::CanaryModel,
        cohere::CohereModel,
        gigaam::GigaAMModel,
        moonshine::{MoonshineModel, MoonshineVariant, StreamingModel},
        parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity},
        sense_voice::{SenseVoiceModel, SenseVoiceParams},
        Quantization,
    },
    whisper_cpp::{WhisperEngine, WhisperInferenceParams},
    SpeechModel, TranscribeOptions,
};

use super::models::EngineType;

/// Per-session transcription configuration, set from the frontend.
#[derive(Clone, Debug, Default)]
pub struct TranscriptionConfig {
    /// BCP-47-ish language code, or `None`/"auto" for auto-detect (Whisper).
    pub language: Option<String>,
    /// Whisper `initial_prompt` to bias the decoder (Bible-aware prompt).
    pub initial_prompt: Option<String>,
    /// Translate output to English (Whisper).
    pub translate: bool,
}

/// Idle-unload policy for the loaded model.
#[derive(Clone, Copy, Debug)]
pub enum UnloadTimeout {
    Never,
    Immediately,
    After(Duration),
}

impl Default for UnloadTimeout {
    fn default() -> Self {
        UnloadTimeout::After(Duration::from_secs(300))
    }
}

/// A transcription segment with timing (seconds), for verse-timing alignment.
#[derive(Clone, Debug, Serialize)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Result of a transcription.
#[derive(Clone, Debug, Serialize, Default)]
pub struct TranscriptionOutput {
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
}

/// Event emitted on model lifecycle changes (loading/loaded/unloaded/failed).
#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub error: Option<String>,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    Moonshine(MoonshineModel),
    MoonshineStreaming(StreamingModel),
    SenseVoice(SenseVoiceModel),
    GigaAM(GigaAMModel),
    Canary(CanaryModel),
    Cohere(CohereModel),
}

/// RAII guard that clears `is_loading` and wakes waiters on drop, even on early
/// return or panic.
pub struct LoadingGuard {
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl Drop for LoadingGuard {
    fn drop(&mut self) {
        if let Ok(mut flag) = self.is_loading.lock() {
            *flag = false;
        }
        self.loading_condvar.notify_all();
    }
}

#[derive(Clone)]
pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    config: Arc<Mutex<TranscriptionConfig>>,
    unload_timeout: Arc<Mutex<UnloadTimeout>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(TranscriptionConfig::default())),
            unload_timeout: Arc::new(Mutex::new(UnloadTimeout::default())),
            last_activity: Arc::new(AtomicU64::new(Self::now_ms())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
        };
        manager.spawn_idle_watcher();
        manager
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn touch_activity(&self) {
        self.last_activity.store(Self::now_ms(), Ordering::Relaxed);
    }

    /// Lock the engine mutex, recovering from poison if a prior call panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("[transcription] engine mutex poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    pub fn is_model_loaded(&self) -> bool {
        self.lock_engine().is_some()
    }

    pub fn get_current_model(&self) -> Option<String> {
        self.current_model_id.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_config(&self, config: TranscriptionConfig) {
        if let Ok(mut c) = self.config.lock() {
            *c = config;
        }
    }

    pub fn set_unload_timeout(&self, timeout: UnloadTimeout) {
        if let Ok(mut t) = self.unload_timeout.lock() {
            *t = timeout;
        }
    }

    /// Atomically mark a load as in progress; `None` if one already is.
    pub fn try_start_loading(&self) -> Option<LoadingGuard> {
        let mut is_loading = self.is_loading.lock().ok()?;
        if *is_loading {
            return None;
        }
        *is_loading = true;
        Some(LoadingGuard {
            is_loading: self.is_loading.clone(),
            loading_condvar: self.loading_condvar.clone(),
        })
    }

    fn emit_state(&self, event_type: &str, model_id: Option<&str>, error: Option<String>) {
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: event_type.to_string(),
                model_id: model_id.map(|s| s.to_string()),
                error,
            },
        );
    }

    /// Load a model by id from a resolved path. `engine_type` selects the
    /// backend; the path is a GGUF file (Whisper) or a model directory (Parakeet).
    pub fn load_model(&self, model_id: &str, model_path: PathBuf, engine_type: EngineType) -> Result<()> {
        let _guard = self.try_start_loading();
        let start = std::time::Instant::now();
        self.emit_state("loading_started", Some(model_id), None);

        if !model_path.exists() {
            let msg = format!("Model path does not exist: {}", model_path.display());
            self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
            return Err(anyhow::anyhow!(msg));
        }

        let loaded = match engine_type {
            EngineType::Whisper => {
                let engine = WhisperEngine::load(&model_path).map_err(|e| {
                    let msg = format!("Failed to load whisper model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                let engine = ParakeetModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    let msg = format!("Failed to load parakeet model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::Parakeet(engine)
            }
            EngineType::Moonshine => {
                let engine = MoonshineModel::load(&model_path, MoonshineVariant::Base, &Quantization::default())
                    .map_err(|e| {
                        let msg = format!("Failed to load moonshine model {}: {}", model_id, e);
                        self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                        anyhow::anyhow!(msg)
                    })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let engine = StreamingModel::load(&model_path, 0, &Quantization::default()).map_err(|e| {
                    let msg = format!("Failed to load moonshine streaming model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let engine = SenseVoiceModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    let msg = format!("Failed to load SenseVoice model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::GigaAM => {
                let engine = GigaAMModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    let msg = format!("Failed to load GigaAM model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::GigaAM(engine)
            }
            EngineType::Canary => {
                let engine = CanaryModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    let msg = format!("Failed to load Canary model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::Canary(engine)
            }
            EngineType::Cohere => {
                let engine = CohereModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    let msg = format!("Failed to load Cohere model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::Cohere(engine)
            }
        };

        *self.lock_engine() = Some(loaded);
        if let Ok(mut m) = self.current_model_id.lock() {
            *m = Some(model_id.to_string());
        }
        self.touch_activity();
        self.emit_state("loading_completed", Some(model_id), None);
        info!(
            "[transcription] loaded {} in {}ms",
            model_id,
            start.elapsed().as_millis()
        );
        Ok(())
    }

    pub fn unload_model(&self) -> Result<()> {
        *self.lock_engine() = None;
        if let Ok(mut m) = self.current_model_id.lock() {
            *m = None;
        }
        self.emit_state("unloaded", None, None);
        debug!("[transcription] model unloaded");
        Ok(())
    }

    fn maybe_unload_immediately(&self, context: &str) {
        let immediate = matches!(
            self.unload_timeout.lock().map(|t| *t),
            Ok(UnloadTimeout::Immediately)
        );
        if immediate && self.is_model_loaded() {
            info!("[transcription] immediately unloading after {}", context);
            let _ = self.unload_model();
        }
    }

    /// Transcribe 16 kHz mono f32 samples with the loaded engine.
    pub fn transcribe(&self, audio: Vec<f32>) -> Result<TranscriptionOutput> {
        #[cfg(debug_assertions)]
        if std::env::var("SELAH_FORCE_TRANSCRIPTION_FAILURE").is_ok() {
            return Err(anyhow::anyhow!(
                "Simulated transcription failure (SELAH_FORCE_TRANSCRIPTION_FAILURE)"
            ));
        }

        self.touch_activity();

        if audio.is_empty() {
            self.maybe_unload_immediately("empty audio");
            return Ok(TranscriptionOutput::default());
        }

        // Wait out any in-flight load.
        {
            if let Ok(mut is_loading) = self.is_loading.lock() {
                while *is_loading {
                    is_loading = match self.loading_condvar.wait(is_loading) {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                }
            }
            if self.lock_engine().is_none() {
                return Err(anyhow::anyhow!("No transcription model is loaded"));
            }
        }

        let config = self.config.lock().map(|c| c.clone()).unwrap_or_default();

        // Take the engine out so a panic during the call simply drops it
        // (unload) rather than poisoning the mutex.
        let mut engine = {
            let mut guard = self.lock_engine();
            match guard.take() {
                Some(e) => e,
                None => return Err(anyhow::anyhow!("Model unloaded before transcription")),
            }
        };

        let result = catch_unwind(AssertUnwindSafe(|| -> Result<TranscriptionOutput> {
            match &mut engine {
                LoadedEngine::Whisper(whisper) => {
                    let language = match config.language.as_deref() {
                        None | Some("auto") | Some("") => None,
                        Some(lang) => Some(normalize_whisper_lang(lang)),
                    };
                    let params = WhisperInferenceParams {
                        language,
                        translate: config.translate,
                        initial_prompt: config.initial_prompt.clone(),
                        ..Default::default()
                    };
                    let res = whisper
                        .transcribe_with(&audio, &params)
                        .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))?;
                    Ok(TranscriptionOutput {
                        text: res.text,
                        segments: Vec::new(),
                    })
                }
                LoadedEngine::Parakeet(parakeet) => {
                    let params = ParakeetParams {
                        timestamp_granularity: Some(TimestampGranularity::Segment),
                        ..Default::default()
                    };
                    let res = parakeet
                        .transcribe_with(&audio, &params)
                        .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::Moonshine(engine) => {
                    let res = engine
                        .transcribe(&audio, &TranscribeOptions::default())
                        .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::MoonshineStreaming(engine) => {
                    let res = engine
                        .transcribe(&audio, &TranscribeOptions::default())
                        .map_err(|e| anyhow::anyhow!("Moonshine streaming transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::SenseVoice(engine) => {
                    let language = match config.language.as_deref() {
                        Some("zh") | Some("zh-Hans") | Some("zh-Hant") => Some("zh".to_string()),
                        Some("en") => Some("en".to_string()),
                        Some("ja") => Some("ja".to_string()),
                        Some("ko") => Some("ko".to_string()),
                        Some("yue") => Some("yue".to_string()),
                        _ => None,
                    };
                    let params = SenseVoiceParams { language, use_itn: Some(true) };
                    let res = engine
                        .transcribe_with(&audio, &params)
                        .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::GigaAM(engine) => {
                    let res = engine
                        .transcribe(&audio, &TranscribeOptions::default())
                        .map_err(|e| anyhow::anyhow!("GigaAM transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::Canary(engine) => {
                    let language = onnx_language(&config.language);
                    let options = TranscribeOptions {
                        language,
                        translate: config.translate,
                        ..Default::default()
                    };
                    let res = engine
                        .transcribe(&audio, &options)
                        .map_err(|e| anyhow::anyhow!("Canary transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
                LoadedEngine::Cohere(engine) => {
                    let language = onnx_language(&config.language);
                    let options = TranscribeOptions { language, ..Default::default() };
                    let res = engine
                        .transcribe(&audio, &options)
                        .map_err(|e| anyhow::anyhow!("Cohere transcription failed: {}", e))?;
                    Ok(TranscriptionOutput { text: res.text, segments: Vec::new() })
                }
            }
        }));

        match result {
            Ok(inner) => {
                // Put the engine back on success or a normal (non-panic) error.
                *self.lock_engine() = Some(engine);
                let out = inner?;
                self.maybe_unload_immediately("transcription");
                Ok(out)
            }
            Err(panic_payload) => {
                // Engine panicked: drop it (do not put back) and clear the model id.
                let msg = panic_message(&panic_payload);
                error!("[transcription] engine panicked: {}. Model unloaded.", msg);
                if let Ok(mut m) = self.current_model_id.lock() {
                    *m = None;
                }
                self.emit_state("unloaded", None, Some(format!("Engine panicked: {}", msg)));
                Err(anyhow::anyhow!(
                    "Transcription engine panicked: {}. The model was unloaded and will reload on next attempt.",
                    msg
                ))
            }
        }
    }

    fn spawn_idle_watcher(&self) {
        let manager = self.clone();
        let shutdown = self.shutdown_signal.clone();
        thread::spawn(move || {
            while !shutdown.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(10));
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }
                let timeout = manager
                    .unload_timeout
                    .lock()
                    .map(|t| *t)
                    .unwrap_or_default();
                let limit = match timeout {
                    // Immediately is handled after each transcription, not here.
                    UnloadTimeout::Never | UnloadTimeout::Immediately => continue,
                    UnloadTimeout::After(d) => d.as_millis() as u64,
                };
                let idle = Self::now_ms().saturating_sub(manager.last_activity.load(Ordering::Relaxed));
                if idle > limit && manager.is_model_loaded() {
                    info!("[transcription] model idle {}ms (limit {}ms), unloading", idle, limit);
                    let _ = manager.unload_model();
                }
            }
        });
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        // Only the last clone (the one not held by the watcher) shuts it down.
        if Arc::strong_count(&self.engine) > 1 {
            return;
        }
        self.shutdown_signal.store(true, Ordering::Relaxed);
    }
}

/// Map a UI language code to what the ONNX engines (Canary/Cohere) expect.
/// `auto`/empty → None (auto-detect); zh variants → "zh".
fn onnx_language(lang: &Option<String>) -> Option<String> {
    match lang.as_deref() {
        None | Some("auto") | Some("") => None,
        Some("zh-Hans") | Some("zh-Hant") => Some("zh".to_string()),
        Some(l) => Some(l.to_string()),
    }
}

/// Whisper expects a base language code; collapse zh variants to "zh".
fn normalize_whisper_lang(lang: &str) -> String {
    if lang == "zh-Hans" || lang == "zh-Hant" {
        "zh".to_string()
    } else {
        // Strip region (e.g. "en-US" -> "en").
        lang.split(['-', '_']).next().unwrap_or(lang).to_string()
    }
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

/// Apply Auto accelerator preferences (GPU when available, else CPU). Called on
/// startup. Detailed per-device selection can be layered on later.
pub fn apply_default_accelerators() {
    use transcribe_rs::accel;
    accel::set_whisper_accelerator(accel::WhisperAccelerator::Auto);
    accel::set_ort_accelerator(accel::OrtAccelerator::Auto);
    info!("[transcription] accelerators set to Auto");
}
