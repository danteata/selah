use screencapturekit::{
    output::sc_stream_frame_info::{SCFrameStatus, SCStreamFrameInfo},
    output::CMSampleBuffer,
    output::LockTrait,
    shareable_content::SCShareableContent,
    stream::{
        configuration::{pixel_format::PixelFormat, SCStreamConfiguration},
        content_filter::SCContentFilter,
        output_trait::SCStreamOutputTrait,
        output_type::SCStreamOutputType,
        SCStream,
    },
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::Duration;

use super::sender::NdiSender;
use super::types::NdiOutputConfig;

static CAPTURE_FRAME_COUNT: AtomicU64 = AtomicU64::new(0);

enum CaptureFrame {
    Video {
        data: Vec<u8>,
        width: u32,
        height: u32,
        bytes_per_row: u32,
    },
    Audio {
        samples: Vec<f32>,
        sample_rate: u32,
        channels: u32,
    },
}

struct CaptureHandler {
    tx: std::sync::mpsc::Sender<CaptureFrame>,
}

impl SCStreamOutputTrait for CaptureHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        match of_type {
            SCStreamOutputType::Screen => {
                if let Ok(info) = SCStreamFrameInfo::from_sample_buffer(&sample) {
                    if info.status() != SCFrameStatus::Complete {
                        return;
                    }
                }
                if let Ok(pb) = sample.get_pixel_buffer() {
                    let w = pb.get_width();
                    let h = pb.get_height();
                    let bpr = pb.get_bytes_per_row();
                    if let Ok(guard) = pb.lock() {
                        let raw: &[u8] = guard.as_slice();
                        let sz = (bpr * h) as usize;
                        if raw.len() >= sz {
                            let fc = CAPTURE_FRAME_COUNT.fetch_add(1, Ordering::SeqCst);
                            let center_offset = bpr as usize * (h as usize / 2)
                                + (w as usize / 2) * 4;
                            let sample: [u8; 4] = if center_offset + 4 <= sz {
                                raw[center_offset..center_offset + 4]
                                    .try_into()
                                    .unwrap_or([0; 4])
                            } else {
                                [0; 4]
                            };
                            if fc <= 2 || fc % 300 == 0 {
                                eprintln!(
                                    "SCCapture frame #{}: {}x{} bpr={} len={} center=[{:02X}{:02X}{:02X}{:02X}]",
                                    fc, w, h, bpr, raw.len(),
                                    sample[0], sample[1], sample[2], sample[3]
                                );
                            }
                            let _ = self.tx.send(CaptureFrame::Video {
                                data: raw[..sz].to_vec(),
                                width: w,
                                height: h,
                                bytes_per_row: bpr,
                            });
                        }
                    }
                }
            }
            SCStreamOutputType::Audio => {
                if let Ok(abl) = sample.get_audio_buffer_list() {
                    let samples = extract_audio(abl.buffers());
                    if !samples.is_empty() {
                        let _ = self.tx.send(CaptureFrame::Audio {
                            samples,
                            sample_rate: 48000,
                            channels: 2,
                        });
                    }
                }
            }
        }
    }
}

fn extract_audio(buffers: &[core_audio_types_rs::audio_buffer::AudioBuffer]) -> Vec<f32> {
    if buffers.is_empty() {
        return Vec::new();
    }
    if buffers.len() == 1 {
        let b = &buffers[0];
        let d: &[u8] = b.data();
        let n = d.len() / 4;
        if n > 0 {
            unsafe { std::slice::from_raw_parts(d.as_ptr() as *const f32, n).to_vec() }
        } else {
            Vec::new()
        }
    } else {
        let mut chans: Vec<Vec<f32>> = Vec::new();
        let mut mx = 0usize;
        for b in buffers {
            let d: &[u8] = b.data();
            let n = d.len() / 4;
            if n > 0 {
                unsafe {
                    chans.push(std::slice::from_raw_parts(d.as_ptr() as *const f32, n).to_vec())
                }
                mx = mx.max(n);
            }
        }
        let nc = chans.len();
        if nc == 0 || mx == 0 {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(mx * nc);
        for i in 0..mx {
            for ch in &chans {
                out.push(if i < ch.len() { ch[i] } else { 0.0 });
            }
        }
        out
    }
}

pub fn start_capture(
    config: &NdiOutputConfig,
    sender: Arc<NdiSender>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let include_audio = config.include_audio;
    let window_title = "Live Output".to_string();
    let sender2 = sender.clone();
    let stop2 = stop.clone();

    std::thread::spawn(move || {
        if let Err(e) = capture_loop(&window_title, sender2, include_audio, &stop2) {
            eprintln!("NDI capture error: {e}");
        }
    });

    Ok(())
}

fn find_live_window(
    window_title: &str,
) -> Result<
    (
        screencapturekit::shareable_content::window::SCWindow,
    ),
    String,
> {
    let content =
        SCShareableContent::get().map_err(|e| format!("Failed to get shareable content: {e:?}"))?;

    let windows = content.windows();
    let window = windows
        .iter()
        .find(|w| w.title().contains(window_title))
        .ok_or_else(|| format!("Window containing '{}' not found", window_title))?;

    Ok((window.clone(),))
}

fn capture_loop(
    window_title: &str,
    sender: Arc<NdiSender>,
    include_audio: bool,
    stop: &Arc<AtomicBool>,
) -> Result<(), String> {
    eprintln!("NDI capture: waiting for '{window_title}' window to appear...");

    let mut waited_logged = false;
    while stop.load(Ordering::SeqCst) {
        match find_live_window(window_title) {
            Ok((window,)) => {
                eprintln!("NDI capture: found '{window_title}' window");
                if let Err(e) = run_capture(&window, sender.clone(), include_audio, stop)
                {
                    eprintln!("NDI capture stream ended: {e}, will retry if window reappears...");
                }
                if stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_secs(1));
                }
                waited_logged = false;
            }
            Err(_) => {
                if !waited_logged {
                    eprintln!("NDI capture: waiting for '{window_title}' window...");
                    waited_logged = true;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }

    eprintln!("NDI capture loop exited");
    Ok(())
}

fn run_capture(
    window: &screencapturekit::shareable_content::window::SCWindow,
    sender: Arc<NdiSender>,
    include_audio: bool,
    stop: &Arc<AtomicBool>,
) -> Result<(), String> {
    let frame = window.get_frame();
    let width = frame.size.width as u32;
    let height = frame.size.height as u32;

    let filter = SCContentFilter::new()
        .with_desktop_independent_window(window);

    eprintln!("NDI capture: window filter on '{:?}' at ({},{}) {}x{}",
        window.title(), frame.origin.x, frame.origin.y, width, height);

    let mut cfg = SCStreamConfiguration::new()
        .set_width(width)
        .map_err(|e| format!("width: {e:?}"))?
        .set_height(height)
        .map_err(|e| format!("height: {e:?}"))?
        .set_pixel_format(PixelFormat::BGRA)
        .map_err(|e| format!("pixel_format: {e:?}"))?
        .set_shows_cursor(false)
        .map_err(|e| format!("shows_cursor: {e:?}"))?
        .set_queue_depth(3)
        .map_err(|e| format!("queue_depth: {e:?}"))?;

    if include_audio {
        cfg = cfg
            .set_captures_audio(true)
            .map_err(|e| format!("captures_audio: {e:?}"))?
            .set_excludes_current_process_audio(false)
            .map_err(|e| format!("excludes_current_process_audio: {e:?}"))?
            .set_sample_rate(48000)
            .map_err(|e| format!("sample_rate: {e:?}"))?
            .set_channel_count(2)
            .map_err(|e| format!("channel_count: {e:?}"))?;
    }

    let (tx, rx) = channel::<CaptureFrame>();
    let handler = CaptureHandler { tx };
    let mut stream = SCStream::new(&filter, &cfg);
    stream.add_output_handler(handler, SCStreamOutputType::Screen);

    if include_audio {
        let (atx, arx) = channel::<CaptureFrame>();
        let ah = CaptureHandler { tx: atx };
        stream.add_output_handler(ah, SCStreamOutputType::Audio);
        let sa = sender.clone();
        std::thread::spawn(move || {
            while let Ok(f) = arx.recv() {
                if let CaptureFrame::Audio {
                    samples,
                    sample_rate,
                    channels,
                } = f
                {
                    let ns = (samples.len() / channels as usize) as i32;
                    let _ = sa.send_audio(&samples, sample_rate, channels as u16, ns);
                }
            }
        });
    }

    stream
        .start_capture()
        .map_err(|e| format!("start_capture: {e:?}"))?;
    eprintln!("NDI capture started: {width}x{height}");

    let mut frame_count: u64 = 0;
    while stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(CaptureFrame::Video {
                data,
                width: w,
                height: h,
                bytes_per_row,
            }) => {
                if let Err(e) = sender.send_frame(&data, w, h, bytes_per_row as i32) {
                    eprintln!("NDI send_frame error: {e}");
                    break;
                }
                frame_count += 1;
                if frame_count <= 5 || frame_count % 300 == 0 {
                    eprintln!("NDI frame #{frame_count}: {w}x{h} stride={bytes_per_row}");
                }
            }
            Ok(CaptureFrame::Audio { .. }) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = stream.stop_capture();
    eprintln!("NDI capture stopped after {frame_count} frames");
    Ok(())
}
