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
mod types;
mod vad;

pub use types::*;
pub use vad::VadSegmenter;
#[allow(unused_imports)]
pub use vad::{SileroVad, VadConfig};

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
}

/// Compute coarse band energies from a mono sample buffer in the time domain
/// (no FFT dependency). A one-pole low-pass approximates bass; the high-pass
/// residual approximates treble. Values are gained and clamped to 0..1 to suit
/// the visualizer, which smooths them further. Empty input yields silence.
fn compute_audio_features(samples: &[f32]) -> AudioFeaturesEvent {
    let n = samples.len();
    if n == 0 {
        return AudioFeaturesEvent { rms: 0.0, bass: 0.0, mid: 0.0, treble: 0.0 };
    }

    // One-pole low-pass coefficient (~bass), high-pass residual (~treble).
    let a = 0.9_f32;
    let mut lp = 0.0_f32;
    let mut sq = 0.0_f32;
    let mut bass_sq = 0.0_f32;
    let mut treble_sq = 0.0_f32;
    for &x in samples {
        sq += x * x;
        lp = a * lp + (1.0 - a) * x;
        bass_sq += lp * lp;
        let hp = x - lp;
        treble_sq += hp * hp;
    }
    let inv = 1.0 / n as f32;
    let rms = (sq * inv).sqrt();
    let bass = (bass_sq * inv).sqrt();
    let treble = (treble_sq * inv).sqrt();

    // Raw 16kHz mono RMS is small (~0.05-0.2 for speech); gain so typical
    // levels land in a lively 0.2-0.8 range, then clamp.
    let g = |v: f32, gain: f32| (v * gain).clamp(0.0, 1.0);
    AudioFeaturesEvent {
        rms: g(rms, 4.0),
        bass: g(bass, 6.0),
        mid: g(rms, 4.0),
        treble: g(treble, 8.0),
    }
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
) {
    use tauri::Emitter;
    let duration_ms = (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32;

    #[cfg(feature = "native-transcription")]
    {
        use tauri::Manager;
        if let Some(tm) = app.try_state::<crate::transcription::TranscriptionManager>() {
            if tm.is_model_loaded() {
                match tm.transcribe(samples) {
                    Ok(out) => {
                        let text = out.text.trim().to_string();
                        if !text.is_empty() {
                            let _ = app.emit(
                                "transcription-result",
                                TranscriptionResultEvent { text, duration_ms, start_offset_ms },
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

    // Clone what we need for the VAD processing thread BEFORE calling start_capture
    let is_capturing = state.is_capturing.clone();
    let audio_buffer = state.audio_buffer.clone();
    let buffer_size = state.buffer_size.clone();
    let vad_segmenter = state.vad_segmenter.clone();
    let vad_enabled = state.vad_enabled.clone();

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

    // Spawn a thread that processes audio through VAD
    std::thread::spawn(move || {
        use tauri::Emitter;

        let check_interval_ms = 10; // Check every 10ms for low latency
        // Record session start time for sermon-relative offset calculation
        let session_start = std::time::Instant::now();
        // Throttle continuous audio-feature emission to ~30fps for the visualizer.
        let mut last_features_emit = std::time::Instant::now();
        let features_interval_ms = 33u128;

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
                std::thread::sleep(std::time::Duration::from_millis(check_interval_ms));
                continue;
            }

            // Compute sermon-relative offset (ms since capture started)
            let start_offset_ms = session_start.elapsed().as_millis() as u32;

            // Emit continuous audio features for the visualizer / level meter,
            // throttled. Independent of VAD so it reflects music and instrumental
            // stretches, and works for system loopback (no JS MediaStream there).
            if last_features_emit.elapsed().as_millis() >= features_interval_ms {
                let _ = app.emit("audio-features", compute_audio_features(&samples));
                last_features_emit = std::time::Instant::now();
            }

            // Process through VAD
            let mut segmenter = vad_segmenter.lock();
            if let Some(ref mut vad) = *segmenter {
                match vad.process(&samples) {
                    Ok(Some(speech_samples)) => {
                        // Complete speech segment: transcribe in-process (native
                        // engine) or emit a WAV chunk for the sidecar.
                        handle_speech_segment(&app, speech_samples, start_offset_ms, true);
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
            if let Some(speech_samples) = vad.flush() {
                let start_offset_ms = session_start.elapsed().as_millis() as u32;
                handle_speech_segment(&app, speech_samples, start_offset_ms, false);
            }
            vad.reset();
        }
        drop(segmenter);

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
