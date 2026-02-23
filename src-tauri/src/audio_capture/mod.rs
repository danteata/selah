//! Native Audio Capture Module
//!
//! Provides high-quality audio capture with support for:
//! - Microphone input (cross-platform via cpal)
//! - System audio loopback (platform-specific)
//!
//! # Platform Support
//! - macOS 12.3+: ScreenCaptureKit for system audio
//! - Windows: WASAPI loopback for system audio
//! - Linux: PulseAudio monitor source (microphone only for now)

mod microphone;
mod types;

pub use types::*;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::mpsc::{channel, Sender};

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
        // Linux support via PulseAudio monitor
        false // Not implemented yet
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
) -> Result<(), String> {
    let ct = match capture_type.as_deref() {
        Some("system") => CaptureType::System,
        Some("both") => CaptureType::Both,
        _ => CaptureType::Microphone,
    };

    // Check if system audio is requested but not supported
    if matches!(ct, CaptureType::System | CaptureType::Both) && !is_system_audio_supported() {
        return Err("System audio capture is not supported on this platform".to_string());
    }

    start_audio_capture_internal(state, ct, chunk_duration_ms)
}

fn start_audio_capture_internal(
    state: tauri::State<'_, AudioCaptureState>,
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
            Ordering::SeqCst
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

    match capture_type {
        CaptureType::Microphone => {
            // Use existing microphone capture
            start_microphone_capture(
                is_capturing,
                audio_buffer,
                buffer_size,
                sample_rate,
                stop_rx,
            )
        }
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

/// Event payload for audio chunk events
#[derive(Clone, serde::Serialize)]
struct AudioChunkEvent {
    /// Base64-encoded WAV data (16kHz mono 16-bit PCM)
    wav_base64: String,
    /// Duration of the chunk in milliseconds
    duration_ms: u32,
}

/// Tauri command: Start capture with event-driven WAV delivery
///
/// Instead of requiring the frontend to poll for chunks, this command
/// spawns a background thread that monitors the audio buffer and emits
/// `audio-chunk-wav` events whenever a full chunk is available.
///
/// The event payload is a base64-encoded WAV string, ready to be sent
/// directly to the whisper server — no JS-side conversion needed.
#[tauri::command]
pub fn start_capture_with_events(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
    capture_type: Option<String>,
    chunk_duration_ms: Option<u32>,
) -> Result<(), String> {
    // Start the underlying capture
    start_capture(state.clone(), capture_type, chunk_duration_ms)?;

    // Clone what we need for the event emitter thread
    let is_capturing = state.is_capturing.clone();
    let audio_buffer = state.audio_buffer.clone();
    let buffer_size = state.buffer_size.clone();
    let chunk_size = state.chunk_size_samples.clone();

    // Spawn a thread that monitors the buffer and emits events
    std::thread::spawn(move || {
        use tauri::Emitter;

        let check_interval_ms = 100; // Check every 100ms for low latency

        while is_capturing.load(Ordering::SeqCst) {
            let target_size = chunk_size.load(Ordering::SeqCst);
            let current_size = buffer_size.load(Ordering::SeqCst);

            if current_size >= target_size {
                // Extract chunk and convert to WAV
                let mut buf = audio_buffer.lock();
                if buf.len() >= target_size {
                    let samples: Vec<f32> = buf.drain(..target_size).collect();
                    buffer_size.store(buf.len(), Ordering::SeqCst);
                    drop(buf); // Release lock before encoding

                    let duration_ms = (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32;
                    let chunk = AudioChunk {
                        samples,
                        duration_ms,
                        sample_rate: TARGET_SAMPLE_RATE,
                    };

                    // Only emit if chunk has meaningful audio (not silence)
                    if chunk.has_audio(0.001) {
                        let wav_base64 = chunk.to_wav_base64();
                        if !wav_base64.is_empty() {
                            let _ = app.emit("audio-chunk-wav", AudioChunkEvent {
                                wav_base64,
                                duration_ms,
                            });
                        }
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(check_interval_ms));
        }
    });

    Ok(())
}
