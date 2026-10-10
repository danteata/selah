//! Linux system audio capture: records what the default output is playing.
//!
//! cpal only speaks ALSA (and JACK) on Linux, and PulseAudio/PipeWire "monitor"
//! sources — the loopback of an output — are not ALSA devices, so searching
//! cpal's device list for "monitor" finds nothing on an ordinary desktop. This
//! talks to the sound server instead, through `libpulse-simple`, and records
//! from `@DEFAULT_MONITOR@`: the monitor of whatever the default output is.
//! PipeWire desktops serve the same API through pipewire-pulse.
//!
//! The library is loaded at run time, the same way the NDI runtime is, so the
//! app still starts on a machine without it; system audio is then reported as
//! unsupported.
//!
//! There is no real-time callback here: `pa_simple_read` blocks on this
//! module's own thread and the server buffers while we preprocess, so this
//! thread can resample and take the `audio_buffer` lock itself without
//! risking a dropout.

use libloading::Library;
use parking_lot::Mutex;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use super::types::*;

/// What we ask the server for. It converts from the monitor's own format; the
/// preprocessor then does the band-limited resample to 16 kHz, exactly as it
/// does for ScreenCaptureKit's 48 kHz stereo on macOS.
const SOURCE_RATE: u32 = 48_000;
const SOURCE_CHANNELS: u8 = 2;

/// Samples per read: 10 ms of stereo. Bounds both the stop latency and the
/// latency this backend adds.
const READ_SAMPLES: usize = (SOURCE_RATE as usize / 100) * SOURCE_CHANNELS as usize;

/// How long to wait before reconnecting, per attempt, after the server drops
/// the stream (a PipeWire restart, a sound-server crash). Running off the end
/// ends the capture.
const RECONNECT_BACKOFF: [Duration; 5] = [
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_millis(1000),
    Duration::from_millis(2000),
    Duration::from_millis(4000),
];

/// A stream that delivered for this long was good, so a later drop starts
/// from a full reconnect budget.
const STREAM_STABLE_AFTER: Duration = Duration::from_secs(30);

const LIBRARY_CANDIDATES: [&str; 2] = ["libpulse-simple.so.0", "libpulse-simple.so"];

// libpulse ABI. Values from <pulse/sample.h>, <pulse/def.h>.
const PA_SAMPLE_FLOAT32LE: c_int = 5;
const PA_STREAM_RECORD: c_int = 2;

#[repr(C)]
struct SampleSpec {
    format: c_int,
    rate: u32,
    channels: u8,
}

#[repr(C)]
struct BufferAttr {
    maxlength: u32,
    tlength: u32,
    prebuf: u32,
    minreq: u32,
    fragsize: u32,
}

type FnNew = unsafe extern "C" fn(
    server: *const c_char,
    name: *const c_char,
    dir: c_int,
    dev: *const c_char,
    stream_name: *const c_char,
    ss: *const SampleSpec,
    map: *const c_void,
    attr: *const BufferAttr,
    error: *mut c_int,
) -> *mut c_void;
type FnRead = unsafe extern "C" fn(s: *mut c_void, data: *mut c_void, bytes: usize, error: *mut c_int) -> c_int;
type FnFree = unsafe extern "C" fn(s: *mut c_void);
type FnStrerror = unsafe extern "C" fn(error: c_int) -> *const c_char;

struct PulseSimple {
    new: FnNew,
    read: FnRead,
    free: FnFree,
    strerror: FnStrerror,
    // Keeps the symbols above valid. Never unloaded.
    _library: Library,
}

fn pulse() -> Option<&'static PulseSimple> {
    static LIB: OnceLock<Option<PulseSimple>> = OnceLock::new();
    LIB.get_or_init(|| {
        for name in LIBRARY_CANDIDATES {
            // SAFETY: loading a system library runs its initialisers;
            // libpulse-simple's are benign.
            let Ok(library) = (unsafe { Library::new(name) }) else {
                continue;
            };
            // SAFETY: the signatures match <pulse/simple.h> and <pulse/error.h>.
            // `pa_strerror` lives in libpulse, which libpulse-simple links, and
            // dlsym on a handle searches its dependencies too.
            let bound = unsafe {
                (|| -> Result<PulseSimple, libloading::Error> {
                    Ok(PulseSimple {
                        new: *library.get::<FnNew>(b"pa_simple_new\0")?,
                        read: *library.get::<FnRead>(b"pa_simple_read\0")?,
                        free: *library.get::<FnFree>(b"pa_simple_free\0")?,
                        strerror: *library.get::<FnStrerror>(b"pa_strerror\0")?,
                        _library: library,
                    })
                })()
            };
            match bound {
                Ok(lib) => return Some(lib),
                Err(e) => tracing::warn!("[audio] {} is missing a symbol: {}", name, e),
            }
        }
        None
    })
    .as_ref()
}

impl PulseSimple {
    fn message(&self, error: c_int) -> String {
        // SAFETY: pa_strerror returns a static string, or null for an unknown code.
        let text = unsafe { (self.strerror)(error) };
        if text.is_null() {
            return format!("PulseAudio error {}", error);
        }
        // SAFETY: non-null, NUL-terminated and static.
        unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned()
    }
}

/// An open record stream on the default output's monitor.
struct MonitorStream {
    lib: &'static PulseSimple,
    handle: *mut c_void,
}

impl MonitorStream {
    fn open(lib: &'static PulseSimple) -> Result<Self, String> {
        let spec = SampleSpec {
            format: PA_SAMPLE_FLOAT32LE,
            rate: SOURCE_RATE,
            channels: SOURCE_CHANNELS,
        };
        // Ask for 10 ms fragments; `u32::MAX` leaves the rest at the server's
        // defaults. Without a fragsize the server may batch reads by seconds.
        let attr = BufferAttr {
            maxlength: u32::MAX,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
            fragsize: (READ_SAMPLES * std::mem::size_of::<f32>()) as u32,
        };
        let mut error: c_int = 0;
        // SAFETY: every pointer is valid for the call; strings are NUL-terminated.
        let handle = unsafe {
            (lib.new)(
                ptr::null(),
                c"Selah".as_ptr(),
                PA_STREAM_RECORD,
                c"@DEFAULT_MONITOR@".as_ptr(),
                c"System audio".as_ptr(),
                &spec,
                ptr::null(),
                &attr,
                &mut error,
            )
        };
        if handle.is_null() {
            return Err(format!(
                "Could not record the system audio monitor: {}",
                lib.message(error)
            ));
        }
        Ok(Self { lib, handle })
    }

    /// Fill `buf` completely, blocking until the server has that much.
    fn read(&mut self, buf: &mut [f32]) -> Result<(), String> {
        let mut error: c_int = 0;
        // SAFETY: `buf` is valid for `size_of_val(buf)` bytes, and the handle is
        // open until drop.
        let rc = unsafe {
            (self.lib.read)(
                self.handle,
                buf.as_mut_ptr().cast(),
                std::mem::size_of_val(buf),
                &mut error,
            )
        };
        if rc < 0 {
            return Err(self.lib.message(error));
        }
        Ok(())
    }
}

// SAFETY: a pa_simple handle may move between threads; it is only ever used
// from one at a time, which `&mut self` on `read` enforces.
unsafe impl Send for MonitorStream {}

impl Drop for MonitorStream {
    fn drop(&mut self) {
        // SAFETY: opened by pa_simple_new and freed exactly once.
        unsafe { (self.lib.free)(self.handle) }
    }
}

/// Whether system audio can be captured here: the sound-server library loads.
/// Whether the server is running is only known when a capture opens.
pub fn is_available() -> bool {
    pulse().is_some()
}

/// Start system audio capture on Linux.
pub fn start_system_audio_capture(
    is_capturing: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    buffer_size: Arc<AtomicUsize>,
    _sample_rate: Arc<Mutex<u32>>,
    stop_rx: Receiver<()>,
) -> Result<(), String> {
    let lib = pulse().ok_or_else(|| {
        "System audio capture needs PulseAudio or PipeWire (libpulse-simple was not found)"
            .to_string()
    })?;
    // Open once up front so a missing server fails the start command with a
    // reason, instead of a capture that silently never delivers.
    let first = MonitorStream::open(lib)?;

    std::thread::spawn(move || {
        let mut pre = AudioPreprocessor::new(SOURCE_RATE, SOURCE_CHANNELS as u16, None);
        let mut buf = vec![0.0f32; READ_SAMPLES];
        let mut stream = Some(first);
        let mut attempt = 0usize;

        'session: loop {
            let mut current = match stream.take() {
                Some(s) => s,
                None => match MonitorStream::open(lib) {
                    Ok(s) => {
                        tracing::info!("[audio] system audio monitor reopened");
                        s
                    }
                    Err(e) => {
                        tracing::warn!("[audio] {}", e);
                        if !back_off(&stop_rx, &mut attempt) {
                            break 'session;
                        }
                        continue 'session;
                    }
                },
            };

            let opened_at = std::time::Instant::now();
            loop {
                match stop_rx.try_recv() {
                    Ok(()) | Err(TryRecvError::Disconnected) => break 'session,
                    Err(TryRecvError::Empty) => {}
                }
                if !is_capturing.load(Ordering::SeqCst) {
                    break 'session;
                }
                if let Err(e) = current.read(&mut buf) {
                    tracing::warn!("[audio] system audio stream dropped: {}", e);
                    break;
                }
                append(&audio_buffer, &buffer_size, &pre.process(&buf));
            }

            drop(current);
            if opened_at.elapsed() >= STREAM_STABLE_AFTER {
                attempt = 0;
            }
            if !back_off(&stop_rx, &mut attempt) {
                break 'session;
            }
        }

        // The resampler's last partial block — the end of the last word.
        append(&audio_buffer, &buffer_size, &pre.flush());
        is_capturing.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Wait out this attempt's backoff. False when the capture should end: a stop
/// arrived, or the reconnect budget is spent.
fn back_off(stop_rx: &Receiver<()>, attempt: &mut usize) -> bool {
    let Some(wait) = RECONNECT_BACKOFF.get(*attempt).copied() else {
        tracing::error!("[audio] system audio could not be reopened; capture stopped");
        return false;
    };
    *attempt += 1;
    !matches!(
        stop_rx.recv_timeout(wait),
        Ok(()) | Err(RecvTimeoutError::Disconnected)
    )
}

fn append(audio_buffer: &Mutex<Vec<f32>>, buffer_size: &AtomicUsize, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let mut buffer = audio_buffer.lock();
    buffer.extend_from_slice(samples);
    buffer_size.store(buffer.len(), Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Opens the real monitor and reads a second of audio. Needs a running
    /// PulseAudio or PipeWire server, so it is ignored by default:
    /// `cargo test --no-default-features -- --ignored records_the_default_monitor`
    #[test]
    #[ignore]
    fn records_the_default_monitor() {
        let lib = pulse().expect("libpulse-simple loads");
        let mut stream = MonitorStream::open(lib).expect("monitor opens");
        let mut buf = vec![0.0f32; READ_SAMPLES];
        for _ in 0..100 {
            stream.read(&mut buf).expect("read succeeds");
        }
        assert!(buf.iter().all(|s| s.is_finite()));
    }

    /// The read size is whole stereo frames, so the preprocessor never sees a
    /// split frame.
    #[test]
    fn reads_are_whole_frames() {
        assert_eq!(READ_SAMPLES % SOURCE_CHANNELS as usize, 0);
    }
}
