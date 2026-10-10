/*!
 * Pushed NDI channels — sources fed by frames the app renders itself.
 *
 * The program output is captured from the live output window (see `capture.rs`,
 * `capture_windows.rs`, `capture_linux.rs`). That works for slides, but it can't
 * carry transparency: an OS window capture hands back composited, opaque pixels.
 * A lower third keyed over camera video needs real alpha, so the graphics channel
 * renders to a canvas in the app and pushes those frames straight through here.
 *
 * That also means a graphics channel needs no window at all, and behaves the same
 * on every platform because it never touches a capture API.
 *
 * Channels are keyed by an id chosen by the frontend, so several can run at once
 * (program output plus one or more graphics feeds), each its own NDI source with
 * its own frame counter and timecodes.
 *
 * Pacing (filmcraft's playback design, MIT OR Apache-2.0, ArtCraft Team and the
 * FilmCraft contributors): `send_frame` only drops the frame into a one-slot
 * mailbox and returns, so the IPC command never waits on NDI. A thread per
 * channel sends at the channel's frame rate — the newest frame when there is
 * one, otherwise the last frame again — so receivers see a steady source
 * however irregularly the app draws. A frame replaced in the mailbox before it
 * was sent counts as dropped; that, repeats and late ticks are what `stats`
 * reports.
 */

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex, RwLock};

use super::ndi_lib::FOURCC_RGBA;
use super::sender::NdiSender;
use super::types::{NdiOutputConfig, PushStats};

/// Frames arrive as RGBA from a canvas: 4 bytes per pixel, no padding.
const BYTES_PER_PIXEL: usize = 4;

/// The rate a channel is announced at when the caller doesn't say.
pub const DEFAULT_FPS: u32 = 30;

/// How long the pacing thread waits for a first frame before checking whether
/// it has been told to stop.
const IDLE_WAIT: Duration = Duration::from_millis(100);

/// One RGBA frame, tightly packed.
pub struct Frame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
struct Counters {
    submitted: AtomicU64,
    sent: AtomicU64,
    replaced_unsent: AtomicU64,
    repeated: AtomicU64,
    late_ticks: AtomicU64,
}

/// The single-slot handoff between the IPC command and the pacing thread.
/// Holding one frame is the backpressure: the app can never queue more.
#[derive(Default)]
pub struct Mailbox {
    slot: Mutex<Option<Frame>>,
    ready: Condvar,
    counters: Counters,
}

impl Mailbox {
    /// Leave `frame` for the next tick, replacing (and counting as dropped) any
    /// frame still waiting.
    pub fn put(&self, frame: Frame) {
        let mut slot = self.slot.lock();
        if slot.replace(frame).is_some() {
            self.counters.replaced_unsent.fetch_add(1, Ordering::Relaxed);
        }
        self.counters.submitted.fetch_add(1, Ordering::Relaxed);
        self.ready.notify_one();
    }

    /// The waiting frame, if any.
    pub fn take(&self) -> Option<Frame> {
        self.slot.lock().take()
    }

    /// The waiting frame, waiting up to `timeout` for one.
    fn wait(&self, timeout: Duration) -> Option<Frame> {
        let mut slot = self.slot.lock();
        if slot.is_none() {
            self.ready.wait_for(&mut slot, timeout);
        }
        slot.take()
    }

    fn wake(&self) {
        self.ready.notify_all();
    }

    pub fn stats(&self, fps: u32) -> PushStats {
        let c = &self.counters;
        PushStats {
            submitted: c.submitted.load(Ordering::Relaxed),
            sent: c.sent.load(Ordering::Relaxed),
            replaced_unsent: c.replaced_unsent.load(Ordering::Relaxed),
            repeated: c.repeated.load(Ordering::Relaxed),
            late_ticks: c.late_ticks.load(Ordering::Relaxed),
            fps,
        }
    }
}

/// The frame a tick sends: the newest one when there is one, otherwise the
/// last again. Returns whether it was a repeat; None before any frame at all.
fn next_frame<'a>(mailbox: &Mailbox, last: &'a mut Option<Frame>, wait: Duration) -> Option<(&'a Frame, bool)> {
    let fresh = if last.is_none() { mailbox.wait(wait) } else { mailbox.take() };
    let repeated = fresh.is_none();
    if let Some(frame) = fresh {
        *last = Some(frame);
    }
    last.as_ref().map(|frame| (frame, repeated))
}

/// The pacing loop: one send per frame period until `stop`.
fn pace(sender: &NdiSender, mailbox: &Mailbox, stop: &AtomicBool, fps: u32) {
    let period = Duration::from_secs_f64(1.0 / f64::from(fps.max(1)));
    let mut last: Option<Frame> = None;
    let mut deadline: Option<Instant> = None;
    while !stop.load(Ordering::Acquire) {
        let Some((frame, repeated)) = next_frame(mailbox, &mut last, IDLE_WAIT) else {
            deadline = None;
            continue;
        };
        if let Err(e) = sender.send_packed(&frame.data, frame.width, frame.height, FOURCC_RGBA, fps) {
            tracing::warn!("[ndi] pushed frame not sent: {e}");
        } else {
            mailbox.counters.sent.fetch_add(1, Ordering::Relaxed);
            if repeated {
                mailbox.counters.repeated.fetch_add(1, Ordering::Relaxed);
            }
        }

        // NDI's clock_video already holds each send to its slot; this keeps
        // the loop honest if it doesn't, and spots ticks that ran late.
        let now = Instant::now();
        let next = deadline.map_or(now + period, |d| d + period);
        if now > next + period / 2 {
            mailbox.counters.late_ticks.fetch_add(1, Ordering::Relaxed);
            deadline = Some(now);
        } else {
            if next > now {
                std::thread::sleep(next - now);
            }
            deadline = Some(next);
        }
    }
}

struct PushChannel {
    sender: Arc<NdiSender>,
    mailbox: Arc<Mailbox>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    fps: u32,
}

impl PushChannel {
    fn shut_down(mut self) {
        self.stop.store(true, Ordering::Release);
        self.mailbox.wake();
        if let Some(thread) = self.thread.take() {
            // At most one frame period: the loop checks `stop` every tick.
            let _ = thread.join();
        }
        self.sender.stop();
    }
}

#[derive(Default)]
pub struct PushChannels {
    channels: RwLock<HashMap<String, PushChannel>>,
}

impl PushChannels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Announce an NDI source for `channel_id` at `fps`. Re-opening an existing
    /// channel with the same name and rate is a no-op, so the frontend can call
    /// this freely when its output settings change; anything else replaces it.
    pub fn open(&self, channel_id: &str, source_name: &str, fps: u32) -> Result<(), String> {
        let fps = fps.clamp(1, 60);
        {
            let channels = self.channels.read();
            if let Some(existing) = channels.get(channel_id) {
                if existing.fps == fps && existing.sender.source_name().as_deref() == Some(source_name) {
                    return Ok(());
                }
            }
        }

        let sender = Arc::new(NdiSender::new());
        sender.start(&NdiOutputConfig {
            source_name: source_name.to_string(),
            // Audio belongs to the program output; a graphics feed is video only.
            include_audio: false,
            ..Default::default()
        })?;

        let mailbox = Arc::new(Mailbox::default());
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let (sender, mailbox, stop) = (sender.clone(), mailbox.clone(), stop.clone());
            std::thread::Builder::new()
                .name(format!("ndi-push-{channel_id}"))
                .spawn(move || pace(&sender, &mailbox, &stop, fps))
                .map_err(|e| format!("could not start the NDI pacing thread: {e}"))?
        };

        let channel = PushChannel { sender, mailbox, stop, thread: Some(thread), fps };
        let previous = self.channels.write().insert(channel_id.to_string(), channel);
        if let Some(previous) = previous {
            previous.shut_down();
        }
        Ok(())
    }

    pub fn close(&self, channel_id: &str) {
        let removed = self.channels.write().remove(channel_id);
        if let Some(channel) = removed {
            channel.shut_down();
        }
    }

    pub fn close_all(&self) {
        let drained: Vec<PushChannel> = self.channels.write().drain().map(|(_, c)| c).collect();
        for channel in drained {
            channel.shut_down();
        }
    }

    /// Hand over one RGBA frame. `data` must be exactly `width * height * 4`
    /// bytes, tightly packed, with straight (unpremultiplied) alpha — what
    /// `CanvasRenderingContext2D.getImageData` produces. Returns as soon as the
    /// frame is in the channel's mailbox; the pacing thread sends it.
    pub fn send_frame(&self, channel_id: &str, data: &[u8], width: u32, height: u32) -> Result<(), String> {
        let expected = width as usize * height as usize * BYTES_PER_PIXEL;
        if data.len() != expected {
            return Err(format!(
                "frame is {} bytes, expected {expected} for {width}x{height} RGBA",
                data.len()
            ));
        }

        let mailbox = self
            .channels
            .read()
            .get(channel_id)
            .map(|channel| channel.mailbox.clone())
            .ok_or_else(|| format!("NDI channel '{channel_id}' is not open"))?;

        mailbox.put(Frame { data: data.to_vec(), width, height });
        Ok(())
    }

    pub fn stats(&self, channel_id: &str) -> PushStats {
        self.channels
            .read()
            .get(channel_id)
            .map(|channel| channel.mailbox.stats(channel.fps))
            .unwrap_or_default()
    }

    pub fn frames_sent(&self, channel_id: &str) -> u64 {
        self.stats(channel_id).sent
    }

    pub fn is_open(&self, channel_id: &str) -> bool {
        self.channels.read().contains_key(channel_id)
    }

    pub fn open_channels(&self) -> Vec<String> {
        self.channels.read().keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These exercise the registry's own rules; anything that needs a live NDI
    // source is covered by the integration test in `ndi_lib`.

    #[test]
    fn rejects_a_frame_whose_size_contradicts_its_dimensions() {
        let channels = PushChannels::new();
        // A short buffer would otherwise be read past its end when NDI walks the
        // rows, so this is checked before the sender is even looked up.
        let err = channels.send_frame("graphics", &[0u8; 16], 64, 64).unwrap_err();
        assert!(err.contains("expected 16384"), "got: {err}");
    }

    #[test]
    fn rejects_a_frame_for_a_channel_that_was_never_opened() {
        let channels = PushChannels::new();
        let frame = vec![0u8; 4 * 4 * 4];
        let err = channels.send_frame("graphics", &frame, 4, 4).unwrap_err();
        assert!(err.contains("is not open"), "got: {err}");
    }

    fn frame(tag: u8) -> Frame {
        Frame { data: vec![tag; 4], width: 1, height: 1 }
    }

    #[test]
    fn a_frame_replaced_before_it_was_sent_counts_as_dropped() {
        let mailbox = Mailbox::default();
        mailbox.put(frame(1));
        mailbox.put(frame(2));
        let stats = mailbox.stats(30);
        assert_eq!((stats.submitted, stats.replaced_unsent), (2, 1));
        assert_eq!(mailbox.take().map(|f| f.data[0]), Some(2), "the newest frame wins");
        assert!(mailbox.take().is_none());
    }

    #[test]
    fn a_tick_with_nothing_new_repeats_the_last_frame() {
        let mailbox = Mailbox::default();
        let mut last = None;
        assert!(next_frame(&mailbox, &mut last, Duration::ZERO).is_none(), "nothing to send yet");

        mailbox.put(frame(7));
        let (sent, repeated) = next_frame(&mailbox, &mut last, Duration::ZERO).expect("the new frame");
        assert_eq!((sent.data[0], repeated), (7, false));

        let (sent, repeated) = next_frame(&mailbox, &mut last, Duration::ZERO).expect("the last frame again");
        assert_eq!((sent.data[0], repeated), (7, true));
    }

    #[test]
    fn stats_for_an_unknown_channel_are_empty() {
        assert_eq!(PushChannels::new().stats("graphics"), PushStats::default());
    }

    /// Through the real runtime: one frame handed over keeps the source
    /// running at its rate, the rest of the ticks repeating it, and closing the
    /// channel stops its thread. Skips where no NDI runtime is installed (point
    /// NDI_RUNTIME_DIR_V6 at src-tauri/ndi-runtime/linux to use the bundled one).
    #[test]
    fn a_channel_paces_one_frame_into_a_steady_source() {
        if super::super::ndi_lib::NdiLib::get().is_none() {
            eprintln!("skipped: no NDI runtime on this machine");
            return;
        }
        let channels = PushChannels::new();
        channels.open("pace-test", "Selah Pace Test", 50).expect("channel opens");
        channels.send_frame("pace-test", &vec![128u8; 64 * 36 * 4], 64, 36).expect("frame accepted");
        std::thread::sleep(Duration::from_millis(500));
        let stats = channels.stats("pace-test");
        assert_eq!(stats.submitted, 1);
        assert!(stats.sent >= 15, "only {} frames in 500 ms at 50 fps", stats.sent);
        assert_eq!(stats.repeated, stats.sent - 1, "every tick after the first repeats");
        channels.close("pace-test");
        assert!(!channels.is_open("pace-test"));
    }

    #[test]
    fn reports_nothing_sent_for_an_unknown_channel() {
        let channels = PushChannels::new();
        assert_eq!(channels.frames_sent("graphics"), 0);
        assert!(!channels.is_open("graphics"));
        assert!(channels.open_channels().is_empty());
    }
}
