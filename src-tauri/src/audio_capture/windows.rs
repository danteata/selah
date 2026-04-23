//! Windows system audio capture using WASAPI loopback
//!
//! Captures system audio (what's playing through speakers) using WASAPI loopback mode.
//! Based on the proven implementation from voicebox.
//!
//! Key design decisions:
//! - Uses `wasapi` crate for clean WASAPI abstraction
//! - COM objects created and used on a single dedicated thread (not Send)
//! - Event-driven capture with `EventsShared` mode for low latency
//! - `scopeguard` ensures COM cleanup even on panics

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::thread;

use wasapi::*;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use super::types::*;

/// Start system audio capture on Windows using WASAPI loopback
///
/// This captures the system audio output (what's playing through speakers/headphones).
/// Uses the default render device in loopback mode.
pub fn start_system_audio_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    // Spawn capture on a dedicated thread — WASAPI COM objects are not Send
    thread::spawn(move || {
        // Initialize COM for this thread
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            if hr.is_err() {
                eprintln!("[WASAPI] Failed to initialize COM: {:?}", hr);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        }

        // Ensure COM is uninitialized when thread exits (even on panic)
        let _com_guard = scopeguard::guard((), |_| unsafe {
            CoUninitialize();
        });

        // Get default render (output) device for loopback
        let device = match DeviceEnumerator::new()
            .and_then(|enumerator| enumerator.get_default_device(&Direction::Render))
        {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[WASAPI] Failed to get audio device: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let mut audio_client = match device.get_iaudioclient() {
            Ok(client) => client,
            Err(e) => {
                eprintln!("[WASAPI] Failed to get audio client: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let mix_format = match audio_client.get_mixformat() {
            Ok(format) => format,
            Err(e) => {
                eprintln!("[WASAPI] Failed to get mix format: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Extract format info
        let channels = mix_format.get_nchannels() as usize;
        let bytes_per_sample = (mix_format.get_bitspersample() / 8) as usize;
        let source_sample_rate = mix_format.get_samplespersec();

        // Store source sample rate for callers
        *sample_rate.lock() = source_sample_rate;

        println!(
            "[WASAPI] Device format: {}Hz, {} channels, {} bits/sample",
            source_sample_rate,
            channels,
            mix_format.get_bitspersample()
        );

        // Get device period (used for buffer sizing)
        let (_def_period, min_period) = match audio_client.get_device_period() {
            Ok(periods) => periods,
            Err(e) => {
                eprintln!("[WASAPI] Failed to get device period: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Initialize audio client for loopback capture
        // Key: get Render device + initialize with Capture direction = loopback mode
        let stream_mode = StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: min_period,
        };

        if let Err(e) =
            audio_client.initialize_client(&mix_format, &Direction::Capture, &stream_mode)
        {
            eprintln!("[WASAPI] Failed to initialize audio client: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        // Set up event handle for EventsShared mode
        let h_event = match audio_client.set_get_eventhandle() {
            Ok(event) => event,
            Err(e) => {
                eprintln!("[WASAPI] Failed to set event handle: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let capture_client = match audio_client.get_audiocaptureclient() {
            Ok(client) => client,
            Err(e) => {
                eprintln!("[WASAPI] Failed to get capture client: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = audio_client.start_stream() {
            eprintln!("[WASAPI] Failed to start stream: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        println!("[WASAPI] Loopback capture started");

        // Capture loop
        loop {
            // Check stop signal (non-blocking)
            if stop_rx.try_recv().is_ok() || !is_capturing.load(Ordering::SeqCst) {
                break;
            }

            // Try to get available audio data
            match capture_client.get_next_packet_size() {
                Ok(Some(frames_available)) => {
                    if frames_available > 0 {
                        let buf_size = frames_available as usize * channels * bytes_per_sample;
                        let mut buffer = vec![0u8; buf_size];

                        match capture_client.read_from_device(&mut buffer) {
                            Ok((frames_read, _buffer_info)) => {
                                if frames_read > 0 {
                                    let num_samples = frames_read as usize * channels;

                                    // Convert raw bytes to f32 samples
                                    let raw_samples: Vec<f32> = if bytes_per_sample == 4 {
                                        // 32-bit float (most common for WASAPI)
                                        (0..num_samples)
                                            .filter_map(|i| {
                                                let offset = i * 4;
                                                if offset + 4 <= buffer.len() {
                                                    Some(f32::from_le_bytes([
                                                        buffer[offset],
                                                        buffer[offset + 1],
                                                        buffer[offset + 2],
                                                        buffer[offset + 3],
                                                    ]))
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect()
                                    } else if bytes_per_sample == 2 {
                                        // 16-bit integer
                                        (0..num_samples)
                                            .filter_map(|i| {
                                                let offset = i * 2;
                                                if offset + 2 <= buffer.len() {
                                                    let sample = i16::from_le_bytes([
                                                        buffer[offset],
                                                        buffer[offset + 1],
                                                    ]);
                                                    Some(sample as f32 / i16::MAX as f32)
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect()
                                    } else {
                                        continue; // Skip unsupported formats
                                    };

                                    // Process: mix to mono + resample to 16kHz
                                    let processed = process_audio_samples(
                                        &raw_samples,
                                        source_sample_rate,
                                        channels as u16,
                                    );

                                    // Append to shared buffer
                                    let mut buf = audio_buffer.lock();
                                    buf.extend_from_slice(&processed);
                                    buffer_size.store(buf.len(), Ordering::SeqCst);
                                }
                            }
                            Err(e) => {
                                eprintln!("[WASAPI] Error reading from device: {}", e);
                            }
                        }
                    }
                }
                Ok(None) => {
                    // Exclusive mode — shouldn't happen with EventsShared
                }
                Err(e) => {
                    eprintln!("[WASAPI] Error getting next packet size: {}", e);
                }
            }

            // Wait for next event (with 100ms timeout to allow stop checks)
            if h_event.wait_for_event(100).is_err() {
                // Timeout is expected — just continue to check stop flag
            }
        }

        // Cleanup
        audio_client.stop_stream().ok();
        is_capturing.store(false, Ordering::SeqCst);
        println!("[WASAPI] Loopback capture stopped");
    });

    Ok(())
}
