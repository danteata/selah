//! Native Audio Capture Module
//!
//! Provides high-quality audio capture with support for:
//! - Microphone input (cross-platform via cpal)
//! - System audio loopback (platform-specific)
//! - Silero VAD for speech detection
//!
//! # Platform Support
//! - macOS 12.3+: ScreenCaptureKit for system audio
//! - Windows: WASAPI loopback for system audio
//! - Linux: PulseAudio monitor source (microphone only for now)

mod microphone;
#[cfg(debug_assertions)]
mod session_recorder;
mod types;
mod vad;

pub use types::*;
pub use vad::VadSegmenter;
#[allow(unused_imports)]
pub use vad::{SileroVad, VadConfig};
#[cfg(debug_assertions)]
pub use session_recorder::SessionRecorder;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use tauri::Manager;

pub use microphone::*;

/// Thread-safe audio capture state (shared between Tauri commands)
pub struct AudioCaptureState {
    pub is_capturing: Arc<AtomicBool>,
    pub audio_buffer: Arc<Mutex<Vec<f32>>>,
    pub buffer_size: Arc<AtomicUsize>,
    pub chunk_size_samples: Arc<AtomicUsize>,
    pub capture_type: Arc<Mutex<CaptureType>>,
    pub sample_rate: Arc<Mutex<u32>>,
    pub stop_sender: Mutex<Option<Sender<()>>>,
    pub vad_segmenter: Arc<Mutex<Option<VadSegmenter>>>,
    pub vad_enabled: Arc<AtomicBool>,
    pub device_name: Arc<Mutex<Option<String>>>,
    /// Dev-only: active session-audio recorder, if a dev has started one via
    /// `start_session_recording`. Always `None` in release builds.
    #[cfg(debug_assertions)]
    pub session_recorder: Arc<Mutex<Option<Arc<SessionRecorder>>>>,
}

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            buffer_size: Arc::new(AtomicUsize::new(0)),
            chunk_size_samples: Arc::new(AtomicUsize::new(TARGET_SAMPLE_RATE as usize * 3)),
            capture_type: Arc::new(Mutex::new(CaptureType::Microphone)),
            sample_rate: Arc::new(Mutex::new(TARGET_SAMPLE_RATE)),
            stop_sender: Mutex::new(None),
            vad_segmenter: Arc::new(Mutex::new(None)),
            vad_enabled: Arc::new(AtomicBool::new(false)),
            device_name: Arc::new(Mutex::new(None)),
            #[cfg(debug_assertions)]
            session_recorder: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self::new()
    }
}

// Ensure AudioCaptureState is Send + Sync
unsafe impl Send for AudioCaptureState {}
unsafe impl Sync for AudioCaptureState {}

/// Tauri command: Check if system audio capture is supported
#[tauri::command]
pub fn is_system_audio_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        // ScreenCaptureKit requires macOS 12.3+
        // We'll return true and handle errors at runtime
        true
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        // Now partially implemented via monitor device search
        true
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

/// Machine-parseable error the frontend detects to show the "grant permission"
/// recovery flow. Do not change the string without updating classifyTranscriptionError.
#[cfg(target_os = "macos")]
pub const SCREEN_CAPTURE_PERMISSION_DENIED: &str = "SCREEN_CAPTURE_PERMISSION_DENIED";

/// Tauri command: Check whether Screen & System Audio Recording permission is
/// granted. On macOS this reflects the TCC grant WITHOUT triggering a prompt.
/// Other platforms don't gate system-audio loopback behind this, so they return true.
#[tauri::command]
pub fn check_screen_capture_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::screen_capture_access_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Tauri command: Request Screen & System Audio Recording permission.
///
/// On macOS the system prompt appears only the FIRST time. Once the user has
/// declined (or dismissed) it, macOS never prompts again and this returns false
/// immediately — the user must enable it manually via `open_screen_capture_settings`.
/// Returns whether access is granted afterwards.
#[tauri::command]
pub fn request_screen_capture_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::request_screen_capture_access()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Tauri command: Open the OS settings page where the user grants Screen &
/// System Audio Recording permission. This is the only recovery path once the
/// one-shot system prompt has been declined.
#[tauri::command]
pub fn open_screen_capture_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|e| format!("Failed to open System Settings: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Tauri command: Start audio capture with specified type
#[tauri::command]
pub fn start_capture(
    state: tauri::State<'_, AudioCaptureState>,
    capture_type: Option<String>,
    chunk_duration_ms: Option<u32>,
    device_name: Option<String>,
) -> Result<(), String> {
    let ct = match capture_type.as_deref() {
        Some("system") => CaptureType::System,
        Some("both") => CaptureType::Both,
        _ => CaptureType::Microphone,
    };

    if matches!(ct, CaptureType::System | CaptureType::Both) && !is_system_audio_supported() {
        return Err("System audio capture is not supported on this platform".to_string());
    }

    if let Some(ref name) = device_name {
        *state.device_name.lock() = Some(name.clone());
    } else {
        *state.device_name.lock() = None;
    }

    start_audio_capture_internal(&state, ct, chunk_duration_ms)
}

fn start_audio_capture_internal(
    state: &tauri::State<'_, AudioCaptureState>,
    capture_type: CaptureType,
    chunk_duration_ms: Option<u32>,
) -> Result<(), String> {
    if state.is_capturing.load(Ordering::SeqCst) {
        return Err("Already capturing".to_string());
    }

    // Fail fast on macOS when system-audio capture is requested without the
    // Screen & System Audio Recording grant. Otherwise the ScreenCaptureKit
    // thread would spawn, hit "user declined TCCs", and die silently — leaving
    // the UI stuck with no signal. Returning here lets the frontend surface the
    // grant-permission recovery flow.
    #[cfg(target_os = "macos")]
    if matches!(capture_type, CaptureType::System)
        && !macos::screen_capture_access_granted()
    {
        return Err(SCREEN_CAPTURE_PERMISSION_DENIED.to_string());
    }

    // Set chunk duration if provided
    if let Some(duration) = chunk_duration_ms {
        state.chunk_size_samples.store(
            (TARGET_SAMPLE_RATE as f64 * duration as f64 / 1000.0) as usize,
            Ordering::SeqCst,
        );
    }

    // Store capture type
    *state.capture_type.lock() = capture_type.clone();

    // Clear the buffer
    state.audio_buffer.lock().clear();
    state.buffer_size.store(0, Ordering::SeqCst);
    state.is_capturing.store(true, Ordering::SeqCst);

    // Create a channel for stop signal
    let (stop_tx, stop_rx) = channel();
    *state.stop_sender.lock() = Some(stop_tx);

    // Clone state for the thread
    let is_capturing = state.is_capturing.clone();
    let audio_buffer = state.audio_buffer.clone();
    let buffer_size = state.buffer_size.clone();
    let sample_rate = state.sample_rate.clone();
    let device_name = state.device_name.lock().clone();

    match capture_type {
        CaptureType::Microphone => start_microphone_capture(
            is_capturing,
            audio_buffer,
            buffer_size,
            sample_rate,
            stop_rx,
            device_name,
        ),
        CaptureType::System => {
            // Use platform-specific system audio capture
            #[cfg(target_os = "macos")]
            {
                macos::start_system_audio_capture(
                    is_capturing,
                    audio_buffer,
                    buffer_size,
                    sample_rate,
                    stop_rx,
                )
            }
            #[cfg(target_os = "windows")]
            {
                windows::start_system_audio_capture(
                    is_capturing,
                    audio_buffer,
                    buffer_size,
                    sample_rate,
                    stop_rx,
                )
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                Err("System audio capture not supported on this platform".to_string())
            }
        }
        CaptureType::Both => {
            // TODO: Implement mixed capture
            // For now, fall back to microphone
            start_microphone_capture(
                is_capturing,
                audio_buffer,
                buffer_size,
                sample_rate,
                stop_rx,
                device_name,
            )
        }
    }
}

/// Tauri command: Stop audio capture
#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, AudioCaptureState>) {
    state.is_capturing.store(false, Ordering::SeqCst);

    // Send stop signal to the audio thread
    if let Some(sender) = state.stop_sender.lock().take() {
        let _ = sender.send(());
    }
}

/// Tauri command: Check if audio is being captured
#[tauri::command]
pub fn is_capturing(state: tauri::State<'_, AudioCaptureState>) -> bool {
    state.is_capturing.load(Ordering::SeqCst)
}

/// Tauri command: Get audio chunk if available
#[tauri::command]
pub fn get_audio_chunk(state: tauri::State<'_, AudioCaptureState>) -> Option<AudioChunk> {
    let mut buffer = state.audio_buffer.lock();
    let chunk_size = state.chunk_size_samples.load(Ordering::SeqCst);

    if buffer.len() >= chunk_size {
        let samples: Vec<f32> = buffer.drain(..chunk_size).collect();
        state.buffer_size.store(buffer.len(), Ordering::SeqCst);

        let duration_ms = (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32;

        Some(AudioChunk {
            samples,
            duration_ms,
            sample_rate: TARGET_SAMPLE_RATE,
        })
    } else {
        None
    }
}

/// Tauri command: Get current buffer size
#[tauri::command]
pub fn get_buffer_size(state: tauri::State<'_, AudioCaptureState>) -> usize {
    state.buffer_size.load(Ordering::SeqCst)
}

/// Tauri command: Flush all buffered audio
#[tauri::command]
pub fn flush_buffer(state: tauri::State<'_, AudioCaptureState>) -> AudioChunk {
    let mut buffer = state.audio_buffer.lock();
    let samples: Vec<f32> = buffer.drain(..).collect();
    state.buffer_size.store(0, Ordering::SeqCst);

    let duration_ms = if samples.is_empty() {
        0
    } else {
        (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32
    };

    AudioChunk {
        samples,
        duration_ms,
        sample_rate: TARGET_SAMPLE_RATE,
    }
}

/// Tauri command: Clear audio buffer
#[tauri::command]
pub fn clear_buffer(state: tauri::State<'_, AudioCaptureState>) {
    state.audio_buffer.lock().clear();
    state.buffer_size.store(0, Ordering::SeqCst);
}

/// Tauri command: Get current capture type
#[tauri::command]
pub fn get_capture_type(state: tauri::State<'_, AudioCaptureState>) -> String {
    match *state.capture_type.lock() {
        CaptureType::Microphone => "microphone".to_string(),
        CaptureType::System => "system".to_string(),
        CaptureType::Both => "both".to_string(),
    }
}

/// Tauri command: Get audio chunk as WAV (base64 encoded)
#[tauri::command]
pub fn get_audio_chunk_as_wav(state: tauri::State<'_, AudioCaptureState>) -> Option<String> {
    let chunk = get_audio_chunk(state)?;
    Some(chunk.to_wav_base64())
}

/// Tauri command: Flush buffer as WAV (base64 encoded)
#[tauri::command]
pub fn flush_buffer_as_wav(state: tauri::State<'_, AudioCaptureState>) -> String {
    let chunk = flush_buffer(state);
    chunk.to_wav_base64()
}

/// Dev-only: start recording the raw (pre-VAD) session audio to disk, for
/// later offline re-transcription and accuracy comparison against the live
/// detector. Returns the path of the WAV file being written. No-op error in
/// release builds.
#[tauri::command]
pub fn start_session_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
    session_id: String,
) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?
            .join("dev-sermon-recordings");
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create recordings dir: {e}"))?;

        // Prune at start (not stop) so a crash mid-recording doesn't wedge
        // future cleanup. Keep room for the recording we're about to start.
        session_recorder::prune_to_last_n(&dir, 4)?;

        let path = dir.join(format!("{session_id}.wav"));
        let sample_rate = *state.sample_rate.lock();
        let recorder = SessionRecorder::start(path.clone(), sample_rate)?;
        *state.session_recorder.lock() = Some(Arc::new(recorder));
        Ok(path.to_string_lossy().to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, state, session_id);
        Err("Session recording is a dev-only feature".to_string())
    }
}

/// Dev-only: stop the active session recording (if any) and finalize the WAV.
#[tauri::command]
pub fn stop_session_recording(state: tauri::State<'_, AudioCaptureState>) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        if let Some(rec) = state.session_recorder.lock().take() {
            rec.finish()?;
        }
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = state;
        Ok(())
    }
}

/// Event payload for VAD-processed audio chunk events
#[derive(Clone, serde::Serialize)]
struct VadAudioChunkEvent {
    /// Base64-encoded WAV data (16kHz mono 16-bit PCM)
    wav_base64: String,
    /// Duration of the speech segment in milliseconds
    duration_ms: u32,
    /// Whether speech is currently detected
    is_speaking: bool,
    /// Sermon-relative start offset in milliseconds (when this segment began)
    start_offset_ms: u32,
    /// Terminal marker emitted once after capture stops and the final segment
    /// has been flushed. The JS side waits for this before tearing down its
    /// listener so the last utterance isn't dropped (see nativeAudioCapture).
    #[serde(default)]
    end_of_stream: bool,
}

/// Event payload for in-process transcription results (native engine path).
#[cfg(feature = "native-transcription")]
#[derive(Clone, serde::Serialize)]
struct TranscriptionResultEvent {
    text: String,
    duration_ms: u32,
    start_offset_ms: u32,
    /// Segment timings in **seconds from the start of the recording session**
    /// (the engine's utterance-relative times plus `start_offset_ms`), so a
    /// detected verse can be mapped back to a moment in the recording.
    ///
    /// Empty when the model emits no alignment data, and also for the streaming
    /// path — `finalize_stream` returns text only.
    segments: Vec<TranscriptionResultSegment>,
}

/// One `TranscriptionResultEvent` segment row; times are session-absolute
/// seconds. Mirrored by `WhisperSegmentTiming` in the frontend.
#[derive(Clone, serde::Serialize)]
struct TranscriptionResultSegment {
    start: f64,
    end: f64,
    text: String,
}

/// Continuous audio-feature event for the audio-reactive visualizer + level
/// meter. Emitted at ~30fps from the capture loop for ALL capture sources
/// (microphone AND system loopback), so the webview has a live signal even in
/// native desktop mode where there is no JS-side MediaStream. Mirrors the
/// `AudioFeatures` shape consumed by the JS `audioFeatures` bus.
#[derive(Clone, serde::Serialize)]
struct AudioFeaturesEvent {
    rms: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    /// True for a keep-alive frame emitted because no samples arrived this tick
    /// (device hiccup / loopback stall), as opposed to a genuinely quiet room —
    /// real silence still delivers near-zero samples. The frontend uses this to
    /// refresh the capture watchdog's liveness WITHOUT feeding hard zeros into
    /// the visualizer's onset detector, which would collapse its baseline and
    /// make the next real frame fire a phantom beat.
    silent: bool,
}

/// Running filter state for {@link AudioFeatureFilters::compute}.
///
/// Persisted across ticks rather than re-zeroed per call: the one-pole filters
/// below carry ~1 ms of memory, so restarting them at zero on every window
/// clips the start of each window's bass and leaks it into the treble residual.
/// Over a 33 ms window that is small but systematic, and it is exactly the kind
/// of per-window artefact an onset detector mistakes for a transient.
struct AudioFeatureFilters {
    lp_bass: f32,
    lp_mid: f32,
}

impl AudioFeatureFilters {
    fn new() -> Self {
        Self { lp_bass: 0.0, lp_mid: 0.0 }
    }

    /// Compute coarse band energies from a mono sample buffer in the time domain
    /// (no FFT dependency). Two cascaded one-pole low-passes split the spectrum
    /// into three bands:
    ///   - `bass`   = output of the ~250 Hz low-pass (kick / bass guitar),
    ///   - `mid`    = the ~250 Hz..~2.5 kHz band (voices, most instruments),
    ///   - `treble` = the residual above that (cymbals / air).
    ///
    /// `mid` previously just re-reported `rms`, which meant the mid band never
    /// carried any independent information on desktop and any mid-driven visual
    /// was silently duplicating the overall level. Values are gained and clamped
    /// to 0..1 to suit the visualizer, which smooths them further. Empty input
    /// yields silence.
    fn compute(&mut self, samples: &[f32], sample_rate: f32) -> AudioFeaturesEvent {
        let n = samples.len();
        if n == 0 {
            return AudioFeaturesEvent {
                rms: 0.0,
                bass: 0.0,
                mid: 0.0,
                treble: 0.0,
                silent: true,
            };
        }

        // One-pole coefficient for a given -3 dB cutoff: a = exp(-2*pi*fc/fs).
        let coeff = |fc: f32| (-2.0 * std::f32::consts::PI * fc / sample_rate).exp();
        let a_bass = coeff(250.0);
        let a_mid = coeff(2500.0);

        let mut sq = 0.0_f32;
        let mut bass_sq = 0.0_f32;
        let mut mid_sq = 0.0_f32;
        let mut treble_sq = 0.0_f32;
        for &x in samples {
            sq += x * x;
            self.lp_bass = a_bass * self.lp_bass + (1.0 - a_bass) * x;
            self.lp_mid = a_mid * self.lp_mid + (1.0 - a_mid) * x;
            bass_sq += self.lp_bass * self.lp_bass;
            // Band-pass by difference of the two low-passes.
            let mid = self.lp_mid - self.lp_bass;
            mid_sq += mid * mid;
            let hp = x - self.lp_mid;
            treble_sq += hp * hp;
        }
        let inv = 1.0 / n as f32;
        let rms = (sq * inv).sqrt();
        let bass = (bass_sq * inv).sqrt();
        let mid = (mid_sq * inv).sqrt();
        let treble = (treble_sq * inv).sqrt();

        // Raw 16kHz mono RMS is small (~0.05-0.2 for speech); gain so typical
        // levels land in a lively 0.2-0.8 range, then clamp.
        let g = |v: f32, gain: f32| (v * gain).clamp(0.0, 1.0);
        AudioFeaturesEvent {
            rms: g(rms, 4.0),
            bass: g(bass, 6.0),
            mid: g(mid, 6.0),
            treble: g(treble, 8.0),
            silent: false,
        }
    }
}

/// One completed VAD speech segment queued for the transcription worker
/// thread (see `start_capture_with_vad`) — kept off the VAD-processing
/// thread so a slow `transcribe()` call never delays the `audio-features`
/// heartbeat that thread also emits.
struct TranscriptionJob {
    samples: Vec<f32>,
    start_offset_ms: u32,
    is_speaking: bool,
    /// Reply channel for the live stream that received *this* segment's audio,
    /// detached from the router by the capture thread at the moment the segment
    /// ended. `None` when no stream was open. See
    /// `TranscriptionManager::request_finalize` for why the detach has to
    /// happen there rather than on the worker thread.
    finalize: Option<std::sync::mpsc::Receiver<Option<String>>>,
}

/// Handle a complete VAD speech segment.
///
/// When the native engine has a model loaded, transcribe the samples in-process
/// and emit `transcription-result`. Otherwise emit the segment as a base64 WAV
/// `vad-audio-chunk` for the Python sidecar (the path used until cutover).
fn handle_speech_segment(
    app: &tauri::AppHandle,
    samples: Vec<f32>,
    start_offset_ms: u32,
    is_speaking: bool,
    #[cfg_attr(not(feature = "native-transcription"), allow(unused_variables))] finalize: Option<
        std::sync::mpsc::Receiver<Option<String>>,
    >,
) {
    use tauri::Emitter;
    let duration_ms = (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32;

    #[cfg(feature = "native-transcription")]
    {
        use tauri::Manager;
        if let Some(tm) = app.try_state::<crate::transcription::TranscriptionManager>() {
            if tm.is_model_loaded() {
                // This segment's audio may already have been fed live to a
                // stream (see `start_capture_with_vad`'s VAD loop), in which
                // case finalizing it is cheaper and gives the exact text the
                // user already saw appear live. `Ok(None)` means no stream was
                // active (the loaded model doesn't support streaming) — fall
                // back to a normal batch transcribe of the buffered samples.
                //
                // This holds for a segment cut at `max_speech_ms` too. Finalizing
                // is what closes the stream so the next one can open, and on a
                // streaming engine its text is the *better* result — it decoded
                // this audio with full context. Batch-transcribing the buffered
                // samples instead would decode the same seconds a second time,
                // roughly doubling the per-segment cost on exactly the sustained
                // input the cut exists for, and back the worker queue up until
                // the transcript falls minutes behind.
                //
                // `finalize` is this segment's own stream, detached by the
                // capture thread when the segment ended, so its text describes
                // this audio and no other. An *empty* answer is still not an
                // answer, though, and must never be preferred over samples we
                // still hold: a model can stream nothing for reasons of its own,
                // and emitting nothing looks exactly like a dead engine from the
                // frontend. Batch transcribing costs one decode and cannot come
                // up empty for audio that actually contained words.
                let streamed = finalize
                    .and_then(crate::transcription::TranscriptionManager::await_finalize)
                    .filter(|text| !text.trim().is_empty());
                let via_stream = streamed.is_some();
                let result = match streamed {
                    Some(text) => Ok(crate::transcription::TranscriptionOutput {
                        text,
                        segments: Vec::new(),
                    }),
                    None => tm.transcribe(samples),
                };
                match result {
                    Ok(out) => {
                        let text = out.text.trim().to_string();
                        if text.is_empty() {
                            // Emitting nothing is indistinguishable, from the
                            // frontend, from the engine having died — the
                            // transcript just stops while capture carries on.
                            // Say so, so the two can be told apart in the log.
                            tracing::warn!(
                                "[native-transcription] empty result for {} ms segment at {} ms (via {})",
                                duration_ms,
                                start_offset_ms,
                                if via_stream { "stream" } else { "batch" },
                            );
                        } else {
                            // Engine times are relative to this utterance; shift
                            // them onto the session timeline before emitting.
                            let offset_secs = start_offset_ms as f64 / 1000.0;
                            let segments = out
                                .segments
                                .iter()
                                .map(|s| TranscriptionResultSegment {
                                    start: s.start + offset_secs,
                                    end: s.end + offset_secs,
                                    text: s.text.clone(),
                                })
                                .collect();
                            let _ = app.emit(
                                "transcription-result",
                                TranscriptionResultEvent {
                                    text,
                                    duration_ms,
                                    start_offset_ms,
                                    segments,
                                },
                            );
                        }
                    }
                    Err(e) => eprintln!("[native-transcription] {}", e),
                }
                return;
            }
        }
    }

    // Sidecar fallback: emit the speech segment as a WAV chunk.
    let chunk = AudioChunk {
        samples,
        duration_ms,
        sample_rate: TARGET_SAMPLE_RATE,
    };
    let wav_base64 = chunk.to_wav_base64();
    if !wav_base64.is_empty() {
        let _ = app.emit(
            "vad-audio-chunk",
            VadAudioChunkEvent {
                wav_base64,
                duration_ms,
                is_speaking,
                start_offset_ms,
                end_of_stream: false,
            },
        );
    }
}

/// Tauri command: Initialize VAD with model path
#[tauri::command]
pub fn init_vad(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    // Get the model path from the app's resource directory
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let model_path = resource_path.join("assets").join("silero_vad.onnx");

    if !model_path.exists() {
        return Err(format!("VAD model not found at {:?}", model_path));
    }

    let segmenter = VadSegmenter::new(&model_path)?;
    *state.vad_segmenter.lock() = Some(segmenter);
    state.vad_enabled.store(true, Ordering::SeqCst);

    println!("[VAD] Initialized successfully from {:?}", model_path);
    Ok(())
}

/// Tauri command: Enable or disable VAD
#[tauri::command]
pub fn set_vad_enabled(state: tauri::State<'_, AudioCaptureState>, enabled: bool) {
    state.vad_enabled.store(enabled, Ordering::SeqCst);
}

/// Tauri command: Start capture with VAD-based event delivery
///
/// This command starts audio capture with Silero VAD processing.
/// Instead of emitting fixed-duration chunks, it emits complete speech segments.
/// Events are emitted as `vad-audio-chunk` with speech segments only.
#[tauri::command]
pub fn start_capture_with_vad(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
    capture_type: Option<String>,
    device_name: Option<String>,
) -> Result<(), String> {
    // Initialize VAD if not already done
    if state.vad_segmenter.lock().is_none() {
        // Get the model path from the app's resource directory
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;

        let model_path = resource_path.join("assets").join("silero_vad.onnx");

        if !model_path.exists() {
            return Err(format!("VAD model not found at {:?}", model_path));
        }

        let segmenter = VadSegmenter::new(&model_path)?;
        *state.vad_segmenter.lock() = Some(segmenter);
        state.vad_enabled.store(true, Ordering::SeqCst);
    }

    // The segmenter outlives a capture session (it is only built once), so its
    // sample clock — which is what dates every emitted segment — has to be
    // rewound here or a second session's timestamps continue the first's.
    if let Some(ref mut vad) = *state.vad_segmenter.lock() {
        vad.reset();
    }

    // Clone what we need for the VAD processing thread BEFORE calling start_capture
    let is_capturing = state.is_capturing.clone();
    let audio_buffer = state.audio_buffer.clone();
    let buffer_size = state.buffer_size.clone();
    let vad_segmenter = state.vad_segmenter.clone();
    let vad_enabled = state.vad_enabled.clone();
    #[cfg(debug_assertions)]
    let session_recorder = state.session_recorder.clone();

    // Start the underlying capture with smaller chunks for VAD
    // VAD works best with 512, 768, or 1024 sample chunks (32-64ms at 16kHz)
    let ct = match capture_type.as_deref() {
        Some("system") => CaptureType::System,
        Some("both") => CaptureType::Both,
        _ => CaptureType::Microphone,
    };
    if let Some(ref name) = device_name {
        *state.device_name.lock() = Some(name.clone());
    } else {
        *state.device_name.lock() = None;
    }
    start_audio_capture_internal(&state, ct, Some(32))?;

    // Speech segments are transcribed on a dedicated worker thread, not the
    // VAD-processing thread below. `handle_speech_segment` calls into
    // whichever engine is loaded (whisper.cpp, Parakeet, ...) and blocks
    // until it returns — for a slow segment or a slower model that can take
    // several seconds. If that call happened inline on the VAD thread, it
    // would also delay the `audio-features` heartbeat emitted every
    // iteration of that same loop, and the frontend watchdog
    // (`useSermonListener.ts`) restarts the whole capture session if that
    // heartbeat goes stale for 9+ seconds — a false "capture died" restart
    // that drops whatever was mid-transcription. Queuing jobs here and
    // processing them on a separate thread keeps the heartbeat flowing
    // regardless of how long transcription takes, for any engine.
    let (job_tx, job_rx) = std::sync::mpsc::channel::<TranscriptionJob>();
    let worker_app = app.clone();
    let worker_handle = std::thread::spawn(move || {
        for job in job_rx {
            handle_speech_segment(
                &worker_app,
                job.samples,
                job.start_offset_ms,
                job.is_speaking,
                job.finalize,
            );
        }
    });

    // Snapshot of the transcription manager + its stream router for the VAD
    // thread to open/feed a live stream (see the loop below). `None` off the
    // native-transcription feature, or before the model manager state exists.
    // `TranscriptionManager` is a cheap Arc-backed clone.
    #[cfg(feature = "native-transcription")]
    let native_transcription_manager: Option<crate::transcription::TranscriptionManager> = {
        use tauri::Manager;
        app.try_state::<crate::transcription::TranscriptionManager>()
            .map(|tm| (*tm).clone())
    };
    #[cfg(feature = "native-transcription")]
    let native_stream_router = native_transcription_manager.as_ref().map(|tm| tm.stream_router());

    // Spawn a thread that processes audio through VAD
    std::thread::spawn(move || {
        use tauri::Emitter;

        let check_interval_ms = 10; // Check every 10ms for low latency
        // Record session start time for sermon-relative offset calculation
        let session_start = std::time::Instant::now();
        // Throttle continuous audio-feature emission to ~30fps for the visualizer.
        let mut last_features_emit = std::time::Instant::now();
        let features_interval_ms = 33u128;
        // Running filter state + the accumulation window for the visualizer's
        // features.
        //
        // The buffer above is drained every `check_interval_ms` (10 ms) but
        // features are only emitted every 33 ms, so computing them from just the
        // tick that happens to coincide with the emit examined roughly one third
        // of the audio and threw the rest away. A kick landing in either of the
        // two discarded 10 ms windows was invisible to the onset detector, which
        // is why the visualizer skipped beats seemingly at random — which beats
        // survived depended purely on the phase between the drain loop and the
        // emit throttle. Accumulating every drained sample and computing over the
        // whole inter-emit window means no audio goes unexamined.
        let mut feature_filters = AudioFeatureFilters::new();
        let mut feature_window: Vec<f32> = Vec::with_capacity(TARGET_SAMPLE_RATE as usize / 8);
        // Whether audio should currently be routed to a live stream; see the
        // streaming block inside the VAD match.
        #[cfg(feature = "native-transcription")]
        let mut was_speaking = false;
        // "This utterance should have a live stream and does not yet."
        //
        // Set by the speech-onset edge and by a `max_speech_ms` cut (which
        // finalizes, and so closes, the stream mid-utterance, long after the
        // onset edge has passed). Cleared only when a stream actually opens, or
        // when speech ends — an edge that could not be honoured because the
        // previous stream was still finalizing has to survive to the next tick,
        // or the whole utterance runs unstreamed.
        //
        // Deliberately not a plain `now_speaking && can_start_stream()` level
        // trigger: on an engine that cannot stream, the worker `start_stream`
        // spawns discovers this and exits within milliseconds, so that
        // condition is true again on the next 10 ms tick and would spawn a
        // worker a hundred times a second, each taking and returning the engine
        // lease `transcribe()` needs.
        #[cfg(feature = "native-transcription")]
        let mut want_stream = false;

        while is_capturing.load(Ordering::SeqCst) {
            if !vad_enabled.load(Ordering::SeqCst) {
                // VAD disabled, just sleep
                std::thread::sleep(std::time::Duration::from_millis(check_interval_ms));
                continue;
            }

            // Get audio samples from buffer
            let mut buf = audio_buffer.lock();
            let samples: Vec<f32> = buf.drain(..).collect();
            buffer_size.store(0, Ordering::SeqCst);
            drop(buf); // Release lock before VAD processing

            if samples.is_empty() {
                // Still fire the throttled heartbeat even when no new samples
                // arrived this tick. Skipping it here used to mean a genuine
                // upstream audio-delivery gap (device hiccup, system-loopback
                // stall) silenced the heartbeat entirely, which the frontend
                // watchdog (`useSermonListener.ts`, `isStale(9000)`) reads as
                // "capture died" and restarts the whole session — even though
                // this thread is alive and just waiting for more samples.
                //
                // A tick with no samples at all is a delivery gap, not silence,
                // so the frame is flagged `silent` and the frontend treats it as
                // liveness-only (it holds the last real features rather than
                // dropping to zero — see `publishFeatures`). If anything did
                // accumulate before the gap, emit that instead of discarding it.
                if last_features_emit.elapsed().as_millis() >= features_interval_ms {
                    let event = if feature_window.is_empty() {
                        AudioFeaturesEvent {
                            rms: 0.0,
                            bass: 0.0,
                            mid: 0.0,
                            treble: 0.0,
                            silent: true,
                        }
                    } else {
                        feature_filters.compute(&feature_window, TARGET_SAMPLE_RATE as f32)
                    };
                    feature_window.clear();
                    let _ = app.emit("audio-features", event);
                    last_features_emit = std::time::Instant::now();
                }
                std::thread::sleep(std::time::Duration::from_millis(check_interval_ms));
                continue;
            }

            // Dev-only: append the raw, continuous (pre-VAD) samples to the
            // active session recording, if any. Recording the raw buffer
            // (not just VAD-flagged speech segments) matters — a VAD false
            // negative would otherwise be invisible to the offline ground
            // truth pass too, defeating the point of an independent
            // comparison.
            #[cfg(debug_assertions)]
            if let Some(rec) = session_recorder.lock().clone() {
                rec.append(&samples);
            }

            // Compute sermon-relative offset (ms since capture started)
            let start_offset_ms = session_start.elapsed().as_millis() as u32;

            // Emit continuous audio features for the visualizer / level meter,
            // throttled. Independent of VAD so it reflects music and instrumental
            // stretches, and works for system loopback (no JS MediaStream there).
            // Every tick's samples are accumulated, so the emitted frame covers
            // the whole interval since the last one rather than only the tick it
            // happened to land on.
            feature_window.extend_from_slice(&samples);
            // Belt-and-braces bound: the emit below clears this every 33 ms, so
            // it should never approach a second of audio. Cap it anyway so a
            // pathological stall can't grow it without limit over a long service.
            let cap = TARGET_SAMPLE_RATE as usize;
            if feature_window.len() > cap {
                let excess = feature_window.len() - cap;
                feature_window.drain(..excess);
            }
            if last_features_emit.elapsed().as_millis() >= features_interval_ms {
                let event = feature_filters.compute(&feature_window, TARGET_SAMPLE_RATE as f32);
                feature_window.clear();
                let _ = app.emit("audio-features", event);
                last_features_emit = std::time::Instant::now();
            }

            // Process through VAD
            let mut segmenter = vad_segmenter.lock();
            if let Some(ref mut vad) = *segmenter {
                let segment_result = vad.process(&samples);

                // Live-stream this tick's raw audio, gated on VAD speaking
                // state rather than the segment result: a stream should open
                // the moment speech starts (not wait for the segment to
                // complete) and keep receiving audio through the tick that
                // closes the segment. Scoped per VAD segment (not per
                // session) so it composes with selah's existing
                // segment/timestamp/verse-detection pipeline — each stream
                // covers exactly one utterance, finalized in
                // `handle_speech_segment` when the segment completes.
                #[cfg(feature = "native-transcription")]
                {
                    let now_speaking = vad.is_speaking();
                    if now_speaking && !was_speaking {
                        want_stream = true;
                    } else if !now_speaking {
                        want_stream = false;
                    }
                    if now_speaking && want_stream {
                        if let Some(tm) = native_transcription_manager.as_ref() {
                            // A previous stream may still be finalizing; keep
                            // wanting one and retry on a later tick if so.
                            if tm.can_start_stream() {
                                tm.start_stream();
                                want_stream = false;
                                // Seed the fresh stream with the VAD pre-roll
                                // (pre-speech + onset frames) so the streaming
                                // model sees the start of the utterance. Without
                                // this, feeding only begins on the onset tick and
                                // the first word or two gets clipped — exactly
                                // what the batch path avoids by prepending the
                                // same pre_speech_buffer to its committed
                                // segment. The prefill excludes this tick's
                                // `samples`, which are fed next.
                                if let Some(router) = native_stream_router.as_ref() {
                                    let prefill = vad.stream_prefill(samples.len());
                                    if !prefill.is_empty() {
                                        router.feed(prefill);
                                    }
                                }
                            }
                        }
                    }
                    if was_speaking || now_speaking {
                        if let Some(router) = native_stream_router.as_ref() {
                            router.feed(&samples);
                        }
                    }
                    was_speaking = now_speaking;
                }

                match segment_result {
                    Ok(Some(segment)) => {
                        // Detach this segment's stream here, on the thread that
                        // knows the segment just ended, and send it with the
                        // job. Doing it synchronously is the whole point: the
                        // router is emptied before another sample can be fed,
                        // so the stream the worker finalizes is exactly the one
                        // that heard this segment — never a newer, empty one it
                        // happened to find open.
                        #[cfg(feature = "native-transcription")]
                        let finalize = native_transcription_manager
                            .as_ref()
                            .and_then(|tm| tm.request_finalize());
                        #[cfg(not(feature = "native-transcription"))]
                        let finalize = None;

                        // A segment that ends while the VAD still hears speech
                        // was cut at `max_speech_ms`, not at a silence. The
                        // detach above closed the stream mid-utterance, so ask
                        // for another one (see `want_stream`).
                        #[cfg(feature = "native-transcription")]
                        if vad.is_speaking() {
                            want_stream = true;
                        }
                        // Complete speech segment: hand off to the transcription
                        // worker thread (see above) so a slow transcribe() call
                        // can never stall this loop's heartbeat.
                        let _ = job_tx.send(TranscriptionJob {
                            samples: segment.samples,
                            start_offset_ms: segment.start_ms,
                            is_speaking: true,
                            finalize,
                        });
                    }
                    Ok(None) => {
                        // No complete segment yet, emit speaking status
                        let _ = app.emit(
                            "vad-audio-chunk",
                            VadAudioChunkEvent {
                                wav_base64: String::new(),
                                duration_ms: 0,
                                is_speaking: vad.is_speaking(),
                                start_offset_ms,
                                end_of_stream: false,
                            },
                        );
                    }
                    Err(e) => {
                        eprintln!("[VAD] Error processing audio: {}", e);
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(check_interval_ms));
        }

        // Flush any remaining speech when capture stops. Without this drain the
        // last cpal buffer (the tail of the final utterance — often a verse
        // reference) would be lost on stop.
        let mut segmenter = vad_segmenter.lock();
        if let Some(ref mut vad) = *segmenter {
            if let Some(segment) = vad.flush() {
                #[cfg(feature = "native-transcription")]
                let finalize = native_transcription_manager
                    .as_ref()
                    .and_then(|tm| tm.request_finalize());
                #[cfg(not(feature = "native-transcription"))]
                let finalize = None;
                let _ = job_tx.send(TranscriptionJob {
                    samples: segment.samples,
                    start_offset_ms: segment.start_ms,
                    is_speaking: false,
                    finalize,
                });
            }
            vad.reset();
        }
        drop(segmenter);

        // Close the job channel and wait for the worker to finish transcribing
        // everything already queued (including the flush above) before telling
        // the frontend it's safe to tear down — otherwise the final utterance's
        // `transcription-result` could arrive after (or never, if the listener
        // was already removed) the `end_of_stream` marker below.
        drop(job_tx);
        let _ = worker_handle.join();

        // Terminal marker: tells the JS listener the flush is complete and it is
        // safe to tear down. Emitted last so any flushed segment above is
        // delivered first.
        let _ = app.emit(
            "vad-audio-chunk",
            VadAudioChunkEvent {
                wav_base64: String::new(),
                duration_ms: 0,
                is_speaking: false,
                start_offset_ms: session_start.elapsed().as_millis() as u32,
                end_of_stream: true,
            },
        );
    });

    Ok(())
}
