//! macOS system audio capture using ScreenCaptureKit
//!
//! Requires macOS 12.3 or later.
//! Uses ScreenCaptureKit to capture system audio (what's playing through speakers).

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use screencapturekit::{
    output::CMSampleBuffer,
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration, content_filter::SCContentFilter,
        output_trait::SCStreamOutputTrait, output_type::SCStreamOutputType, SCStream,
    },
};

use core_foundation::error::CFError;

use super::types::*;

/// Start system audio capture on macOS
pub fn start_system_audio_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let content = match SCShareableContent::get() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to get shareable content: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        let displays = content.displays();
        if displays.is_empty() {
            eprintln!("No displays available");
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }
        let display = &displays[0];

        let filter = SCContentFilter::new().with_display_excluding_windows(display, &[]);

        let config = match build_stream_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to build stream config: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        struct AudioHandler {
            samples: Arc<Mutex<Vec<f32>>>,
            buffer_size: Arc<AtomicUsize>,
        }

        impl SCStreamOutputTrait for AudioHandler {
            fn did_output_sample_buffer(
                &self,
                sample: CMSampleBuffer,
                output_type: SCStreamOutputType,
            ) {
                if output_type == SCStreamOutputType::Audio {
                    if let Ok(audio_buffer_list) = sample.get_audio_buffer_list() {
                        let buffers = audio_buffer_list.buffers();
                        if let Ok(audio_samples) = extract_audio_from_buffers(buffers) {
                            let processed = process_audio_samples(&audio_samples, 48000, 2);

                            let mut samples_guard = self.samples.lock();
                            samples_guard.extend_from_slice(&processed);
                            self.buffer_size
                                .store(samples_guard.len(), Ordering::SeqCst);
                        }
                    }
                }
            }
        }

        let handler = AudioHandler {
            samples: audio_buffer.clone(),
            buffer_size: buffer_size.clone(),
        };

        let mut stream = SCStream::new(&filter, &config);

        stream.add_output_handler(handler, SCStreamOutputType::Audio);

        if let Err(e) = stream.start_capture() {
            eprintln!("Failed to start capture: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        let _ = stop_rx.recv();

        let _ = stream.stop_capture();
        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

fn build_stream_config() -> Result<SCStreamConfiguration, CFError> {
    let config = SCStreamConfiguration::new()
        .set_captures_audio(true)?
        .set_excludes_current_process_audio(false)?
        .set_sample_rate(48000)?
        .set_channel_count(2)?;
    Ok(config)
}

fn extract_audio_from_buffers(
    buffers: &[core_audio_types_rs::audio_buffer::AudioBuffer],
) -> Result<Vec<f32>, String> {
    let num_buffers = buffers.len();

    if num_buffers == 0 {
        return Ok(Vec::new());
    }

    if num_buffers == 1 {
        let buffer = &buffers[0];
        let data_bytes: &[u8] = buffer.data();
        let num_samples = data_bytes.len() / std::mem::size_of::<f32>();

        if num_samples > 0 {
            let data_ptr = data_bytes.as_ptr() as *const f32;
            unsafe {
                let data = std::slice::from_raw_parts(data_ptr, num_samples);
                return Ok(data.to_vec());
            }
        }
    } else {
        let mut channel_data: Vec<Vec<f32>> = Vec::new();
        let mut max_samples = 0;

        for buffer in buffers {
            let data_bytes: &[u8] = buffer.data();
            let num_samples = data_bytes.len() / std::mem::size_of::<f32>();

            if num_samples > 0 {
                let data_ptr = data_bytes.as_ptr() as *const f32;
                unsafe {
                    let data = std::slice::from_raw_parts(data_ptr, num_samples);
                    channel_data.push(data.to_vec());
                    max_samples = max_samples.max(num_samples);
                }
            }
        }

        let mut interleaved = Vec::with_capacity(max_samples * num_buffers);
        for i in 0..max_samples {
            for channel in &channel_data {
                if i < channel.len() {
                    interleaved.push(channel[i]);
                } else {
                    interleaved.push(0.0);
                }
            }
        }

        return Ok(interleaved);
    }

    Ok(Vec::new())
}

// Screen Recording (a.k.a. "Screen & System Audio Recording" on macOS 15+) is a
// TCC-gated permission. The system consent prompt is shown ONLY ONCE, ever — if
// the user declines or dismisses it, macOS records the denial and never prompts
// again. ScreenCaptureKit then fails every call with "The user declined TCCs
// for application, window, display capture". The only recovery is for the user
// to enable it manually in System Settings.
//
// These two CoreGraphics APIs are the canonical, crash-free way to work with
// that grant (unlike calling SCShareableContent::get(), which triggers the
// one-shot prompt as a side effect):
//   - CGPreflightScreenCaptureAccess: returns the current grant WITHOUT prompting.
//   - CGRequestScreenCaptureAccess: shows the prompt the first time; once denied,
//     returns false immediately without prompting. Available on macOS 10.15+.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether Screen & System Audio Recording permission is currently granted.
/// Does NOT prompt — safe to call on every start attempt.
pub fn screen_capture_access_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Ask the OS for Screen & System Audio Recording permission. Shows the system
/// prompt the FIRST time only; once the user has denied it this returns false
/// immediately without prompting. Returns whether access is granted afterwards.
pub fn request_screen_capture_access() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}
