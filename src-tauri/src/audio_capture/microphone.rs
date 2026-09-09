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

/// How long a freshly opened stream may go without delivering a single
/// callback before it is treated as dead and rebuilt.
///
/// `stream.play()` returning does not mean the device is producing audio. A
/// Bluetooth headset negotiating a profile, a USB interface still powering up,
/// or a host that hands back a stream for a device that has quietly gone away
/// can all open cleanly and then deliver nothing, ever. Without this check
/// that state is invisible: cpal's error callback never fires, so
/// `stream_failed` stays false, `is_capturing` stays true, and the operator
/// gets a "listening" UI in front of a silent room — the exact failure the
/// rebuild supervisor was written to eliminate, arriving through the one door
/// it did not cover.
///
/// Five seconds is chosen to sit above a cold USB interface's start-up, which
/// is normally well under a second and occasionally a second or two, and well
/// below the point where an operator concludes the software is broken.
const FIRST_SAMPLE_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// The microphone the operator had chosen, when it was confirmed missing
    /// and the system default was used instead.
    ///
    /// Only ever set when enumeration succeeded — a backend error that makes
    /// every device momentarily invisible must not be reported as the
    /// operator's interface having vanished. The frontend clears the saved
    /// preference on this, so a false positive would silently discard a real
    /// choice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fell_back_from: Option<String>,
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
/// What resolving the operator's microphone preference actually produced.
pub struct ResolvedDevice {
    pub device: Option<Device>,
    /// Set only when enumeration *succeeded* and confirmed the named device is
    /// gone, so the caller may safely forget the preference.
    ///
    /// Left `None` when enumeration itself failed. That distinction is the
    /// whole point: a backend hiccup makes every device look missing for a
    /// moment, and treating that as "your interface is gone" would erase a
    /// preference the operator set deliberately — on a machine where the device
    /// is sitting right there, plugged in. Taken from Handy's #1874, which
    /// makes the same distinction for the same reason.
    pub unavailable: Option<String>,
}

fn resolve_device(device_name: Option<&str>) -> ResolvedDevice {
    let host = cpal::default_host();

    let Some(name) = device_name else {
        return ResolvedDevice { device: host.default_input_device(), unavailable: None };
    };

    let enumerated = match host.input_devices() {
        Ok(devices) => devices,
        Err(e) => {
            // Transient as far as we can tell. Fall back so the service keeps
            // running, but say nothing about the preference.
            eprintln!("[audio] failed to enumerate devices: {}", e);
            return ResolvedDevice { device: host.default_input_device(), unavailable: None };
        }
    };

    let mut devices = enumerated;
    if let Some(found) = devices.find(|d| d.name().map_or(false, |n| n == *name)) {
        return ResolvedDevice { device: Some(found), unavailable: None };
    }

    eprintln!("[audio] device '{}' not found, falling back to default", name);
    ResolvedDevice {
        device: host.default_input_device(),
        unavailable: Some(name.to_string()),
    }
}

/// Build one input stream of sample type `T`, normalising via `convert`.
#[allow(clippy::too_many_arguments)]
fn build_stream<T>(
    device: &Device,
    config: &StreamConfig,
    convert: fn(T) -> f32,
    pre: Arc<Mutex<AudioPreprocessor>>,
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    stream_failed: Arc<AtomicBool>,
    failure_message: Arc<Mutex<String>>,
    saw_samples: Arc<AtomicBool>,
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
                // The device is delivering. Recorded before any processing:
                // the question this answers is whether the host is handing us
                // callbacks, not whether they contained speech or even
                // survived the resampler's block buffering.
                saw_samples.store(true, Ordering::Relaxed);
                let samples: Vec<f32> = data.iter().copied().map(convert).collect();
                // Shared with the supervisor so the tail still inside the
                // resampler can be flushed once the stream is down; see
                // `start_microphone_capture`. One more uncontended lock on a
                // thread that already takes `audio_buffer` below.
                let processed = pre.lock().process(&samples);
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
    // Set when the named device was confirmed absent and the default was used
    // instead; left alone when enumeration failed.
    fell_back_from: &Arc<Mutex<Option<String>>>,
    failure_message: &Arc<Mutex<String>>,
    saw_samples: &Arc<AtomicBool>,
) -> Result<(Stream, Arc<Mutex<AudioPreprocessor>>), String> {
    let resolved = resolve_device(device_name);
    if let Some(missing) = resolved.unavailable.as_deref() {
        *fell_back_from.lock() = Some(missing.to_string());
    }
    let device = resolved
        .device
        .ok_or_else(|| "No input device available".to_string())?;

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

    // One per stream, and rebuilt with the stream: a different device or rate
    // needs fresh resampler and highpass state, not the previous device's.
    let pre = Arc::new(Mutex::new(AudioPreprocessor::new(
        source_sample_rate,
        source_channels,
        selected_channel,
    )));

    macro_rules! build {
        ($t:ty, $conv:expr) => {
            build_stream::<$t>(
                &device,
                &config,
                $conv,
                pre.clone(),
                is_capturing.clone(),
                audio_buffer.clone(),
                buffer_size.clone(),
                stream_failed.clone(),
                failure_message.clone(),
                saw_samples.clone(),
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

    Ok((stream, pre))
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
        // Set by the capture callback the first time this device hands us a
        // chunk. Cleared per stream, immediately before each open.
        let saw_samples = Arc::new(AtomicBool::new(false));
        // Reported once per fallback rather than per rebuild attempt: a device
        // that stays unplugged resolves to the default on every retry, and a
        // banner per attempt would be noise during a service.
        let fell_back_from: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let mut reported_fallback: Option<String> = None;
        // Consecutive rebuilds not yet separated by a stream that ran long
        // enough to count as good. Indexes REBUILD_BACKOFF; running off the end
        // is what makes a permanently absent device fatal instead of a loop.
        let mut attempt: u32 = 0;

        'session: loop {
            stream_failed.store(false, Ordering::SeqCst);
            saw_samples.store(false, Ordering::SeqCst);

            let opened = open_stream(
                device_name.as_deref(),
                selected_channel,
                &is_capturing,
                &audio_buffer,
                &buffer_size,
                &stream_failed,
                &fell_back_from,
                &failure_message,
                &saw_samples,
            );

            let (stream, pre) = match opened {
                Ok((stream, pre)) => {
                    // Announce a confirmed fallback once, on the open that
                    // actually succeeded — the frontend clears the saved
                    // preference on this, and doing that before we know the
                    // replacement works would leave the operator with neither.
                    let fallback = fell_back_from.lock().take();
                    if let Some(missing) = fallback {
                        if reported_fallback.as_deref() != Some(missing.as_str()) {
                            println!(
                                "[audio] '{}' is unavailable; capturing from the default device",
                                missing
                            );
                            let _ = app.emit(
                                "capture-stream-error",
                                CaptureStreamErrorEvent {
                                    message: format!(
                                        "\"{}\" is no longer available. Selah switched to the default microphone.",
                                        missing
                                    ),
                                    attempt,
                                    recovered: true,
                                    fatal: false,
                                    fell_back_from: Some(missing.clone()),
                                },
                            );
                            reported_fallback = Some(missing);
                        }
                    } else if attempt > 0 {
                        let message = failure_message.lock().clone();
                        println!("[audio] input stream reopened after {} attempt(s)", attempt);
                        let _ = app.emit(
                            "capture-stream-error",
                            CaptureStreamErrorEvent {
                                message,
                                attempt,
                                recovered: true,
                                fatal: false,
                                fell_back_from: None,
                            },
                        );
                    }
                    (stream, pre)
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

            // Park until stopped, or until the stream dies under us — either
            // because cpal said so, or because it never started delivering.
            let opened_at = std::time::Instant::now();
            let mut silent_open = false;
            let died = loop {
                match stop_rx.recv_timeout(SUPERVISOR_POLL) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => break false,
                    Err(RecvTimeoutError::Timeout) => {
                        if stream_failed.load(Ordering::SeqCst) {
                            break true;
                        }
                        // Polling a flag the callback sets, rather than waiting
                        // on a readiness signal the callback sends, is what
                        // keeps this free of the stale-signal race: there is no
                        // in-flight notification that can outlive the stream it
                        // describes and report a dead device ready.
                        if !saw_samples.load(Ordering::SeqCst)
                            && opened_at.elapsed() >= FIRST_SAMPLE_TIMEOUT
                        {
                            silent_open = true;
                            break true;
                        }
                    }
                }
            };

            // Release the device before asking the host for it again — and
            // promptly on the stop path too.
            drop(stream);

            // The stream is down, so cpal is done calling the callback and
            // this is the only remaining holder: the resampler's last partial
            // block and its delay line can come out safely. Without this the
            // final 10-20 ms of every capture stays inside the resampler and
            // is dropped with it — the end of the last word for a dictation
            // or a voice search, which stop the stream once per utterance.
            //
            // Done on the rebuild path too, not just on stop: that audio was
            // recorded before the device died and belongs ahead of the gap.
            let tail = pre.lock().flush();
            if !tail.is_empty() {
                let mut buf = audio_buffer.lock();
                buf.extend_from_slice(&tail);
                buffer_size.store(buf.len(), Ordering::SeqCst);
            }

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
            // A stream that opened and stayed silent leaves nothing in
            // `failure_message` — cpal never reported an error, which is the
            // whole problem — so say what actually happened rather than
            // emitting a banner with an empty detail line.
            if silent_open {
                *failure_message.lock() = format!(
                    "Device opened but delivered no audio within {}s",
                    FIRST_SAMPLE_TIMEOUT.as_secs()
                );
            }
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
                fell_back_from: None,
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
            fell_back_from: None,
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

#[cfg(test)]
mod supervisor_policy_tests {
    use super::{FIRST_SAMPLE_TIMEOUT, REBUILD_BACKOFF, STREAM_STABLE_AFTER, SUPERVISOR_POLL};

    /// A stream killed for delivering nothing must not also count as having
    /// "run long enough to be good".
    ///
    /// The rebuild budget resets whenever a stream survives
    /// `STREAM_STABLE_AFTER`. If the silence timeout were the longer of the
    /// two, a device that opens cleanly and never delivers would reset the
    /// budget on every cycle: rebuild forever, never back off past the first
    /// step, never report itself fatal, and never tell the operator. That is
    /// the exact loop `STREAM_STABLE_AFTER` exists to prevent, reintroduced
    /// through the silent-open path.
    #[test]
    fn a_silent_stream_cannot_reset_the_rebuild_budget() {
        assert!(
            FIRST_SAMPLE_TIMEOUT < STREAM_STABLE_AFTER,
            "silence timeout {FIRST_SAMPLE_TIMEOUT:?} must be under the \
             stable-stream threshold {STREAM_STABLE_AFTER:?}"
        );
    }

    /// The supervisor only tests for silence when its poll wakes it, so a
    /// timeout below the poll interval would be rounded up unpredictably.
    #[test]
    fn the_supervisor_polls_often_enough_to_observe_the_timeout() {
        assert!(FIRST_SAMPLE_TIMEOUT > SUPERVISOR_POLL);
    }

    /// Rebuilds have to be finite, or the fatal event never fires.
    #[test]
    fn the_rebuild_budget_is_bounded() {
        assert!(!REBUILD_BACKOFF.is_empty());
    }
}
