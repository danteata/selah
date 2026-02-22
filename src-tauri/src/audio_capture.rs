//! Native Audio Capture Module
//!
//! Provides high-quality audio capture using cpal for cross-platform support.
//! This module captures audio directly from the system audio device, providing
//! superior quality compared to web-based audio capture.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::mpsc::{channel, Sender};

/// Target sample rate for whisper (16kHz)
const TARGET_SAMPLE_RATE: u32 = 16000;

/// Audio device information
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Audio chunk ready for transcription
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioChunk {
    /// PCM samples as f32 (16kHz mono)
    pub samples: Vec<f32>,
    /// Duration in milliseconds
    pub duration_ms: u32,
    /// Sample rate
    pub sample_rate: u32,
}

/// Thread-safe audio capture state (shared between Tauri commands)
pub struct AudioCaptureState {
    pub is_capturing: Arc<AtomicBool>,
    pub audio_buffer: Arc<Mutex<Vec<f32>>>,
    pub buffer_size: Arc<AtomicUsize>,
    pub chunk_size_samples: Arc<AtomicUsize>,
    // Channel to signal stop
    pub stop_sender: Mutex<Option<Sender<()>>>,
}

impl AudioCaptureState {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            buffer_size: Arc::new(AtomicUsize::new(0)),
            chunk_size_samples: Arc::new(AtomicUsize::new(TARGET_SAMPLE_RATE as usize * 3)),
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

/// Simple linear resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let new_length = (samples.len() as f64 / ratio) as usize;
    let mut result = Vec::with_capacity(new_length);

    for i in 0..new_length {
        let src_index = i as f64 * ratio;
        let src_index_floor = src_index.floor() as usize;
        let fraction = src_index - src_index_floor as f64;

        // Linear interpolation
        let y0 = samples.get(src_index_floor).copied().unwrap_or(0.0f32);
        let y1 = samples.get(src_index_floor + 1).copied().unwrap_or(y0);

        result.push(y0 * (1.0f32 - fraction as f32) + y1 * fraction as f32);
    }

    result
}

/// Tauri command: List audio input devices
#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let default_name = default_device.as_ref().and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    
    match host.input_devices() {
        Ok(device_iter) => {
            for device in device_iter {
                if let Ok(name) = device.name() {
                    let is_default = default_name.as_ref() == Some(&name);
                    
                    let (sample_rate, channels) = device
                        .default_input_config()
                        .map(|config| (config.sample_rate().0, config.channels()))
                        .unwrap_or((44100, 1));
                    
                    devices.push(AudioDeviceInfo {
                        name,
                        is_default,
                        sample_rate,
                        channels,
                    });
                }
            }
        }
        Err(e) => return Err(format!("Failed to enumerate input devices: {}", e)),
    }

    Ok(devices)
}

/// Tauri command: Start audio capture
#[tauri::command]
pub fn start_audio_capture(
    state: tauri::State<'_, AudioCaptureState>,
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

    // Spawn a thread to handle audio capture
    std::thread::spawn(move || {
        let host = match cpal::default_host() {
            h => h,
        };
        
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("No default input device available");
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let supported_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to get default config: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();
        let source_sample_rate = config.sample_rate.0;
        let source_channels = config.channels;

        let err_fn = |err| eprintln!("Audio stream error: {}", err);

        // Build the input stream based on sample format
        let stream: Result<Stream, String> = match sample_format {
            SampleFormat::I8 => {
                let buffer = audio_buffer.clone();
                let buffer_size = buffer_size.clone();
                let is_capturing = is_capturing.clone();
                
                device
                    .build_input_stream(
                        &config,
                        move |data: &[i8], _: &cpal::InputCallbackInfo| {
                            if !is_capturing.load(Ordering::SeqCst) {
                                return;
                            }
                            let samples: Vec<f32> = data.iter().map(|s| f32::from(*s)).collect();
                            process_audio(&buffer, &buffer_size, &samples, source_sample_rate, source_channels);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))
            }
            SampleFormat::I16 => {
                let buffer = audio_buffer.clone();
                let buffer_size = buffer_size.clone();
                let is_capturing = is_capturing.clone();
                
                device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if !is_capturing.load(Ordering::SeqCst) {
                                return;
                            }
                            let samples: Vec<f32> = data.iter().map(|s| f32::from(*s)).collect();
                            process_audio(&buffer, &buffer_size, &samples, source_sample_rate, source_channels);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))
            }
            SampleFormat::I32 => {
                let buffer = audio_buffer.clone();
                let buffer_size = buffer_size.clone();
                let is_capturing = is_capturing.clone();
                
                device
                    .build_input_stream(
                        &config,
                        move |data: &[i32], _: &cpal::InputCallbackInfo| {
                            if !is_capturing.load(Ordering::SeqCst) {
                                return;
                            }
                            let samples: Vec<f32> = data.iter().map(|s| *s as f32 / i32::MAX as f32).collect();
                            process_audio(&buffer, &buffer_size, &samples, source_sample_rate, source_channels);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))
            }
            SampleFormat::F32 => {
                let buffer = audio_buffer.clone();
                let buffer_size = buffer_size.clone();
                let is_capturing = is_capturing.clone();
                
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if !is_capturing.load(Ordering::SeqCst) {
                                return;
                            }
                            process_audio(&buffer, &buffer_size, data, source_sample_rate, source_channels);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))
            }
            format => Err(format!("Unsupported sample format: {:?}", format)),
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("Failed to start stream: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        // Keep the stream alive until we receive a stop signal
        // The stream will be dropped when this thread exits
        let _stream = stream;
        
        // Wait for stop signal
        let _ = stop_rx.recv();
        
        // Stream is dropped here, which stops audio capture
        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Process audio samples (mix to mono, resample, and buffer)
fn process_audio(
    buffer: &Arc<Mutex<Vec<f32>>>,
    buffer_size: &Arc<AtomicUsize>,
    samples: &[f32],
    source_sample_rate: u32,
    source_channels: u16,
) {
    // Mix to mono if stereo
    let mono_samples = if source_channels > 1 {
        samples
            .chunks(source_channels as usize)
            .map(|chunk| {
                let sum: f32 = chunk.iter().sum();
                sum / source_channels as f32
            })
            .collect::<Vec<_>>()
    } else {
        samples.to_vec()
    };

    // Resample to 16kHz if needed
    let resampled = if source_sample_rate != TARGET_SAMPLE_RATE {
        resample(&mono_samples, source_sample_rate, TARGET_SAMPLE_RATE)
    } else {
        mono_samples
    };

    // Add to buffer
    let mut buf = buffer.lock();
    buf.extend_from_slice(&resampled);
    buffer_size.store(buf.len(), Ordering::SeqCst);
}

/// Tauri command: Stop audio capture
#[tauri::command]
pub fn stop_audio_capture(state: tauri::State<'_, AudioCaptureState>) {
    state.is_capturing.store(false, Ordering::SeqCst);
    
    // Send stop signal to the audio thread
    if let Some(sender) = state.stop_sender.lock().take() {
        let _ = sender.send(());
    }
}

/// Tauri command: Check if audio is being captured
#[tauri::command]
pub fn is_audio_capturing(state: tauri::State<'_, AudioCaptureState>) -> bool {
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
pub fn get_audio_buffer_size(state: tauri::State<'_, AudioCaptureState>) -> usize {
    state.buffer_size.load(Ordering::SeqCst)
}

/// Tauri command: Flush all buffered audio
#[tauri::command]
pub fn flush_audio_buffer(state: tauri::State<'_, AudioCaptureState>) -> AudioChunk {
    let mut buffer = state.audio_buffer.lock();
    let samples: Vec<f32> = buffer.drain(..).collect();
    state.buffer_size.store(0, Ordering::SeqCst);
    
    let duration_ms = (samples.len() as f64 / TARGET_SAMPLE_RATE as f64 * 1000.0) as u32;
    
    AudioChunk {
        samples,
        duration_ms,
        sample_rate: TARGET_SAMPLE_RATE,
    }
}

/// Tauri command: Clear audio buffer
#[tauri::command]
pub fn clear_audio_buffer(state: tauri::State<'_, AudioCaptureState>) {
    state.audio_buffer.lock().clear();
    state.buffer_size.store(0, Ordering::SeqCst);
}