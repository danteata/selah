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
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tracing::{debug, error, info, warn};

use transcribe_cpp::{
    Model, ModelOptions, RunExtension, RunOptions, Session, StreamOptions, Task, WhisperRunOptions,
};
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
    // `Never` and `Immediately` are matched in `maybe_unload_immediately` and
    // the idle-unload loop, but currently only `After(..)` is constructed
    // (via `Default` / config). They remain part of the public API so callers
    // can opt into never/ immediate unloading via `set_unload_timeout`.
    #[allow(dead_code)]
    Never,
    #[allow(dead_code)]
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

/// Live transcription snapshot emitted while a stream is active (event
/// `native-stream-text`). `committed` is the append-only, flicker-free
/// prefix; `tentative` is the volatile suffix the model may still rewrite.
#[derive(Clone, Debug, Serialize)]
pub struct StreamTextEvent {
    pub committed: String,
    pub tentative: String,
}

/// Commands sent to the streaming worker thread. Frames and the finalize
/// request travel the same channel so FIFO ordering guarantees every fed
/// frame is processed before finalize runs.
enum StreamCmd {
    Feed(Vec<f32>),
    /// Flush the stream and reply with the final text, or `None` if no stream
    /// was ever active (caller should fall back to batch transcription).
    Finalize(mpsc::Sender<Option<String>>),
}

/// Routes real-time audio frames to the active streaming worker. Shared
/// between the [`TranscriptionManager`] (opens/closes the route) and the VAD
/// capture loop (feeds frames). The capture loop holds an `Arc<StreamRouter>`
/// directly, so a frame with no stream pending costs a single relaxed atomic
/// load — no Tauri state lookup, no manager lock.
pub struct StreamRouter {
    /// Command channel to the active streaming worker, present from
    /// `start_stream` until `finalize_stream`.
    tx: Mutex<Option<mpsc::Sender<StreamCmd>>>,
    /// True while a stream is pending or active (channel is open). The
    /// capture loop checks this first to avoid the mutex lock when no stream
    /// runs.
    open: Arc<AtomicBool>,
}

impl StreamRouter {
    fn new() -> Self {
        Self {
            tx: Mutex::new(None),
            open: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Open a fresh command channel for a new streaming session, returning the
    /// receiver the worker should drain.
    fn open(&self) -> mpsc::Receiver<StreamCmd> {
        let (tx, rx) = mpsc::channel::<StreamCmd>();
        *self.tx.lock().unwrap() = Some(tx);
        self.open.store(true, Ordering::Relaxed);
        rx
    }

    /// Take the sender out (closing the channel to new feeds).
    fn take(&self) -> Option<mpsc::Sender<StreamCmd>> {
        self.open.store(false, Ordering::Relaxed);
        self.tx.lock().unwrap().take()
    }

    /// Drop the channel and mark closed without sending a final command (used
    /// when the worker exits without a finalize handshake, e.g. the loaded
    /// model doesn't support streaming).
    fn clear(&self) {
        self.open.store(false, Ordering::Relaxed);
        *self.tx.lock().unwrap() = None;
    }

    /// Forward a 16 kHz frame to the active streaming worker. Cheap no-op (a
    /// single relaxed atomic load) when no stream is pending.
    pub fn feed(&self, frame: &[f32]) {
        if !self.open.load(Ordering::Relaxed) {
            return;
        }
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(StreamCmd::Feed(frame.to_vec()));
        }
    }

    /// Whether a stream is pending or active.
    pub fn is_open(&self) -> bool {
        self.open.load(Ordering::Relaxed)
    }
}

/// RAII guard that clears this worker's active/lease flags on any exit path —
/// normal return, early return, or a panic that unwinds the detached worker
/// thread. Tokens prevent an older worker from clearing a newer worker's state
/// if a start/finalize race ever slips through.
struct StreamWorkerGuard {
    worker_id: u64,
    active_stream_worker: Arc<AtomicU64>,
    active_engine_lease: Arc<AtomicU64>,
    stream_active: Arc<AtomicBool>,
}

impl Drop for StreamWorkerGuard {
    fn drop(&mut self) {
        if self.active_stream_worker.load(Ordering::Acquire) == self.worker_id {
            self.stream_active.store(false, Ordering::Release);
        }
        let _ = self.active_engine_lease.compare_exchange(
            self.worker_id,
            0,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        let _ = self.active_stream_worker.compare_exchange(
            self.worker_id,
            0,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

enum LoadedEngine {
    /// Whisper-family (and other GGUF) models via transcribe-cpp. Holds the
    /// live `Session`, which keeps its `Model` alive internally.
    TranscribeCpp(Session),
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
    /// Routes real-time audio frames to the active streaming worker; see
    /// [`StreamRouter`]. Shared with the audio capture loop so per-frame feeds
    /// skip Tauri state and the manager lock.
    router: Arc<StreamRouter>,
    /// True only while a transcribe-cpp stream is actually in flight (set by
    /// the worker once `stream()` succeeds).
    stream_active: Arc<AtomicBool>,
    /// Monotonic id source for stream workers; zero means "no worker".
    next_stream_worker_id: Arc<AtomicU64>,
    /// Nonzero while a stream worker exists, even if it has not leased the
    /// engine yet. Prevents a second worker from starting after finalize
    /// closes the router but before the first worker has fully exited.
    active_stream_worker: Arc<AtomicU64>,
    /// Nonzero while the streaming worker has taken the engine out of
    /// `engine`. `is_model_loaded()` consults this so the model still reports
    /// "loaded" while the worker holds it.
    active_engine_lease: Arc<AtomicU64>,
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
            router: Arc::new(StreamRouter::new()),
            stream_active: Arc::new(AtomicBool::new(false)),
            next_stream_worker_id: Arc::new(AtomicU64::new(1)),
            active_stream_worker: Arc::new(AtomicU64::new(0)),
            active_engine_lease: Arc::new(AtomicU64::new(0)),
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
        // The engine may be leased out to the streaming worker (taken out of
        // the mutex). It's still loaded, just in use, so report true.
        self.lock_engine().is_some() || self.active_engine_lease.load(Ordering::Acquire) != 0
    }

    pub fn get_current_model(&self) -> Option<String> {
        self.current_model_id.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_config(&self, config: TranscriptionConfig) {
        if let Ok(mut c) = self.config.lock() {
            *c = config;
        }
    }

    #[allow(dead_code)]
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
            EngineType::TranscribeCpp => {
                let model = Model::load_with(&model_path, &ModelOptions::default()).map_err(|e| {
                    let msg = format!("Failed to load model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                let session = model.session().map_err(|e| {
                    let msg = format!("Failed to create session for model {}: {}", model_id, e);
                    self.emit_state("loading_failed", Some(model_id), Some(msg.clone()));
                    anyhow::anyhow!(msg)
                })?;
                LoadedEngine::TranscribeCpp(session)
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

    /// Shared handle to the stream router, used by the VAD capture loop to
    /// feed real-time frames without going through Tauri state.
    pub fn stream_router(&self) -> Arc<StreamRouter> {
        Arc::clone(&self.router)
    }

    /// Begin a live streaming transcription on the currently loaded engine, if
    /// it supports one. Audio frames pushed via [`StreamRouter::feed`] are
    /// decoded incrementally and emitted to the frontend as [`StreamTextEvent`]
    /// (`native-stream-text`).
    ///
    /// Non-blocking: spawns a worker that waits for any in-progress model
    /// load, verifies the model supports streaming, then begins the stream.
    /// If the model can't stream (or no model is loaded), the worker idles
    /// until `finalize_stream` and reports `None` so the caller falls back to
    /// batch transcription. Frames sent before the stream begins queue on the
    /// channel and are not lost.
    pub fn start_stream(&self) {
        if self.router.is_open() || self.active_stream_worker.load(Ordering::Acquire) != 0 {
            warn!("[transcription] start_stream called while a stream worker is already active");
            return;
        }
        let worker_id = self.next_stream_worker_id.fetch_add(1, Ordering::Relaxed);
        if self
            .active_stream_worker
            .compare_exchange(0, worker_id, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            warn!("[transcription] start_stream lost a race with another stream worker");
            return;
        }
        let rx = self.router.open();
        self.stream_active.store(false, Ordering::Release);

        let manager = self.clone();
        thread::spawn(move || manager.run_stream_worker(rx, worker_id));
    }

    fn run_stream_worker(&self, rx: mpsc::Receiver<StreamCmd>, worker_id: u64) {
        let _worker = StreamWorkerGuard {
            worker_id,
            active_stream_worker: Arc::clone(&self.active_stream_worker),
            active_engine_lease: Arc::clone(&self.active_engine_lease),
            stream_active: Arc::clone(&self.stream_active),
        };

        // Wait for any in-progress model load to finish (start_stream races
        // the background load kicked off when a session starts).
        {
            if let Ok(mut is_loading) = self.is_loading.lock() {
                while *is_loading {
                    is_loading = match self.loading_condvar.wait(is_loading) {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                }
            }
        }

        let model_id = self.get_current_model();

        // Take the engine out of the mutex so we own it during streaming,
        // structurally excluding any concurrent batch transcription. Returned
        // when the worker exits (see `return_engine`).
        if self
            .active_engine_lease
            .compare_exchange(0, worker_id, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            warn!("[transcription] live stream: another worker already holds the engine");
            self.router.clear();
            drain_until_finalize(rx);
            return;
        }
        let mut engine = match self.lock_engine().take() {
            Some(e) => e,
            None => {
                info!("[transcription] live stream: no model loaded; falling back to batch");
                let _ = self.active_engine_lease.compare_exchange(
                    worker_id,
                    0,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
                self.router.clear();
                drain_until_finalize(rx);
                return;
            }
        };

        // Only transcribe-cpp sessions expose streaming; ONNX engines fall
        // back to batch. The loaded session (not the catalog entry) is the
        // source of truth for run-path capabilities.
        let supports_streaming = match &engine {
            LoadedEngine::TranscribeCpp(session) => session.model().capabilities().supports_streaming,
            _ => false,
        };

        if !supports_streaming {
            self.return_engine(engine, model_id.as_deref());
            self.router.clear();
            drain_until_finalize(rx);
            return;
        }

        let config = self.config.lock().map(|c| c.clone()).unwrap_or_default();

        let mut finalize_reply: Option<mpsc::Sender<Option<String>>> = None;
        let mut finalize_result: Option<Option<String>> = None;
        // The Stream borrows the session (and thus the engine) for its
        // lifetime, so the feed/finalize loop lives in a labeled block — when
        // it exits, the borrow is released and the engine can be returned.
        let stream_started = 'stream: {
            let session = match &mut engine {
                LoadedEngine::TranscribeCpp(s) => s,
                _ => break 'stream false,
            };
            let is_whisper = session.model().arch() == "whisper";
            let run_options = transcribe_cpp_run_options(&config, is_whisper);

            let mut stream = match session.stream(&run_options, &StreamOptions::default()) {
                Ok(s) => s,
                Err(e) => {
                    error!("[transcription] failed to begin stream: {}", e);
                    break 'stream false;
                }
            };

            self.stream_active.store(true, Ordering::Release);
            self.touch_activity();
            info!("[transcription] live streaming transcription started (model '{:?}')", model_id);

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    StreamCmd::Feed(pcm) => {
                        self.touch_activity();
                        match stream.feed(&pcm) {
                            Ok(update) => {
                                if update.committed_changed || update.tentative_changed {
                                    let text = stream.text();
                                    self.emit_stream_text(&text.committed, &text.tentative);
                                }
                            }
                            Err(e) => warn!("[transcription] stream feed failed: {}", e),
                        }
                    }
                    StreamCmd::Finalize(reply) => {
                        let result = match stream.finalize() {
                            // After finalize the committed prefix holds the
                            // full text; display() = committed + tentative is
                            // the safe read.
                            Ok(_) => Some(stream.text().display()),
                            Err(e) => {
                                error!(
                                    "[transcription] stream finalize failed: {}; falling back to batch",
                                    e
                                );
                                None
                            }
                        };
                        finalize_reply = Some(reply);
                        finalize_result = Some(result);
                        break;
                    }
                }
            }

            true
        };
        // `stream` + the `&mut engine` borrow are released here.

        self.return_engine(engine, model_id.as_deref());
        if !stream_started {
            drain_until_finalize(rx);
            return;
        }
        if let (Some(reply), Some(result)) = (finalize_reply, finalize_result) {
            let _ = reply.send(result);
        }
        // `_worker` drops here, clearing this worker's active/lease flags
        // after the engine has been returned to the pool.
    }

    /// Return the leased engine to the mutex, unless the model was
    /// switched/unloaded during streaming (in which case the stale engine is
    /// dropped instead).
    fn return_engine(&self, engine: LoadedEngine, expected_model_id: Option<&str>) {
        let still_current = self.get_current_model().as_deref() == expected_model_id;
        if still_current {
            *self.lock_engine() = Some(engine);
        } else {
            info!(
                "[transcription] model changed/unloaded during streaming; dropping stale engine (was {:?})",
                expected_model_id
            );
            // `engine` drops here, freeing its resources.
        }
    }

    /// Flush the active stream and return its final text.
    ///
    /// `Ok(None)` means no usable stream was active (no model loaded, model
    /// doesn't support streaming, or finalize failed/timed out) and the
    /// caller should fall back to batch transcription.
    pub fn finalize_stream(&self) -> Result<Option<String>> {
        let Some(tx) = self.router.take() else {
            return Ok(None);
        };
        let (reply_tx, reply_rx) = mpsc::channel();
        if tx.send(StreamCmd::Finalize(reply_tx)).is_err() {
            return Ok(None);
        }
        match reply_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(text) => Ok(text),
            Err(_) => {
                warn!("[transcription] stream finalize timed out; falling back to batch");
                Ok(None)
            }
        }
    }

    fn emit_stream_text(&self, committed: &str, tentative: &str) {
        let _ = self.app_handle.emit(
            "native-stream-text",
            StreamTextEvent {
                committed: committed.to_string(),
                tentative: tentative.to_string(),
            },
        );
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
                LoadedEngine::TranscribeCpp(session) => {
                    // The whisper run extension (initial-prompt bias) is
                    // rejected by non-whisper archs (e.g. Parakeet, Nemotron),
                    // so only attach it when the loaded model is whisper-family.
                    let is_whisper = session.model().arch() == "whisper";
                    let run_options = transcribe_cpp_run_options(&config, is_whisper);
                    let res = session
                        .run(&audio, &run_options)
                        .map_err(|e| anyhow::anyhow!("Transcription failed: {}", e))?;
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

/// Build `transcribe-cpp` run options from the session config, shared by the
/// batch (`transcribe`) and streaming (`run_stream_worker`) paths. `is_whisper`
/// gates the whisper-only initial-prompt run extension, which non-whisper
/// archs (Parakeet, Nemotron) reject.
fn transcribe_cpp_run_options(config: &TranscriptionConfig, is_whisper: bool) -> RunOptions {
    let language = match config.language.as_deref() {
        None | Some("auto") | Some("") => None,
        Some(lang) => Some(normalize_whisper_lang(lang)),
    };
    let family = if is_whisper {
        config.initial_prompt.as_ref().map(|prompt| {
            RunExtension::Whisper(WhisperRunOptions {
                initial_prompt: Some(prompt.clone()),
                ..Default::default()
            })
        })
    } else {
        None
    };
    RunOptions {
        task: if config.translate { Task::Translate } else { Task::Transcribe },
        language,
        family,
        ..Default::default()
    }
}

/// Drain a stream worker's command channel until (and including) a
/// `Finalize`, replying `None` so the caller falls back to batch
/// transcription. Used when a stream never actually began (model doesn't
/// support streaming, or `stream()` failed) but the finalize handshake must
/// still complete.
fn drain_until_finalize(rx: mpsc::Receiver<StreamCmd>) {
    for cmd in rx {
        if let StreamCmd::Finalize(reply) = cmd {
            let _ = reply.send(None);
            break;
        }
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

/// Initialize the transcribe-cpp native backend once at startup: route native
/// logging into `tracing` and register compute backend modules. In a static
/// build (macOS Metal) `init_backends_default` is a harmless no-op; in a
/// `dynamic-backends` build (Windows/Linux Vulkan) it loads the per-ISA CPU /
/// GPU modules — without this, loading any transcribe-cpp model fails with a
/// backend error. Must run before the first model load.
pub fn init_transcribe_cpp_backend() {
    transcribe_cpp::init_logging();
    match transcribe_cpp::init_backends_default() {
        Ok(()) => {
            let devices = transcribe_cpp::devices();
            info!(
                "[transcription] transcribe-cpp initialized with {} compute device(s): [{}]",
                devices.len(),
                devices
                    .iter()
                    .map(|d| format!("{} ({})", d.name, d.kind))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        Err(e) => warn!("[transcription] failed to initialize transcribe-cpp backends: {}", e),
    }
}
