//! macOS system audio capture using ScreenCaptureKit
//!
//! Requires macOS 12.3 or later.
//! Uses ScreenCaptureKit to capture system audio (what's playing through speakers).

use parking_lot::Mutex;
use rtrb::Producer;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
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

use super::ring::{
    capture_ring_for, drain_ring, finish_ring, push_frames, push_planar, DRAIN_INTERVAL,
    MAX_PLANES,
};
use super::types::*;

/// What `build_stream_config` asks ScreenCaptureKit for.
const SOURCE_RATE: u32 = 48_000;
const SOURCE_CHANNELS: u16 = 2;

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

        /// Runs on ScreenCaptureKit's queue, so it only copies samples into
        /// the capture ring (see `ring.rs`). It used to resample and then take
        /// the `audio_buffer` lock the readers also take, on that queue.
        struct AudioHandler {
            /// ScreenCaptureKit hands us `&self`, so the producer needs a
            /// lock. Only this callback ever takes it, and with `try_lock`, so
            /// the callback can never wait on it.
            producer: Mutex<Producer<f32>>,
            overrun_samples: Arc<AtomicU64>,
        }

        impl SCStreamOutputTrait for AudioHandler {
            fn did_output_sample_buffer(
                &self,
                sample: CMSampleBuffer,
                output_type: SCStreamOutputType,
            ) {
                if output_type != SCStreamOutputType::Audio {
                    return;
                }
                let Ok(audio_buffer_list) = sample.get_audio_buffer_list() else {
                    return;
                };
                let Some(mut producer) = self.producer.try_lock() else {
                    return;
                };
                let dropped = push_buffers(&mut producer, audio_buffer_list.buffers());
                if dropped > 0 {
                    self.overrun_samples.fetch_add(dropped as u64, Ordering::Relaxed);
                }
            }
        }

        let (producer, mut consumer) = capture_ring_for(SOURCE_RATE, SOURCE_CHANNELS);
        let overrun_samples = Arc::new(AtomicU64::new(0));
        let handler = AudioHandler {
            producer: Mutex::new(producer),
            overrun_samples: overrun_samples.clone(),
        };
        let mut pre = AudioPreprocessor::new(SOURCE_RATE, SOURCE_CHANNELS, None);

        let mut stream = SCStream::new(&filter, &config);

        stream.add_output_handler(handler, SCStreamOutputType::Audio);

        if let Err(e) = stream.start_capture() {
            eprintln!("Failed to start capture: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        let mut overrun_reported = false;
        loop {
            match stop_rx.recv_timeout(DRAIN_INTERVAL) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {
                    drain_ring(&mut consumer, &mut pre, &audio_buffer, &buffer_size);
                    let dropped = overrun_samples.load(Ordering::Relaxed);
                    if dropped > 0 && !overrun_reported {
                        overrun_reported = true;
                        tracing::warn!(
                            "[audio] system capture fell behind; the ring overflowed and \
                             {} samples were dropped",
                            dropped
                        );
                    }
                }
            }
        }

        let _ = stream.stop_capture();
        finish_ring(&mut consumer, &mut pre, &audio_buffer, &buffer_size);
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

/// Queue one ScreenCaptureKit delivery into the ring, interleaving it if it
/// arrived planar (one buffer per channel), and return how many samples did
/// not fit. No allocation: the planes are gathered on the stack.
fn push_buffers(
    producer: &mut Producer<f32>,
    buffers: &[core_audio_types_rs::audio_buffer::AudioBuffer],
) -> usize {
    match buffers {
        [] => 0,
        // One buffer: already interleaved at the configured channel count.
        [buffer] => push_frames(producer, as_f32(buffer.data()), SOURCE_CHANNELS as usize, |s| s),
        planar => {
            let mut planes: [&[f32]; MAX_PLANES] = [&[]; MAX_PLANES];
            let count = planar.len().min(MAX_PLANES);
            for (plane, buffer) in planes.iter_mut().zip(planar) {
                *plane = as_f32(buffer.data());
            }
            // The preprocessor was built for `SOURCE_CHANNELS`; frames of any
            // other width would misalign it, so extra planes are left out.
            let used = count.min(SOURCE_CHANNELS as usize);
            push_planar(producer, &planes[..used])
        }
    }
}

/// Reinterpret a Core Audio buffer as the f32 samples ScreenCaptureKit
/// delivers. A trailing partial sample, if any, is ignored.
fn as_f32(bytes: &[u8]) -> &[f32] {
    let len = bytes.len() / std::mem::size_of::<f32>();
    if len == 0 {
        return &[];
    }
    // SAFETY: Core Audio buffers are allocated with at least f32 alignment,
    // and `len` samples lie within `bytes`. The slice borrows `bytes`.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const f32, len) }
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
