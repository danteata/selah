//! Microphone capture using cpal (cross-platform)

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use super::types::*;

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
                        device_type: DeviceType::Input,
                    });
                }
            }
        }
        Err(e) => return Err(format!("Failed to enumerate input devices: {}", e)),
    }

    Ok(devices)
}

/// Start microphone capture in a background thread
pub fn start_microphone_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
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
                            let processed = process_audio_samples(&samples, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
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
                            let processed = process_audio_samples(&samples, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
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
                            let processed = process_audio_samples(&samples, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
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
                            let processed = process_audio_samples(data, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build input stream: {}", e))
            }
            SampleFormat::F64 => {
                let buffer = audio_buffer.clone();
                let buffer_size = buffer_size.clone();
                let is_capturing = is_capturing.clone();
                
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f64], _: &cpal::InputCallbackInfo| {
                            if !is_capturing.load(Ordering::SeqCst) {
                                return;
                            }
                            let samples: Vec<f32> = data.iter().map(|s| *s as f32).collect();
                            let processed = process_audio_samples(&samples, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
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
