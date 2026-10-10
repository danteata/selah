//! The capture ring every backend shares.
//!
//! An OS audio callback runs on a real-time thread, so it does no more than
//! convert samples into a wait-free SPSC ring: no allocation, no lock, no
//! logging. A capture thread drains the ring, runs the preprocessor (resample,
//! highpass) and appends to the shared `audio_buffer` the readers lock. Any time
//! a reader held that lock an audio thread taking it would wait, and a late
//! callback is a dropout.
//!
//! Writes are whole frames only, and the ring's capacity is a whole number of
//! frames too, so every read the drain makes — including the split at the
//! ring's wrap point — starts on a frame boundary and the preprocessor's
//! channel selection stays aligned.

use parking_lot::Mutex;
use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use super::types::AudioPreprocessor;

/// How often a capture thread drains its ring into the preprocessor. This is
/// the latency the ring adds; 10 ms is under one VAD frame.
pub(super) const DRAIN_INTERVAL: Duration = Duration::from_millis(10);

/// Ring capacity, in seconds of source audio. Absorbs a capture thread that
/// stalls (a slow lock on the shared buffer, a busy machine) without dropping
/// anything; normal drains keep it nearly empty.
pub(super) const RING_SECONDS: usize = 2;

/// The most planes a planar callback can hand `push_planar`. Fixed so the
/// callback can gather them on the stack.
#[cfg(target_os = "macos")]
pub(super) const MAX_PLANES: usize = 8;

/// A sized ring with its pages already touched, so the first seconds of
/// capture do not take page faults on the audio thread. (Touching does not
/// pin them; it only gets the first-use faults out of the way.)
pub(super) fn capture_ring(capacity: usize) -> (Producer<f32>, Consumer<f32>) {
    let (mut producer, mut consumer) = RingBuffer::new(capacity);
    if let Ok(chunk) = producer.write_chunk(capacity) {
        chunk.commit_all();
    }
    if let Ok(chunk) = consumer.read_chunk(capacity) {
        chunk.commit_all();
    }
    (producer, consumer)
}

/// A ring holding `RING_SECONDS` of `channels`-wide audio at `sample_rate`,
/// sized to a whole number of frames.
pub(super) fn capture_ring_for(sample_rate: u32, channels: u16) -> (Producer<f32>, Consumer<f32>) {
    let frame = (channels as usize).max(1);
    capture_ring(sample_rate as usize * RING_SECONDS * frame)
}

/// The callback body for interleaved audio: queue as many whole frames of
/// `data` as the ring has room for and return how many samples did not fit.
/// Allocation- and lock-free.
pub(super) fn push_frames<T: Copy>(
    producer: &mut Producer<f32>,
    data: &[T],
    channels: usize,
    convert: fn(T) -> f32,
) -> usize {
    let writable = producer.slots().min(data.len()) / channels * channels;
    if writable > 0 {
        if let Ok(chunk) = producer.write_chunk_uninit(writable) {
            chunk.fill_from_iter(data[..writable].iter().copied().map(convert));
        }
    }
    data.len() - writable
}

/// The callback body for planar audio (one slice per channel): interleave as
/// many whole frames as the ring has room for and return how many samples did
/// not fit. A frame is one sample from every plane, so a plane shorter than
/// the rest bounds the frame count. Allocation- and lock-free.
#[cfg(any(target_os = "macos", test))]
pub(super) fn push_planar(producer: &mut Producer<f32>, planes: &[&[f32]]) -> usize {
    let channels = planes.len();
    if channels == 0 {
        return 0;
    }
    let frames = planes.iter().map(|p| p.len()).min().unwrap_or(0);
    let fit = (producer.slots() / channels).min(frames);
    if fit > 0 {
        if let Ok(chunk) = producer.write_chunk_uninit(fit * channels) {
            chunk.fill_from_iter((0..fit).flat_map(|i| planes.iter().map(move |p| p[i])));
        }
    }
    (frames - fit) * channels
}

/// Move everything the callback has queued through the preprocessor and onto
/// the shared buffer. Runs on the capture thread, never the audio thread.
pub(super) fn drain_ring(
    consumer: &mut Consumer<f32>,
    pre: &mut AudioPreprocessor,
    audio_buffer: &Mutex<Vec<f32>>,
    buffer_size: &AtomicUsize,
) {
    let available = consumer.slots();
    if available == 0 {
        return;
    }
    let Ok(chunk) = consumer.read_chunk(available) else {
        return;
    };
    let (first, second) = chunk.as_slices();
    let mut processed = pre.process(first);
    if !second.is_empty() {
        processed.extend_from_slice(&pre.process(second));
    }
    chunk.commit_all();
    append(audio_buffer, buffer_size, &processed);
}

/// Drain what is left once the stream is down, then the resampler's last
/// partial block and its delay line. Without the flush the final 10-20 ms of
/// every capture stays inside the resampler and is dropped with it — the end
/// of the last word.
///
/// Call it only after the stream has stopped, so nothing is still writing.
pub(super) fn finish_ring(
    consumer: &mut Consumer<f32>,
    pre: &mut AudioPreprocessor,
    audio_buffer: &Mutex<Vec<f32>>,
    buffer_size: &AtomicUsize,
) {
    drain_ring(consumer, pre, audio_buffer, buffer_size);
    let tail = pre.flush();
    append(audio_buffer, buffer_size, &tail);
}

fn append(audio_buffer: &Mutex<Vec<f32>>, buffer_size: &AtomicUsize, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let mut buf = audio_buffer.lock();
    buf.extend_from_slice(samples);
    buffer_size.store(buf.len(), Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Draining through the ring — in odd-sized callbacks, across the wrap
    /// point, a frame at a time — has to give the preprocessor exactly the
    /// audio it would have seen directly. Stereo with channel selection is the
    /// case that breaks if a read ever starts mid-frame.
    #[test]
    fn the_ring_is_transparent_to_the_preprocessor() {
        let rate = 48_000u32;
        let channels = 2usize;
        // Left carries a tone, right carries noise-like garbage, so reading
        // the wrong channel after a misaligned split shows up in the output.
        let frames = rate as usize; // one second
        let input: Vec<f32> = (0..frames)
            .flat_map(|i| {
                let t = i as f32 / rate as f32;
                let left = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
                let right = if i % 3 == 0 { 0.9 } else { -0.9 };
                [left, right]
            })
            .collect();

        let mut direct = AudioPreprocessor::new(rate, channels as u16, Some(0));
        let mut expected = direct.process(&input);
        expected.extend(direct.flush());

        // A small ring (0.1 s) forces many wraps over a second of audio.
        let (mut producer, mut consumer) = capture_ring(rate as usize / 10 * channels);
        let mut pre = AudioPreprocessor::new(rate, channels as u16, Some(0));
        let buffer = Mutex::new(Vec::new());
        let size = AtomicUsize::new(0);

        // Callback sizes that are not a divisor of the ring, drained every few
        // callbacks so the ring fills unevenly.
        let mut offset = 0;
        let mut callbacks = 0;
        while offset < input.len() {
            let len = (441 * channels).min(input.len() - offset);
            let dropped = push_frames(&mut producer, &input[offset..offset + len], channels, |s| s);
            assert_eq!(dropped, 0, "ring overflowed in the test itself");
            offset += len;
            callbacks += 1;
            if callbacks % 3 == 0 {
                drain_ring(&mut consumer, &mut pre, &buffer, &size);
            }
        }
        finish_ring(&mut consumer, &mut pre, &buffer, &size);
        let got = buffer.into_inner();
        assert_eq!(size.load(Ordering::SeqCst), got.len());

        assert_eq!(got.len(), expected.len());
        for (i, (a, b)) in got.iter().zip(&expected).enumerate() {
            assert!((a - b).abs() < 1e-5, "sample {i} differs: {a} vs {b}");
        }
    }

    /// A full ring drops whole frames and reports exactly what it dropped,
    /// so the next write still starts on a frame boundary.
    #[test]
    fn a_full_ring_drops_whole_frames() {
        let (mut producer, _consumer) = capture_ring(10);
        let data = [0.1f32; 7];
        // Stereo: 7 samples is 3 whole frames plus one stray sample.
        assert_eq!(push_frames(&mut producer, &data, 2, |s| s), 1);
        // 4 slots left: two frames fit, the third frame and the stray do not.
        assert_eq!(push_frames(&mut producer, &data, 2, |s| s), 3);
        assert_eq!(producer.slots(), 0);
    }

    /// Planar input comes out of the ring interleaved, frame by frame.
    #[test]
    fn planar_input_is_interleaved() {
        let (mut producer, mut consumer) = capture_ring(16);
        let left = [1.0f32, 2.0, 3.0];
        let right = [-1.0f32, -2.0, -3.0];
        assert_eq!(push_planar(&mut producer, &[&left, &right]), 0);
        let chunk = consumer.read_chunk(6).expect("six samples queued");
        let (first, second) = chunk.as_slices();
        let got: Vec<f32> = first.iter().chain(second).copied().collect();
        assert_eq!(got, [1.0, -1.0, 2.0, -2.0, 3.0, -3.0]);
    }

    /// A full ring drops whole planar frames, and a short plane bounds the
    /// frame count rather than reading past its end.
    #[test]
    fn planar_overflow_drops_whole_frames() {
        let (mut producer, _consumer) = capture_ring(4);
        let left = [0.1f32; 5];
        let right = [0.2f32; 3];
        // Three whole frames available (the short plane), two fit.
        assert_eq!(push_planar(&mut producer, &[&left, &right]), 2);
        assert_eq!(producer.slots(), 0);
    }

    /// `finish_ring` delivers the resampler's tail, which `drain_ring` alone
    /// leaves behind.
    #[test]
    fn finishing_flushes_the_resampler_tail() {
        let rate = 48_000u32;
        let (mut producer, mut consumer) = capture_ring_for(rate, 1);
        let mut pre = AudioPreprocessor::new(rate, 1, None);
        let buffer = Mutex::new(Vec::new());
        let size = AtomicUsize::new(0);

        let input = vec![0.25f32; 4_801];
        assert_eq!(push_frames(&mut producer, &input, 1, |s| s), 0);
        drain_ring(&mut consumer, &mut pre, &buffer, &size);
        let drained = size.load(Ordering::SeqCst);

        finish_ring(&mut consumer, &mut pre, &buffer, &size);
        assert!(size.load(Ordering::SeqCst) > drained, "no tail was flushed");
        assert_eq!(size.load(Ordering::SeqCst), buffer.lock().len());
    }
}
