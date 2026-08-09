//! Microphone capture using cpal (cross-platform)

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::types::*;

/// How long a rebuild waits before trying again, per attempt. A USB or
/// Bluetooth interface that has just dropped is usually not back within
/// milliseconds, and hammering `build_input_stream` on a device the OS is
/// still tearing down tends to fail the same way each time.
const REBUILD_BACKOFF: [Duration; 5] = [
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_millis(1000),
    Duration::from_millis(2000),
    Duration::from_millis(4000),
];

/// How often the supervisor wakes to check whether the stream has died. Only
/// the recovery latency depends on this — a stop signal wakes it immediately.
const SUPERVISOR_POLL: Duration = Duration::from_millis(250);

/// How long a stream has to survive before it counts as good and the rebuild
/// budget resets. Without this, a device that opens cleanly and dies a moment
/// later — which is exactly how a failing USB interface behaves — resets the
/// budget on every open and rebuilds forever at the poll interval, never
/// backing off and never reporting itself fatal.
const STREAM_STABLE_AFTER: Duration = Duration::from_secs(30);

/// Emitted on `capture-stream-error` when the input stream dies or is rebuilt.
///
/// This event exists because a dead stream is otherwise indistinguishable from
/// silence. The VAD thread keeps emitting the `audio-features` heartbeat
/// through delivery gaps on purpose (see `mod.rs`, where suppressing it caused
/// spurious restarts), so the frontend watchdog reads a stream that died at
/// 11:04 as a healthy, permanently silent room. Nothing else in the pipeline
/// can tell the operator their mic stopped.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStreamErrorEvent {
    /// The underlying cpal error, for the log and the banner detail line.
    pub message: String,
    /// 1-based rebuild attempt this event describes.
    pub attempt: u32,
    /// The stream was rebuilt and audio is flowing again.
    pub recovered: bool,
    /// Rebuilds are exhausted; capture has stopped and will not resume on its
    /// own. The frontend has to restart the session or tell the operator.
    pub fatal: bool,
}

/// Tauri command: List audio input devices
///
/// `async` + `spawn_blocking` rather than a plain sync command: enumerating
/// devices calls `default_input_config()` per device, and each of those is a
/// HAL query costing tens of milliseconds — worse on USB and Bluetooth. A sync
/// `#[tauri::command]` runs inline on the webview run loop, so on a desk with
/// an interface, a headset and a webcam attached this stalls the UI every time
/// the settings panel opens.
#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(enumerate_input_devices)
        .await
        .map_err(|e| format!("Device enumeration panicked: {}", e))?
}

fn enumerate_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
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

/// Resolve the configured device, falling back to the system default.
///
/// Resolved on every rebuild rather than captured once: when a USB interface
/// is unplugged and replugged the OS may hand back a different `Device` for
/// the same name, and the old handle stays dead forever.
fn resolve_device(device_name: Option<&str>) -> Option<Device> {
    let host = cpal::default_host();

    match device_name {
        Some(name) => host
            .input_devices()
            .map_err(|e| eprintln!("Failed to enumerate devices: {}", e))
            .ok()
            .and_then(|mut devices| devices.find(|d| d.name().map_or(false, |n| n == *name)))
            .or_else(|| {
                eprintln!("Device '{}' not found, falling back to default", name);
                host.default_input_device()
            }),
        None => host.default_input_device(),
    }
}

/// Build one input stream of sample type `T`, normalising via `convert`.
#[allow(clippy::too_many_arguments)]
fn build_stream<T>(
    device: &Device,
    config: &StreamConfig,
    convert: fn(T) -> f32,
    source_sample_rate: u32,
    source_channels: u16,
    selected_channel: Option<u16>,
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    stream_failed: Arc<AtomicBool>,
    failure_message: Arc<Mutex<String>>,
) -> Result<Stream, String>
where
    T: cpal::SizedSample + Send + 'static,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if !is_capturing.load(Ordering::SeqCst) {
                    return;
                }
                let samples: Vec<f32> = data.iter().copied().map(convert).collect();
                let processed = process_audio_samples_on_channel(
                    &samples,
                    source_sample_rate,
                    source_channels,
                    selected_channel,
                );
                let mut buf = audio_buffer.lock();
                buf.extend_from_slice(&processed);
                buffer_size.store(buf.len(), Ordering::SeqCst);
            },
            move |err| {
                // cpal calls this from the audio thread and the stream is dead
                // by the time it does; rebuilding has to happen elsewhere. Flag
                // it for the supervisor below and record why.
                eprintln!("Audio stream error: {}", err);
                *failure_message.lock() = err.to_string();
                stream_failed.store(true, Ordering::SeqCst);
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {}", e))
}

/// Open the device and start a stream, returning it alive and playing.
#[allow(clippy::too_many_arguments)]
fn open_stream(
    device_name: Option<&str>,
    selected_channel: Option<u16>,
    is_capturing: &Arc<AtomicBool>,
    audio_buffer: &Arc<Mutex<Vec<f32>>>,
    buffer_size: &Arc<AtomicUsize>,
    stream_failed: &Arc<AtomicBool>,
    failure_message: &Arc<Mutex<String>>,
) -> Result<Stream, String> {
    let device = resolve_device(device_name).ok_or_else(|| "No input device available".to_string())?;

    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default config: {}", e))?;

    let sample_format = supported_config.sample_format();
    let config: StreamConfig = supported_config.into();
    let source_sample_rate = config.sample_rate.0;
    let source_channels = config.channels;

    match selected_channel {
        Some(ch) if ch < source_channels => {
            println!("[audio] using input channel {} of {}", ch + 1, source_channels)
        }
        Some(ch) => eprintln!(
            "[audio] input channel {} is out of range for this {}-channel device; \
             averaging all channels instead",
            ch + 1,
            source_channels
        ),
        None => println!("[audio] averaging all {} input channels", source_channels),
    }

    macro_rules! build {
        ($t:ty, $conv:expr) => {
            build_stream::<$t>(
                &device,
                &config,
                $conv,
                source_sample_rate,
                source_channels,
                selected_channel,
                is_capturing.clone(),
                audio_buffer.clone(),
                buffer_size.clone(),
                stream_failed.clone(),
                failure_message.clone(),
            )
        };
    }

    let stream = match sample_format {
        SampleFormat::I8 => build!(i8, |s| s as f32 / 128.0),
        SampleFormat::I16 => build!(i16, |s| s as f32 / 32768.0),
        SampleFormat::I32 => build!(i32, |s| s as f32 / i32::MAX as f32),
        SampleFormat::F32 => build!(f32, |s| s),
        // F64 is typically already in [-1.0, 1.0], just cast to f32.
        SampleFormat::F64 => build!(f64, |s| s as f32),
        format => return Err(format!("Unsupported sample format: {:?}", format)),
    }?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    Ok(stream)
}

/// Start microphone capture in a background thread.
///
/// The thread supervises the stream rather than just holding it: cpal tears a
/// stream down when the device goes away (unplugged interface, Bluetooth
/// dropout, a sleeping USB hub), and previously that surfaced as one line on
/// stderr while `is_capturing` stayed true and the buffer silently stopped
/// filling. Mid-service that is a projector that quietly stops following.
pub fn start_microphone_capture(
    app: AppHandle,
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
    device_name: Option<String>,
    selected_channel: Option<u16>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let stream_failed = Arc::new(AtomicBool::new(false));
        let failure_message = Arc::new(Mutex::new(String::new()));
        // Consecutive rebuilds not yet separated by a stream that ran long
        // enough to count as good. Indexes REBUILD_BACKOFF; running off the end
        // is what makes a permanently absent device fatal instead of a loop.
        let mut attempt: u32 = 0;

        'session: loop {
            stream_failed.store(false, Ordering::SeqCst);

            let opened = open_stream(
                device_name.as_deref(),
                selected_channel,
                &is_capturing,
                &audio_buffer,
                &buffer_size,
                &stream_failed,
                &failure_message,
            );

            let stream = match opened {
                Ok(stream) => {
                    if attempt > 0 {
                        let message = failure_message.lock().clone();
                        println!("[audio] input stream reopened after {} attempt(s)", attempt);
                        let _ = app.emit(
                            "capture-stream-error",
                            CaptureStreamErrorEvent {
                                message,
                                attempt,
                                recovered: true,
                                fatal: false,
                            },
                        );
                    }
                    stream
                }
                Err(e) => {
                    eprintln!("[audio] {}", e);
                    *failure_message.lock() = e.clone();
                    attempt += 1;
                    if !report_and_back_off(&app, &stop_rx, e, attempt) {
                        break 'session;
                    }
                    continue 'session;
                }
            };

            // Park until stopped, or until the stream dies under us.
            let opened_at = std::time::Instant::now();
            let died = loop {
                match stop_rx.recv_timeout(SUPERVISOR_POLL) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => break false,
                    Err(RecvTimeoutError::Timeout) => {
                        if stream_failed.load(Ordering::SeqCst) {
                            break true;
                        }
                    }
                }
            };

            // Release the device before asking the host for it again — and
            // promptly on the stop path too.
            drop(stream);
            if !died {
                break 'session;
            }

            // A stream that ran for a while was genuinely good, so an unrelated
            // dropout an hour later starts from a full budget rather than
            // inheriting this morning's.
            if opened_at.elapsed() >= STREAM_STABLE_AFTER {
                attempt = 0;
            }
            attempt += 1;
            let message = failure_message.lock().clone();
            eprintln!(
                "[audio] input stream died ({}); rebuilding (attempt {})",
                message, attempt
            );
            if !report_and_back_off(&app, &stop_rx, message, attempt) {
                break 'session;
            }
        }

        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Report a failed stream and wait out this attempt's backoff.
///
/// Returns false when the session should end — either a stop arrived, or the
/// rebuild budget is exhausted and we should stop pretending capture is
/// running. In the latter case a `fatal` event goes out first, which is the
/// frontend's cue to restart the session or tell the operator.
fn report_and_back_off(
    app: &AppHandle,
    stop_rx: &Receiver<()>,
    message: String,
    attempt: u32,
) -> bool {
    let Some(backoff) = REBUILD_BACKOFF.get(attempt as usize - 1).copied() else {
        let _ = app.emit(
            "capture-stream-error",
            CaptureStreamErrorEvent {
                message,
                attempt,
                recovered: false,
                fatal: true,
            },
        );
        return false;
    };

    let _ = app.emit(
        "capture-stream-error",
        CaptureStreamErrorEvent {
            message,
            attempt,
            recovered: false,
            fatal: false,
        },
    );

    // Sleep in poll-sized slices so a stop during a 4 s backoff is still
    // honoured promptly.
    let mut waited = Duration::ZERO;
    while waited < backoff {
        let slice = SUPERVISOR_POLL.min(backoff - waited);
        match stop_rx.recv_timeout(slice) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => return false,
            Err(RecvTimeoutError::Timeout) => waited += slice,
        }
    }
    true
}
