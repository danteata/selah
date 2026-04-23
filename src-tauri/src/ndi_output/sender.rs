/**
 * NDI Sender Module
 *
 * Handles creating an NDI source and sending video/audio frames.
 * Uses grafton-ndi bindings for the NDI SDK.
 *
 * Thread-safe: Sender is Send+Sync, protected by RwLock for start/stop.
 * send_video and send_audio only need &self on grafton_ndi::Sender.
 */
use grafton_ndi::{PixelFormat, SenderOptions, VideoFrame, NDI};
use parking_lot::RwLock;
use std::sync::Arc;

use super::types::NdiOutputConfig;

struct NdiSenderInner {
    ndi: Arc<NDI>,
    sender: grafton_ndi::Sender,
    source_name: String,
    frames_sent: u64,
}

pub struct NdiSender {
    inner: RwLock<Option<NdiSenderInner>>,
}

impl NdiSender {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
        }
    }

    pub fn start(&self, config: &NdiOutputConfig) -> Result<(), String> {
        let ndi = NDI::new().map_err(|e| format!("Failed to initialize NDI: {:?}", e))?;

        let options = SenderOptions::builder(&config.source_name)
            .clock_video(true)
            .clock_audio(config.include_audio)
            .groups("Public")
            .build();

        let sender = grafton_ndi::Sender::new(&ndi, &options)
            .map_err(|e| format!("Failed to create NDI sender: {:?}", e))?;

        eprintln!(
            "NDI sender created: name='{}', groups='Public'",
            config.source_name
        );

        *self.inner.write() = Some(NdiSenderInner {
            ndi: Arc::new(ndi),
            sender,
            source_name: config.source_name.clone(),
            frames_sent: 0,
        });

        Ok(())
    }

    pub fn stop(&self) {
        *self.inner.write() = None;
    }

    pub fn is_running(&self) -> bool {
        self.inner.read().is_some()
    }

    pub fn send_frame(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        bytes_per_row: i32,
    ) -> Result<(), String> {
        let inner = self.inner.read();
        let sender_inner = inner.as_ref().ok_or("NDI sender not running")?;

        let src_stride = bytes_per_row as usize;
        let dst_stride = (width as usize) * 4;

        let mut frame = VideoFrame::builder()
            .resolution(width as i32, height as i32)
            .pixel_format(PixelFormat::BGRA)
            .frame_rate(30, 1)
            .build()
            .map_err(|e| format!("Failed to build video frame: {:?}", e))?;

        if src_stride == dst_stride {
            let copy_len = data.len().min(frame.data.len());
            frame.data[..copy_len].copy_from_slice(&data[..copy_len]);
        } else {
            for y in 0..height as usize {
                let src_offset = y * src_stride;
                let dst_offset = y * dst_stride;
                if src_offset + dst_stride <= data.len()
                    && dst_offset + dst_stride <= frame.data.len()
                {
                    frame.data[dst_offset..dst_offset + dst_stride]
                        .copy_from_slice(&data[src_offset..src_offset + dst_stride]);
                }
            }
        }

        sender_inner.sender.send_video(&frame);

        Ok(())
    }

    pub fn send_audio(
        &self,
        data: &[f32],
        sample_rate: u32,
        channels: u16,
        num_samples: i32,
    ) -> Result<(), String> {
        let inner = self.inner.read();
        let sender_inner = inner.as_ref().ok_or("NDI sender not running")?;

        let audio_frame = grafton_ndi::AudioFrame::builder()
            .data(data.to_vec())
            .sample_rate(sample_rate as i32)
            .channels(channels as i32)
            .samples(num_samples)
            .build()
            .map_err(|e| format!("Failed to build audio frame: {:?}", e))?;

        sender_inner.sender.send_audio(&audio_frame);

        Ok(())
    }

    pub fn frames_sent(&self) -> u64 {
        self.inner
            .read()
            .as_ref()
            .map(|i| i.frames_sent)
            .unwrap_or(0)
    }

    pub fn source_name(&self) -> Option<String> {
        self.inner.read().as_ref().map(|i| i.source_name.clone())
    }
}

impl Default for NdiSender {
    fn default() -> Self {
        Self::new()
    }
}
