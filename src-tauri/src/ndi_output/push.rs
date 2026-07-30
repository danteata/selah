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
 */

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;

use super::ndi_lib::FOURCC_RGBA;
use super::sender::NdiSender;
use super::types::NdiOutputConfig;

/// Frames arrive as RGBA from a canvas: 4 bytes per pixel, no padding.
const BYTES_PER_PIXEL: usize = 4;

#[derive(Default)]
pub struct PushChannels {
    senders: RwLock<HashMap<String, Arc<NdiSender>>>,
}

impl PushChannels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Announce an NDI source for `channel_id`. Re-opening an existing channel
    /// with the same name is a no-op, so the frontend can call this freely when
    /// its output settings change; a different name replaces the source.
    pub fn open(&self, channel_id: &str, source_name: &str) -> Result<(), String> {
        {
            let senders = self.senders.read();
            if let Some(existing) = senders.get(channel_id) {
                if existing.source_name().as_deref() == Some(source_name) {
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

        if let Some(previous) = self.senders.write().insert(channel_id.to_string(), sender) {
            previous.stop();
        }

        Ok(())
    }

    pub fn close(&self, channel_id: &str) {
        if let Some(sender) = self.senders.write().remove(channel_id) {
            sender.stop();
        }
    }

    pub fn close_all(&self) {
        for (_, sender) in self.senders.write().drain() {
            sender.stop();
        }
    }

    /// Push one RGBA frame. `data` must be exactly `width * height * 4` bytes,
    /// tightly packed, with straight (unpremultiplied) alpha — what
    /// `CanvasRenderingContext2D.getImageData` produces.
    pub fn send_frame(&self, channel_id: &str, data: &[u8], width: u32, height: u32) -> Result<(), String> {
        let expected = width as usize * height as usize * BYTES_PER_PIXEL;
        if data.len() != expected {
            return Err(format!(
                "frame is {} bytes, expected {expected} for {width}x{height} RGBA",
                data.len()
            ));
        }

        let sender = self
            .senders
            .read()
            .get(channel_id)
            .cloned()
            .ok_or_else(|| format!("NDI channel '{channel_id}' is not open"))?;

        sender.send_frame_with_fourcc(
            data,
            width,
            height,
            (width as usize * BYTES_PER_PIXEL) as i32,
            FOURCC_RGBA,
        )
    }

    pub fn frames_sent(&self, channel_id: &str) -> u64 {
        self.senders
            .read()
            .get(channel_id)
            .map(|sender| sender.frames_sent())
            .unwrap_or(0)
    }

    pub fn is_open(&self, channel_id: &str) -> bool {
        self.senders.read().contains_key(channel_id)
    }

    pub fn open_channels(&self) -> Vec<String> {
        self.senders.read().keys().cloned().collect()
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

    #[test]
    fn reports_nothing_sent_for_an_unknown_channel() {
        let channels = PushChannels::new();
        assert_eq!(channels.frames_sent("graphics"), 0);
        assert!(!channels.is_open("graphics"));
        assert!(channels.open_channels().is_empty());
    }
}
