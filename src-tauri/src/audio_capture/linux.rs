//! Linux audio capture (placeholder for now)
//!
//! Linux system audio capture would require PulseAudio or PipeWire.
//! For now, we only support microphone capture via cpal.

use parking_lot::Mutex;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use super::types::*;

/// Start system audio capture on Linux (not implemented yet)
pub fn start_system_audio_capture(
    is_capturing: Arc<std::sync::atomic::AtomicBool>,
    _audio_buffer: Arc<Mutex<Vec<f32>>>,
    _buffer_size: Arc<std::sync::atomic::AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    _stop_rx: Receiver<()>,
) -> Result<(), String> {
    // Linux system audio capture requires PulseAudio monitor source or PipeWire
    // This is not implemented yet
    is_capturing.store(false, Ordering::SeqCst);
    Err("Linux system audio capture is not implemented yet. Use microphone capture instead.".to_string())
}

/// Check if we can capture system audio on Linux
#[tauri::command]
pub fn check_system_audio_permission() -> bool {
    false
}
