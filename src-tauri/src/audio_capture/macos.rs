//! macOS system audio capture using ScreenCaptureKit
//!
//! Requires macOS 12.3 or later.
//! Uses ScreenCaptureKit to capture system audio (what's playing through speakers).

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use screencapturekit::{
    cm::CMSampleBuffer,
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration,
        content_filter::SCContentFilter,
        output_trait::SCStreamOutputTrait,
        output_type::SCStreamOutputType,
        sc_stream::SCStream,
    },
};

use super::types::*;

/// Start system audio capture on macOS
pub fn start_system_audio_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    // Spawn the capture on a dedicated thread
    std::thread::spawn(move || {
        // Get shareable content
        let content = match SCShareableContent::get() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to get shareable content: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Get first display
        let displays = content.displays();
        if displays.is_empty() {
            eprintln!("No displays available");
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }
        let display = &displays[0];

        // Create content filter for desktop audio
        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        // Create stream configuration - audio only
        let mut config = SCStreamConfiguration::default();
        config.set_captures_audio(true);
        config.set_excludes_current_process_audio(false);
        config.set_sample_rate(48000); // macOS typically uses 48kHz
        config.set_channel_count(2);

        // Create output handler struct
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
                    if let Ok(audio_samples) = extract_audio_samples(sample) {
                        // Process samples (resample to 16kHz mono)
                        let processed = process_audio_samples(&audio_samples, 48000, 2);
                        
                        let mut samples_guard = self.samples.lock();
                        samples_guard.extend_from_slice(&processed);
                        self.buffer_size.store(samples_guard.len(), Ordering::SeqCst);
                    }
                }
            }
        }

        let handler = AudioHandler {
            samples: audio_buffer.clone(),
            buffer_size: buffer_size.clone(),
        };

        // Create stream
        let mut stream = SCStream::new(&filter, &config);
        
        // Add output handler for audio
        stream.add_output_handler(handler, SCStreamOutputType::Audio);

        // Start capture
        if let Err(e) = stream.start_capture() {
            eprintln!("Failed to start capture: {}", e);
            is_capturing.store(false, Ordering::SeqCst);
            return;
        }

        // Wait for stop signal
        let _ = stop_rx.recv();

        // Stop capture
        let _ = stream.stop_capture();
        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Extract audio samples from CMSampleBuffer
fn extract_audio_samples(sample_buffer: CMSampleBuffer) -> Result<Vec<f32>, String> {
    // Use the crate's built-in method to get audio buffer list
    let audio_buffer_list = sample_buffer
        .audio_buffer_list()
        .ok_or_else(|| "Failed to get audio buffer list".to_string())?;

    let buffers: Vec<_> = audio_buffer_list.iter().collect();
    let num_buffers = buffers.len();
    
    if num_buffers == 0 {
        return Ok(Vec::new());
    }

    // ScreenCaptureKit on macOS provides audio in Float32 format
    // The audio can be either:
    // - Interleaved (1 buffer with L,R,L,R,... samples)
    // - Planar (2 buffers, one for L channel, one for R channel)
    
    if num_buffers == 1 {
        // Interleaved stereo or mono in a single buffer
        let buffer = &buffers[0];
        let data_bytes = buffer.data();
        let num_samples = data_bytes.len() / std::mem::size_of::<f32>();
        
        if num_samples > 0 {
            unsafe {
                let data_ptr = data_bytes.as_ptr() as *const f32;
                let data = std::slice::from_raw_parts(data_ptr, num_samples);
                return Ok(data.to_vec());
            }
        }
    } else {
        // Planar format - separate buffer for each channel
        // We need to interleave them: L0, R0, L1, R1, ...
        let mut channel_data: Vec<Vec<f32>> = Vec::new();
        let mut max_samples = 0;
        
        for buffer in &buffers {
            let data_bytes = buffer.data();
            let num_samples = data_bytes.len() / std::mem::size_of::<f32>();
            
            if num_samples > 0 {
                unsafe {
                    let data_ptr = data_bytes.as_ptr() as *const f32;
                    let data = std::slice::from_raw_parts(data_ptr, num_samples);
                    channel_data.push(data.to_vec());
                    max_samples = max_samples.max(num_samples);
                }
            }
        }
        
        // Interleave the channels
        let mut interleaved = Vec::with_capacity(max_samples * num_buffers);
        for i in 0..max_samples {
            for channel in &channel_data {
                if i < channel.len() {
                    interleaved.push(channel[i]);
                } else {
                    interleaved.push(0.0); // Pad with silence if needed
                }
            }
        }
        
        return Ok(interleaved);
    }

    Ok(Vec::new())
}

/// Check if ScreenCaptureKit is available (macOS 12.3+)
#[tauri::command]
pub fn check_screen_capture_permission() -> bool {
    // Try to get shareable content - this will prompt for permission if needed
    SCShareableContent::get().is_ok()
}
