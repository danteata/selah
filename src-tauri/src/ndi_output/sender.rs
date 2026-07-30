/**
 * NDI Sender Module
 *
 * Handles creating an NDI source and sending video/audio frames.
 * Talks to the NDI library through the runtime-loaded bindings in `ndi_lib`,
 * so a machine without the NDI runtime simply reports NDI as unavailable
 * instead of failing to start the app.
 *
 * Thread-safe: the sender handle is Send+Sync and start/stop are behind an
 * RwLock; the NDI send calls take the instance by const pointer.
 */
use parking_lot::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};

use super::ndi_lib::{
    AudioFrameV3, NdiLib, SenderHandle, VideoFrameV2, FOURCC_BGRA, FOURCC_FLTP,
    FRAME_FORMAT_PROGRESSIVE,
};
use super::types::NdiOutputConfig;

struct NdiSenderInner {
    sender: SenderHandle,
    source_name: String,
}

static FRAME_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn compute_timecode(frame_num: u64) -> i64 {
    (frame_num * 1001 / 30) as i64
}

pub fn compute_timestamp(frame_num: u64) -> i64 {
    frame_num as i64 * 33_333_333
}

pub fn compute_center_sample_offset(width: u32, height: u32, bytes_per_row: usize) -> usize {
    bytes_per_row * (height as usize / 2) + (width as usize / 2) * 4
}

pub fn copy_frame_data(src: &[u8], dst: &mut [u8], width: u32, height: u32, src_stride: usize, dst_stride: usize) {
    if src_stride == dst_stride {
        let copy_len = src.len().min(dst.len());
        dst[..copy_len].copy_from_slice(&src[..copy_len]);
    } else {
        for y in 0..height as usize {
            let src_offset = y * src_stride;
            let dst_offset = y * dst_stride;
            if src_offset + dst_stride <= src.len()
                && dst_offset + dst_stride <= dst.len()
            {
                dst[dst_offset..dst_offset + dst_stride]
                    .copy_from_slice(&src[src_offset..src_offset + dst_stride]);
            }
        }
    }
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
        let lib = NdiLib::get().ok_or(
            "The NDI runtime isn't installed on this machine. Install NDI Tools from ndi.video/tools.",
        )?;

        let sender = lib
            .send_create(&config.source_name, Some("Public"), config.include_audio)
            .ok_or("NDI refused to create the sender — is another source using this name?")?;

        eprintln!(
            "NDI sender created: name='{}', groups='Public'",
            config.source_name
        );

        FRAME_COUNTER.store(0, Ordering::SeqCst);

        *self.inner.write() = Some(NdiSenderInner {
            sender,
            source_name: config.source_name.clone(),
        });

        Ok(())
    }

    pub fn stop(&self) {
        // Destroy the NDI-side sender before dropping the handle, so the source
        // disappears from the network now rather than at process exit.
        if let Some(inner) = self.inner.write().take() {
            if let Some(lib) = NdiLib::get() {
                lib.send_destroy(&inner.sender);
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.inner.read().is_some()
    }

    /// Send a BGRA frame. Callers whose pixels have no meaningful alpha should use
    /// `send_frame_with_fourcc` with `FOURCC_BGRX` instead.
    pub fn send_frame(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        bytes_per_row: i32,
    ) -> Result<(), String> {
        self.send_frame_with_fourcc(data, width, height, bytes_per_row, FOURCC_BGRA)
    }

    pub fn send_frame_with_fourcc(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        bytes_per_row: i32,
        four_cc: u32,
    ) -> Result<(), String> {
        let inner = self.inner.read();
        let sender_inner = inner.as_ref().ok_or("NDI sender not running")?;

        let src_stride = bytes_per_row as usize;
        let dst_stride = (width as usize) * 4;

        if data.len() < dst_stride {
            return Err(format!(
                "Frame data too small: got {} bytes, need at least {}",
                data.len(),
                dst_stride
            ));
        }

        let frame_num = FRAME_COUNTER.fetch_add(1, Ordering::SeqCst);
        let timecode = compute_timecode(frame_num);
        let timestamp = compute_timestamp(frame_num);

        // NDI reads the pixels straight out of this buffer during the send call,
        // so it has to outlive it — hence a local Vec rather than a borrow of
        // `data`, which may have a different stride.
        let mut pixels = vec![0u8; dst_stride * height as usize];

        if frame_num <= 2 || frame_num % 300 == 0 {
            let sample_offset = compute_center_sample_offset(width, height, src_stride);
            let sample_bytes: [u8; 4] = if sample_offset + 4 <= data.len() {
                data[sample_offset..sample_offset + 4].try_into().unwrap_or([0; 4])
            } else {
                [0; 4]
            };
            eprintln!(
                "NDI send_frame #{}: {}x{} stride_src={} stride_dst={} timecode={} px_center=[{:02X}{:02X}{:02X}{:02X}]",
                frame_num, width, height, src_stride, dst_stride, timecode,
                sample_bytes[0], sample_bytes[1], sample_bytes[2], sample_bytes[3]
            );
        }

        copy_frame_data(data, &mut pixels, width, height, src_stride, dst_stride);

        let frame = VideoFrameV2 {
            xres: width as i32,
            yres: height as i32,
            four_cc,
            frame_rate_n: 30,
            frame_rate_d: 1,
            // 0 means "use xres/yres", which is what we want for square pixels.
            picture_aspect_ratio: 0.0,
            frame_format_type: FRAME_FORMAT_PROGRESSIVE,
            timecode,
            p_data: pixels.as_mut_ptr(),
            line_stride_in_bytes: dst_stride as i32,
            p_metadata: std::ptr::null(),
            timestamp,
        };

        let lib = NdiLib::get().ok_or("NDI runtime unloaded")?;
        lib.send_video(&sender_inner.sender, &frame);

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

        // FLTp is planar: each channel is a contiguous run of `num_samples`
        // floats, one after another. Callers must supply it that way.
        let mut samples = data.to_vec();
        let frame = AudioFrameV3 {
            sample_rate: sample_rate as i32,
            no_channels: channels as i32,
            no_samples: num_samples,
            timecode: 0,
            four_cc: FOURCC_FLTP,
            p_data: samples.as_mut_ptr() as *mut u8,
            channel_stride_in_bytes: num_samples * std::mem::size_of::<f32>() as i32,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        };

        let lib = NdiLib::get().ok_or("NDI runtime unloaded")?;
        lib.send_audio(&sender_inner.sender, &frame);

        Ok(())
    }

    pub fn frames_sent(&self) -> u64 {
        FRAME_COUNTER.load(Ordering::SeqCst)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_timecode() {
        assert_eq!(compute_timecode(0), 0);
        assert_eq!(compute_timecode(1), 33);
        assert_eq!(compute_timecode(30), 1001);
        assert_eq!(compute_timecode(60), 2002);
        assert_eq!(compute_timecode(2997), 99999);
        assert_eq!(compute_timecode(3000), 100100);
    }

    #[test]
    fn test_compute_timestamp() {
        assert_eq!(compute_timestamp(0), 0);
        assert_eq!(compute_timestamp(1), 33_333_333);
        assert_eq!(compute_timestamp(30), 999_999_990);
        assert_eq!(compute_timestamp(300), 9_999_999_900);
    }

    #[test]
    fn test_compute_center_sample_offset() {
        assert_eq!(compute_center_sample_offset(1920, 1080, 7680), 7680 * 540 + 960 * 4);
        assert_eq!(compute_center_sample_offset(960, 540, 3840), 3840 * 270 + 480 * 4);
        assert_eq!(compute_center_sample_offset(100, 200, 400), 400 * 100 + 50 * 4);
    }

    #[test]
    fn test_copy_frame_data_matching_stride() {
        let width = 4u32;
        let height = 2u32;
        let stride = width as usize * 4;
        let size = stride * height as usize;

        let mut src = vec![0u8; size];
        src[0..4].copy_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        src[stride..stride + 4].copy_from_slice(&[0x11, 0x22, 0x33, 0x44]);

        let mut dst = vec![0u8; size];
        copy_frame_data(&src, &mut dst, width, height, stride, stride);

        assert_eq!(dst[0..4], [0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(dst[stride..stride + 4], [0x11, 0x22, 0x33, 0x44]);
    }

    #[test]
    fn test_copy_frame_data_wider_src_stride() {
        let width = 2u32;
        let height = 2u32;
        let dst_stride = width as usize * 4;

        let src_stride = dst_stride + 8;
        let mut src = vec![0u8; src_stride * height as usize];
        src[0..dst_stride].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        src[src_stride..src_stride + dst_stride].copy_from_slice(&[9, 10, 11, 12, 13, 14, 15, 16]);

        let mut dst = vec![0u8; dst_stride * height as usize];
        copy_frame_data(&src, &mut dst, width, height, src_stride, dst_stride);

        assert_eq!(dst[0..dst_stride], [1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(dst[dst_stride..dst_stride * 2], [9, 10, 11, 12, 13, 14, 15, 16]);
    }

    #[test]
    fn test_copy_frame_data_preserves_trailing_padding() {
        let width = 2u32;
        let height = 1u32;
        let dst_stride = width as usize * 4;

        let src_stride = 16usize;
        let mut src = vec![0u8; src_stride];
        src[0..4].copy_from_slice(&[0xFF, 0x00, 0xFF, 0x00]);
        src[4..8].copy_from_slice(&[0x0A, 0x0B, 0x0C, 0x0D]);
        src[8..16].copy_from_slice(&[0xEE; 8]);

        let mut dst = vec![0u8; dst_stride];
        copy_frame_data(&src, &mut dst, width, height, src_stride, dst_stride);

        assert_eq!(dst[0..4], [0xFF, 0x00, 0xFF, 0x00]);
        assert_eq!(dst[4..8], [0x0A, 0x0B, 0x0C, 0x0D]);
    }

    #[test]
    fn test_copy_frame_data_incomplete_last_row() {
        let width = 4u32;
        let height = 2u32;
        let stride = width as usize * 4;
        let total_size = stride * height as usize;

        let src = vec![0xABu8; total_size];
        let mut dst = vec![0u8; total_size];
        copy_frame_data(&src, &mut dst, width, height, stride, stride);

        assert!(dst.iter().all(|&b| b == 0xAB));
    }

    #[test]
    fn test_copy_frame_data_src_smaller_than_dst_stride() {
        let width = 4u32;
        let height = 1u32;
        let dst_stride = width as usize * 4;
        let src_stride = 24usize;

        let mut src = vec![0u8; src_stride];
        src[0..16].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

        let mut dst = vec![0u8; dst_stride];
        copy_frame_data(&src, &mut dst, width, height, src_stride, dst_stride);

        assert_eq!(dst[0..16], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }

    #[test]
    fn test_timecode_monotonic_increase() {
        let mut prev = compute_timecode(0);
        for i in 1..1000 {
            let tc = compute_timecode(i);
            assert!(tc > prev, "timecode should increase monotonically: frame {} tc={} <= prev {}", i, tc, prev);
            prev = tc;
        }
    }

    #[test]
    fn test_timestamp_monotonic_increase() {
        let mut prev = compute_timestamp(0);
        for i in 1..1000 {
            let ts = compute_timestamp(i);
            assert!(ts > prev, "timestamp should increase monotonically: frame {} ts={} <= prev {}", i, ts, prev);
            prev = ts;
        }
    }

    #[test]
    fn test_center_sample_offset_within_bounds() {
        let width = 1920u32;
        let height = 1080u32;
        let bpr = 7680usize;
        let offset = compute_center_sample_offset(width, height, bpr);
        let total = bpr * height as usize;
        assert!(offset + 4 <= total, "center sample offset should be within frame buffer");
        assert!(offset >= bpr, "center sample should be past first row");
    }

    #[test]
    fn test_center_sample_offset_various_sizes() {
        let cases = [
            (1920u32, 1050u32, 7680usize),
            (960u32, 540u32, 3840usize),
            (3840u32, 2160u32, 15360usize),
            (128u32, 128u32, 512usize),
        ];
        for &(w, h, bpr) in &cases {
            let offset = compute_center_sample_offset(w, h, bpr);
            let total = bpr * h as usize;
            assert!(offset + 4 <= total, "offset out of bounds for {}x{} bpr={}: offset={} total={}", w, h, bpr, offset, total);
        }
    }
}
