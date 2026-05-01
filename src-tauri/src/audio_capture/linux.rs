use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use super::types::*;

/// Start system audio capture on Linux using loopback monitor device
pub fn start_system_audio_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    // Spawn a thread to handle audio capture
    std::thread::spawn(move || {
        let host = cpal::default_host();

        // On Linux with PulseAudio/PipeWire, loopback/system audio is usually
        // a "monitor" source. cpal doesn't have a direct "loopback" API for Linux,
        // so we search for a device with "monitor" in its name.
        let device = match host.input_devices() {
            Ok(devices) => devices.into_iter().find(|d| {
                d.name()
                    .map(|n| n.to_lowercase().contains("monitor"))
                    .unwrap_or(false)
            }),
            Err(_) => None,
        };

        let device = match device {
            Some(d) => d,
            None => {
                // If no monitor device found, try default input as a fallback
                // or just fail if we strictly want system audio.
                // For now, let's fail to be clear it's not working as intended.
                eprintln!("No Linux monitor (loopback) device found");
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let supported_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to get monitor device config: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();
        let source_sample_rate = config.sample_rate.0;
        let source_channels = config.channels;

        let err_fn = |err| eprintln!("Monitor audio stream error: {}", err);

        let stream: Result<Stream, String> = match sample_format {
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
                            let processed =
                                process_audio_samples(data, source_sample_rate, source_channels);
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build monitor stream: {}", e))
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
                            let samples: Vec<f32> =
                                data.iter().map(|s| f32::from(*s) / 32768.0).collect();
                            let processed = process_audio_samples(
                                &samples,
                                source_sample_rate,
                                source_channels,
                            );
                            let mut buf = buffer.lock();
                            buf.extend_from_slice(&processed);
                            buffer_size.store(buf.len(), Ordering::SeqCst);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build monitor stream: {}", e))
            }
            _ => Err("Unsupported sample format for Linux monitor capture".to_string()),
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
            eprintln!("Failed to start monitor stream: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        let _stream = stream;
        let _ = stop_rx.recv();
        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Check if we can capture system audio on Linux
#[tauri::command]
pub fn check_system_audio_permission() -> bool {
    // On Linux, we generally don't have a high-level permission check like macOS
    // If we can list devices, we probably have permission.
    true
}
