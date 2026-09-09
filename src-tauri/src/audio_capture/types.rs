//! Audio capture types and utilities

use base64::{engine::general_purpose, Engine as _};
use hound::{WavSpec, WavWriter};
use rubato::{FftFixedIn, Resampler};
use std::io::Cursor;

/// Target sample rate for whisper (16kHz)
pub const TARGET_SAMPLE_RATE: u32 = 16000;

/// Audio capture type
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum CaptureType {
    /// Capture from microphone
    Microphone,
    /// Capture system audio (loopback)
    System,
    /// Capture both microphone and system audio
    Both,
}

/// Audio device information
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rate: u32,
    pub channels: u16,
    pub device_type: DeviceType,
}

#[derive(Debug, Clone, serde::Serialize)]
#[allow(dead_code)] // Output/Loopback are populated by platform-specific enumeration code
pub enum DeviceType {
    Input,    // Microphone
    Output,   // Speaker/System
    Loopback, // System audio capture
}

/// Audio chunk ready for transcription
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioChunk {
    /// PCM samples as f32 (16kHz mono)
    pub samples: Vec<f32>,
    /// Duration in milliseconds
    pub duration_ms: u32,
    /// Sample rate
    pub sample_rate: u32,
}

impl AudioChunk {
    /// Convert to WAV bytes
    pub fn to_wav(&self) -> Result<Vec<u8>, String> {
        let mut buffer = Vec::new();
        let cursor = Cursor::new(&mut buffer);

        let spec = WavSpec {
            channels: 1, // Mono
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut writer = WavWriter::new(cursor, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        // Convert f32 samples to i16
        for sample in &self.samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let i16_sample = (clamped * 32767.0) as i16;
            writer
                .write_sample(i16_sample)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

        Ok(buffer)
    }

    /// Convert to base64-encoded WAV
    pub fn to_wav_base64(&self) -> String {
        match self.to_wav() {
            Ok(wav_data) => general_purpose::STANDARD.encode(&wav_data),
            Err(e) => {
                eprintln!("Failed to encode WAV: {}", e);
                String::new()
            }
        }
    }

    /// Check if chunk has meaningful audio (not silence)
    /// Uses RMS (root mean square) with a higher threshold to filter out noise
    #[allow(dead_code)]
    pub fn has_audio(&self, threshold: f32) -> bool {
        if self.samples.is_empty() {
            return false;
        }

        // Calculate RMS (root mean square) to detect audio
        let sum: f32 = self.samples.iter().map(|s| s * s).sum();
        let rms = (sum / self.samples.len() as f32).sqrt();

        // Also check peak amplitude for better detection
        let peak: f32 = self
            .samples
            .iter()
            .map(|s| s.abs())
            .fold(0.0, |a, b| a.max(b));

        // Use both RMS and peak for more robust detection
        // RMS threshold of 0.01 (was 0.001) and peak threshold of 0.05
        rms > threshold && peak > 0.05
    }

    /// Get audio duration in seconds
    #[allow(dead_code)]
    pub fn duration_secs(&self) -> f64 {
        self.duration_ms as f64 / 1000.0
    }
}

/// Decode a mono/16-bit WAV file at [`TARGET_SAMPLE_RATE`] into `f32` samples
/// in `[-1.0, 1.0]`, for one-shot offline (batch) re-transcription of a saved
/// recording. Dev-only tooling — fails loudly on format mismatch rather than
/// silently resampling, since our own recorder always writes this exact
/// format and a mismatch means something else produced the file.
pub fn decode_wav_to_f32(path: &str) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("Failed to open WAV file {path}: {e}"))?;
    let spec = reader.spec();

    if spec.channels != 1 {
        return Err(format!("Expected mono audio, got {} channels", spec.channels));
    }
    if spec.sample_rate != TARGET_SAMPLE_RATE {
        return Err(format!(
            "Expected {TARGET_SAMPLE_RATE}Hz audio, file is {}Hz",
            spec.sample_rate
        ));
    }

    match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode WAV samples: {e}")),
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode WAV samples: {e}")),
    }
}

/// Decode a WAV at any rate and channel count into the exact `f32` mono
/// [`TARGET_SAMPLE_RATE`] samples a capture stream would have produced from
/// the same audio, by running it through [`AudioPreprocessor`].
///
/// This exists so an offline replay can measure the capture front end rather
/// than starting downstream of it. [`decode_wav_to_f32`] deliberately refuses
/// anything but 16 kHz mono, which meant every harness built on it began after
/// the resampler and the highpass — so a change to either was invisible to the
/// thing we use to judge changes. Feed this a 48 kHz stereo recording of a
/// service and the VAD sees what it would have seen live.
///
/// `selected_channel` mirrors the capture setting; see [`downmix`].
// Dev tooling: the only caller is `offline_probe`, which is `cfg(test)`.
#[allow(dead_code)]
pub fn decode_wav_to_capture_mono(
    path: &str,
    selected_channel: Option<u16>,
) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("Failed to open WAV file {path}: {e}"))?;
    let spec = reader.spec();

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode WAV samples: {e}"))?,
        hound::SampleFormat::Int => {
            // hound yields the stored width sign-extended into i32, so one
            // scale factor derived from the header covers 16- and 24-bit.
            let scale = 1.0 / (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to decode WAV samples: {e}"))?
        }
    };

    Ok(AudioPreprocessor::process_all(
        &interleaved,
        spec.sample_rate,
        spec.channels,
        selected_channel,
    ))
}

/// Reduce interleaved multi-channel audio to mono.
///
/// `selected` picks one channel instead of averaging them. That matters for a
/// multi-channel interface at a sound desk (Focusrite Scarlett, MOTU M4,
/// Behringer UMC), where the extra channels are not more of the same source:
/// they carry the front-of-house mix, or loopback, alongside a vocal aux.
/// Averaging mixes the band back into a feed that was chosen precisely to
/// exclude it — the input `songTracking.eval.test.ts` measured as collapsing
/// no-speech fallback segments from 46 to 1.
///
/// A `selected` channel that doesn't exist on this device falls back to
/// averaging rather than erroring: the setting is stored per user, not per
/// device, so unplugging the interface and running off the laptop mic must
/// keep working.
///
/// Trailing partial frames are dropped. cpal delivers whole frames, so this is
/// a guard rather than a code path — but averaging a short chunk over the full
/// channel count (as this did before) silently scaled that frame down.
pub fn downmix(samples: &[f32], channels: u16, selected: Option<u16>) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let stride = channels as usize;

    match selected {
        Some(ch) if (ch as usize) < stride => {
            let idx = ch as usize;
            samples.chunks_exact(stride).map(|frame| frame[idx]).collect()
        }
        _ => samples
            .chunks_exact(stride)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect(),
    }
}

/// 2nd-order Butterworth highpass IIR filter coefficients at 85 Hz, Q=0.707
/// for 16 kHz sample rate. Removes low-frequency rumble (HVAC, handling noise).
///
/// State is carried across calls by whoever owns it. An IIR filter restarted
/// on every capture callback is a different filter: its two delay taps begin
/// at zero, so each chunk opens with a transient the audio never contained.
/// At a 10 ms drain that is a click 100 times a second.
struct HighpassFilter {
    d1: f32,
    d2: f32,
}

impl HighpassFilter {
    fn new() -> Self {
        Self { d1: 0.0, d2: 0.0 }
    }

    fn process_sample(&mut self, input: f32) -> f32 {
        // 2nd-order Butterworth highpass at 85 Hz for 16 kHz
        // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
        //
        // RBJ cookbook, f0 = 85, Q = 1/sqrt(2), fs = 16000, normalised by a0.
        //
        // These replace a set that was *unstable*: its denominator
        // z^2 - 1.88915 z + 0.88825 factors to poles at 0.8816 and **1.0076**,
        // and a pole outside the unit circle means the filter's output grows
        // by 0.76% per sample without bound. It survived only because the old
        // code built a fresh filter for every capture callback and threw it
        // away again, so the divergence was cut off after a few hundred
        // samples — but that still put an exponential ramp of up to ~37x on
        // the end of every chunk, reset 100 times a second, immediately
        // upstream of the VAD. Run continuously, as it now is, the same
        // coefficients reach f32 infinity in about 0.8 seconds.
        // See `stays_stable_over_a_long_run`.
        const B0: f32 = 0.976_673_5;
        const B1: f32 = -1.953_347;
        const B2: f32 = 0.976_673_5;
        const A1: f32 = -1.952_802_8;
        const A2: f32 = 0.953_891_2;

        let output = B0 * input + self.d1;
        self.d1 = B1 * input - A1 * output + self.d2;
        self.d2 = B2 * input - A2 * output;
        output
    }

    fn process_slice(&mut self, samples: &mut [f32]) {
        // +3 dB gain ≈ 1.4125 linear
        const GAIN: f32 = 1.4125;
        for sample in samples.iter_mut() {
            *sample = self.process_sample(*sample) * GAIN;
        }
    }
}

/// Input frames the resampler consumes per call, counted at the *source* rate.
/// 1024 frames is 21 ms at 48 kHz and 23 ms at 44.1 kHz — under the 32 ms VAD
/// frame the audio ends up in, so nothing downstream waits on it.
const RESAMPLER_CHUNK_IN: usize = 1024;

/// Cap on the zero-fed rounds [`AudioPreprocessor::flush`] uses to clock the
/// resampler's delay line out. The tail is a few hundred samples at most, so
/// this is only here so a resampler that never reaches the expected count
/// cannot spin on the stop path.
const MAX_FLUSH_ROUNDS: usize = 8;

/// One capture stream's audio front end: downmix → band-limited resample to
/// [`TARGET_SAMPLE_RATE`] → highpass → gain.
///
/// This is a *stateful* pipeline and must be owned per stream, because two of
/// its three stages have memory. It replaced a set of free functions that
/// rebuilt their state on every callback, which cost us two things:
///
/// 1. **Aliasing.** The old resampler was bare cubic interpolation between
///    neighbouring samples, with no band limit. Decimating 48 kHz to 16 kHz
///    that way folds everything between 8 and 24 kHz back down into the
///    output: cymbals, sibilance, stage hiss and switching noise all land on
///    top of the 300–3400 Hz band the ASR actually reads, and no downstream
///    filter can separate them again because by then they *are* the signal.
///    `rubato`'s FFT resampler applies the anti-alias filter the decimation
///    always needed. See `resampler_tests::alias_above_nyquist_is_rejected`.
/// 2. **Chunk-boundary transients**, from restarting the IIR every callback.
///
/// A resampler is only allocated when the source rate differs from the target;
/// at 16 kHz in, audio passes straight to the filter.
pub struct AudioPreprocessor {
    source_channels: u16,
    selected_channel: Option<u16>,
    resampler: Option<FftFixedIn<f32>>,
    /// Kept for [`Self::flush`], which needs the in/out ratio to work out how
    /// much real audio the resampler's delay line still owes us.
    source_sample_rate: u32,
    /// Source-rate samples handed to the resampler, against 16 kHz samples it
    /// has given back. [`Self::flush`] compares the pair with `output_delay()`
    /// to find the tail still inside the FFT delay line.
    in_count: usize,
    out_count: usize,
    /// Mono source-rate frames not yet handed to the resampler. It consumes a
    /// fixed block; capture callbacks deliver whatever the device felt like.
    pending: Vec<f32>,
    /// Reused non-interleaved scratch, so the audio thread never allocates.
    in_buf: Vec<Vec<f32>>,
    out_buf: Vec<Vec<f32>>,
    highpass: HighpassFilter,
    /// A resampler error repeats every callback if it repeats at all; say it
    /// once rather than filling the log from the audio thread.
    warned: bool,
}

impl AudioPreprocessor {
    /// Build a front end for a stream of `source_channels` at
    /// `source_sample_rate`. `selected_channel` picks one channel instead of
    /// averaging them — see [`downmix`] for why that is worth a setting.
    pub fn new(
        source_sample_rate: u32,
        source_channels: u16,
        selected_channel: Option<u16>,
    ) -> Self {
        let resampler = if source_sample_rate == TARGET_SAMPLE_RATE {
            None
        } else {
            FftFixedIn::<f32>::new(
                source_sample_rate as usize,
                TARGET_SAMPLE_RATE as usize,
                RESAMPLER_CHUNK_IN,
                2,
                1,
            )
            .map_err(|e| {
                // Falling back to pass-through would hand the VAD and the ASR
                // audio at the wrong rate, which sounds like a chipmunk and
                // transcribes like one. Better to produce nothing and have the
                // silence be visible than to produce plausible garbage.
                eprintln!(
                    "Failed to build resampler for {source_sample_rate} Hz → \
                     {TARGET_SAMPLE_RATE} Hz: {e}"
                );
            })
            .ok()
        };

        let (in_buf, out_buf) = match resampler.as_ref() {
            Some(rs) => (
                vec![Vec::with_capacity(rs.input_frames_max())],
                rs.output_buffer_allocate(true),
            ),
            None => (Vec::new(), Vec::new()),
        };

        Self {
            source_channels,
            selected_channel,
            resampler,
            source_sample_rate,
            in_count: 0,
            out_count: 0,
            pending: Vec::with_capacity(RESAMPLER_CHUNK_IN * 2),
            in_buf,
            out_buf,
            highpass: HighpassFilter::new(),
            warned: false,
        }
    }

    /// Feed one capture callback's interleaved samples through the pipeline.
    ///
    /// Returns however many 16 kHz mono samples are ready *now*, which for a
    /// resampled stream may be none: the resampler consumes fixed blocks, so a
    /// short callback is buffered until it can fill one. Callers append the
    /// result to a rolling buffer, so an empty return is not a special case.
    pub fn process(&mut self, samples: &[f32]) -> Vec<f32> {
        let mono = downmix(samples, self.source_channels, self.selected_channel);

        // Split the borrow so `pending`/`in_buf`/`out_buf` stay reachable while
        // `resampler` is mutably borrowed.
        let Self {
            resampler,
            pending,
            in_buf,
            out_buf,
            warned,
            in_count,
            out_count,
            ..
        } = self;

        let mut out = match resampler.as_mut() {
            None => mono,
            Some(rs) => {
                *in_count += mono.len();
                pending.extend_from_slice(&mono);
                let mut out = Vec::new();
                loop {
                    let need = rs.input_frames_next();
                    if pending.len() < need {
                        break;
                    }
                    in_buf[0].clear();
                    in_buf[0].extend_from_slice(&pending[..need]);
                    pending.drain(..need);

                    match rs.process_into_buffer(in_buf, out_buf, None) {
                        Ok((_, written)) => {
                            *out_count += written;
                            out.extend_from_slice(&out_buf[0][..written]);
                        }
                        Err(e) => {
                            if !*warned {
                                *warned = true;
                                eprintln!("Resampler error (dropping audio block): {e}");
                            }
                        }
                    }
                }
                out
            }
        };

        self.highpass.process_slice(&mut out);
        out
    }

    /// Run a whole buffer through a fresh pipeline in one call, including the
    /// resampler's tail. For offline/batch use — a live stream must hold an
    /// [`AudioPreprocessor`] across callbacks instead.
    pub fn process_all(
        samples: &[f32],
        source_sample_rate: u32,
        source_channels: u16,
        selected_channel: Option<u16>,
    ) -> Vec<f32> {
        let mut pre = Self::new(source_sample_rate, source_channels, selected_channel);
        let mut out = pre.process(samples);
        out.extend(pre.flush());
        out
    }

    /// Push the resampler's remaining audio out at end of stream: first the
    /// partial block still in `pending`, then the tail sitting in the FFT
    /// delay line.
    ///
    /// Both halves are audio the microphone really captured, and both used to
    /// be dropped. The delay line is the less obvious one: an FFT resampler's
    /// output lags its input by `output_delay()` samples, so when a stream
    /// stops, the last 10-20 ms at typical device rates has been consumed but
    /// not yet emitted. Draining `pending` cannot recover it — and when the
    /// capture happens to end on a block boundary `pending` is empty, which is
    /// precisely when the old early-return meant *nothing* came out.
    ///
    /// Across a 90-minute service that tail is nothing. Across a push-to-talk
    /// dictation or a voice search — which stop the stream once per utterance
    /// — it is the end of the last word, and the last word is usually the one
    /// that carried the reference.
    pub fn flush(&mut self) -> Vec<f32> {
        let Self {
            resampler,
            pending,
            out_buf,
            source_sample_rate,
            in_count,
            out_count,
            ..
        } = self;

        let Some(rs) = resampler.as_mut() else {
            // A 16 kHz source goes straight to the filter, so there is no
            // block buffering and no delay line to drain.
            return Vec::new();
        };

        let mut out = Vec::new();

        // 1. The partial block. `process_partial_into_buffer` takes a short
        //    input as-is, so we never pad the audio itself with silence to
        //    reach a full block.
        if !pending.is_empty() {
            let tail = std::mem::take(pending);
            if let Ok((_, written)) = rs.process_partial_into_buffer(Some(&[tail]), out_buf, None) {
                *out_count += written;
                out.extend_from_slice(&out_buf[0][..written]);
            }
        }

        // 2. The delay line. Passing `None` clocks the resampler forward on
        //    zeros; output up to `expected` is audio it already took in, and
        //    everything past that is the zero-padding used to push it out, so
        //    the final emit is trimmed instead of appended whole.
        //
        //    Skipped entirely when nothing was ever fed: draining then would
        //    emit `output_delay()` samples of pure padding for a stream that
        //    never delivered a callback.
        if *in_count > 0 {
            let expected = *in_count * TARGET_SAMPLE_RATE as usize
                / *source_sample_rate as usize
                + rs.output_delay();
            for _ in 0..MAX_FLUSH_ROUNDS {
                if *out_count >= expected {
                    break;
                }
                match rs.process_partial_into_buffer::<&[f32], Vec<f32>>(None, out_buf, None) {
                    Ok((_, written)) => {
                        let take = (expected - *out_count).min(written);
                        *out_count += take;
                        out.extend_from_slice(&out_buf[0][..take]);
                    }
                    Err(_) => break,
                }
            }
        }

        self.highpass.process_slice(&mut out);
        out
    }
}

#[cfg(test)]
mod downmix_tests {
    use super::downmix;

    #[test]
    fn mono_passes_through_untouched() {
        let s = [0.1, -0.2, 0.3];
        assert_eq!(downmix(&s, 1, None), s.to_vec());
        // A channel selection on a mono device is meaningless, not an error.
        assert_eq!(downmix(&s, 1, Some(3)), s.to_vec());
    }

    #[test]
    fn averages_all_channels_by_default() {
        // Two frames of stereo: (1.0, 0.0) and (0.5, -0.5).
        let s = [1.0, 0.0, 0.5, -0.5];
        assert_eq!(downmix(&s, 2, None), vec![0.5, 0.0]);
    }

    #[test]
    fn takes_only_the_selected_channel() {
        let s = [1.0, 0.0, 0.5, -0.5];
        assert_eq!(downmix(&s, 2, Some(0)), vec![1.0, 0.5]);
        assert_eq!(downmix(&s, 2, Some(1)), vec![0.0, -0.5]);
    }

    #[test]
    fn isolates_a_vocal_aux_from_a_four_channel_desk() {
        // ch0/ch1 carry the FOH mix, ch2 the vocal aux, ch3 unused. Averaging
        // buries the vocal; selecting it recovers the feed exactly.
        let s = [0.8, 0.8, 0.2, 0.0, 0.6, 0.6, 0.1, 0.0];
        assert_eq!(downmix(&s, 4, Some(2)), vec![0.2, 0.1]);
        assert_ne!(downmix(&s, 4, None), vec![0.2, 0.1]);
    }

    #[test]
    fn out_of_range_selection_falls_back_to_averaging() {
        // The setting is stored per user, not per device: unplugging the
        // interface and running off a built-in stereo mic must keep working.
        let s = [1.0, 0.0, 0.5, -0.5];
        assert_eq!(downmix(&s, 2, Some(7)), downmix(&s, 2, None));
    }

    #[test]
    fn drops_a_trailing_partial_frame() {
        // Averaging a short frame over the full channel count scaled it down.
        let s = [1.0, 1.0, 1.0];
        assert_eq!(downmix(&s, 2, None), vec![1.0]);
        assert_eq!(downmix(&s, 2, Some(0)), vec![1.0]);
    }
}

#[cfg(test)]
mod resampler_tests {
    use super::{AudioPreprocessor, TARGET_SAMPLE_RATE};

    /// One second of a mono sine at `freq`, sampled at `rate`.
    fn tone(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .map(|i| {
                (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5
            })
            .collect()
    }

    /// Amplitude at `freq`, by projecting onto a sine and cosine at that
    /// frequency — a single DFT bin. Accumulated in f64: over a second of
    /// 16 kHz audio an f32 accumulator loses the precision this needs.
    /// Cheaper than pulling in an FFT crate to answer one question per test.
    fn amplitude_at(samples: &[f32], freq: f32, rate: u32) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let w = 2.0 * std::f64::consts::PI * freq as f64 / rate as f64;
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, &x) in samples.iter().enumerate() {
            let phase = w * i as f64;
            re += x as f64 * phase.cos();
            im += x as f64 * phase.sin();
        }
        let n = samples.len() as f64;
        (2.0 * (re * re + im * im).sqrt() / n) as f32
    }

    /// The defect this pipeline was rebuilt to fix.
    ///
    /// 15 kHz at 48 kHz input is above the 8 kHz Nyquist limit of a 16 kHz
    /// output. A resampler with an anti-alias filter discards it. Bare
    /// interpolation — what `resample_cubic` did — folds it down to
    /// |15000 - 16000| = 1 kHz, landing it squarely in the speech band where
    /// it is indistinguishable from signal for everything downstream.
    #[test]
    fn alias_above_nyquist_is_rejected() {
        let input = tone(15_000.0, 48_000, 1.0);
        let out = AudioPreprocessor::process_all(&input, 48_000, 1, None);

        assert!(!out.is_empty(), "resampler produced no output");
        let alias = amplitude_at(&out, 1_000.0, TARGET_SAMPLE_RATE);
        assert!(
            alias < 0.01,
            "15 kHz folded back to 1 kHz at amplitude {alias:.4}; \
             the anti-alias filter is not doing its job"
        );
    }

    /// The other half of the claim: rejecting the alias must not cost us the
    /// band we actually read. 1 kHz is mid-vowel, the loudest part of speech.
    #[test]
    fn in_band_tone_survives_resampling() {
        let input = tone(1_000.0, 48_000, 1.0);
        let out = AudioPreprocessor::process_all(&input, 48_000, 1, None);

        let kept = amplitude_at(&out, 1_000.0, TARGET_SAMPLE_RATE);
        // Input amplitude 0.5, times the pipeline's +3 dB (1.4125) ≈ 0.71.
        assert!(
            kept > 0.5,
            "1 kHz came through at only {kept:.4}; the passband is being eaten"
        );
    }

    /// 44.1 kHz is what a consumer interface hands back when it is not asked
    /// otherwise, and it is the ratio (147:160) most likely to break a
    /// resampler built for clean integer decimation.
    #[test]
    fn handles_a_non_integer_ratio() {
        let input = tone(1_000.0, 44_100, 1.0);
        let out = AudioPreprocessor::process_all(&input, 44_100, 1, None);

        let kept = amplitude_at(&out, 1_000.0, TARGET_SAMPLE_RATE);
        assert!(kept > 0.5, "1 kHz from 44.1 kHz came through at {kept:.4}");
    }

    /// Output length must track the rate ratio, or every downstream duration —
    /// segment timestamps, `min_silence_ms`, the level meter — drifts.
    #[test]
    fn output_length_matches_the_rate_ratio() {
        let input = tone(440.0, 48_000, 1.0);
        let out = AudioPreprocessor::process_all(&input, 48_000, 1, None);

        // One second in, one second out, within a resampler block.
        let expected = TARGET_SAMPLE_RATE as usize;
        let slack = super::RESAMPLER_CHUNK_IN;
        assert!(
            out.len().abs_diff(expected) < slack,
            "1 s of 48 kHz gave {} samples, expected ~{expected}",
            out.len()
        );
    }

    /// The audio a resampler is still holding when a capture stops is real
    /// recorded audio, and a push-to-talk dictation ends on exactly that
    /// boundary once per utterance.
    ///
    /// Both endings matter. Stopping mid-block leaves `pending` non-empty, and
    /// that half always worked. Stopping *on* a block boundary leaves it
    /// empty, which is the case the old early-return dropped whole — the
    /// delay line went with it.
    #[test]
    fn flush_recovers_the_tail_the_resampler_still_holds() {
        for (label, len) in [
            ("block-aligned", 4 * super::RESAMPLER_CHUNK_IN),
            ("mid-block", 4 * super::RESAMPLER_CHUNK_IN + 300),
        ] {
            // Silence, then a 1 kHz burst across the final 400 source samples
            // (~8 ms at 48 kHz) — inside the delay line when the stream stops.
            let mut input = vec![0.0f32; len];
            let burst = 400;
            for (i, sample) in input[len - burst..].iter_mut().enumerate() {
                *sample =
                    (2.0 * std::f32::consts::PI * 1_000.0 * i as f32 / 48_000.0).sin() * 0.5;
            }

            let mut pre = AudioPreprocessor::new(48_000, 1, None);
            let live = pre.process(&input);
            let flushed = pre.flush();
            let peak = |v: &[f32]| v.iter().fold(0.0f32, |m, s| m.max(s.abs()));

            assert!(
                !flushed.is_empty(),
                "{label}: flush() gave nothing back, so the delay line was never drained"
            );
            assert!(
                peak(&flushed) > 0.05,
                "{label}: the flushed tail is silent (peak {}) — it is zero-padding, \
                 not the burst that was recorded",
                peak(&flushed)
            );

            // The whole point: what comes out has to account for what went in.
            let total = live.len() + flushed.len();
            let real = len * TARGET_SAMPLE_RATE as usize / 48_000;
            assert!(
                total >= real,
                "{label}: {total} samples out for {real} samples of captured audio — \
                 {} ms is still being lost",
                (real - total) as f32 * 1000.0 / TARGET_SAMPLE_RATE as f32
            );
        }
    }

    /// A device that opened and never delivered a callback must flush to
    /// nothing. Draining the delay line unconditionally would hand the VAD
    /// `output_delay()` samples of invented silence.
    #[test]
    fn flush_emits_nothing_when_no_audio_was_ever_fed() {
        let mut pre = AudioPreprocessor::new(48_000, 1, None);
        assert!(pre.flush().is_empty());
    }

    /// Streaming in ragged callback-sized pieces must give the same audio as
    /// one batch call. This is what makes the preprocessor safe to hold across
    /// a live capture loop, and it fails immediately if the pending buffer
    /// drops or duplicates a block.
    #[test]
    fn chunked_streaming_matches_a_single_pass() {
        let input = tone(1_000.0, 48_000, 0.5);
        let batch = AudioPreprocessor::process_all(&input, 48_000, 1, None);

        let mut pre = AudioPreprocessor::new(48_000, 1, None);
        let mut streamed = Vec::new();
        // Deliberately not a divisor of the resampler block size.
        for chunk in input.chunks(479) {
            streamed.extend(pre.process(chunk));
        }
        streamed.extend(pre.flush());

        assert_eq!(streamed.len(), batch.len());
        for (i, (a, b)) in streamed.iter().zip(batch.iter()).enumerate() {
            assert!(
                (a - b).abs() < 1e-5,
                "sample {i} differs: streamed {a}, batch {b}"
            );
        }
    }

    /// The offline harness reads a recording through this, so a 48 kHz stereo
    /// file must arrive at the VAD as 16 kHz mono of the right duration.
    #[test]
    fn decodes_a_source_rate_wav_through_the_capture_front_end() {
        let dir = std::env::temp_dir();
        let path = dir.join("selah_capture_decode_test.wav");

        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        {
            let mut w = hound::WavWriter::create(&path, spec).expect("create wav");
            for s in tone(1_000.0, 48_000, 1.0) {
                let v = (s * 32767.0) as i16;
                w.write_sample(v).unwrap(); // left
                w.write_sample(v).unwrap(); // right
            }
            w.finalize().expect("finalize wav");
        }

        let out = super::decode_wav_to_capture_mono(&path.to_string_lossy(), None)
            .expect("decode");
        let _ = std::fs::remove_file(&path);

        assert!(
            out.len().abs_diff(TARGET_SAMPLE_RATE as usize) < super::RESAMPLER_CHUNK_IN,
            "1 s of 48 kHz stereo decoded to {} samples", out.len()
        );
        let kept = amplitude_at(&out, 1_000.0, TARGET_SAMPLE_RATE);
        assert!(kept > 0.5, "1 kHz survived the decode at only {kept:.4}");
    }

    /// At the target rate there is no resampler, so audio must pass through
    /// the filter alone — same length in as out, no buffering delay.
    #[test]
    fn passes_through_at_the_target_rate() {
        let input = tone(1_000.0, TARGET_SAMPLE_RATE, 0.1);
        let mut pre = AudioPreprocessor::new(TARGET_SAMPLE_RATE, 1, None);
        let out = pre.process(&input);

        assert_eq!(out.len(), input.len());
        assert!(pre.flush().is_empty());
    }

    /// The filter must not run away. The coefficients this replaced had a pole
    /// at |z| = 1.0076, so every sample multiplied the state by another 0.76%:
    /// continuous 16 kHz audio reached f32 infinity in under a second, and
    /// even chopped into callbacks it put an exponential ramp on the tail of
    /// every chunk. Ten seconds is long enough that anything unstable is not
    /// merely large but non-finite.
    #[test]
    fn stays_stable_over_a_long_run() {
        let input = tone(1_000.0, TARGET_SAMPLE_RATE, 10.0);
        let mut pre = AudioPreprocessor::new(TARGET_SAMPLE_RATE, 1, None);
        let out = pre.process(&input);

        assert!(out.iter().all(|v| v.is_finite()), "filter output diverged");
        let peak = out.iter().fold(0.0f32, |a, b| a.max(b.abs()));
        // Input peak 0.5, passband gain +3 dB (1.4125) ≈ 0.71. Anything much
        // above that is the state growing rather than the signal passing.
        assert!(peak < 1.0, "peak {peak:.3} — the filter is amplifying, not passing");
    }

    /// What the highpass is actually for: rumble (HVAC, stage thump, handling
    /// noise) attenuated while speech passes flat.
    ///
    /// Thresholds come from the filter's own definition rather than taste. A
    /// 2nd-order highpass rolls off 12 dB/octave, so well below the 85 Hz
    /// corner the response approaches (f/f0)^2: 0.221 at 40 Hz (-13.1 dB) and
    /// 0.055 at 20 Hz (-25.1 dB). Asserting those is what makes this a test of
    /// the coefficients and not merely of "some filtering happened" — the
    /// unstable set it replaced would have sailed past a vaguer check.
    #[test]
    fn rejects_rumble_and_passes_speech() {
        let measure = |freq: f32| {
            let input = tone(freq, TARGET_SAMPLE_RATE, 1.0);
            let mut pre = AudioPreprocessor::new(TARGET_SAMPLE_RATE, 1, None);
            amplitude_at(&pre.process(&input), freq, TARGET_SAMPLE_RATE)
        };

        let speech = measure(1_000.0);
        // Input amplitude 0.5 through the pipeline's +3 dB ≈ 0.706, flat.
        assert!(
            (speech - 0.706).abs() < 0.02,
            "1 kHz passband gain is {speech:.4}, expected ~0.706"
        );

        let at_40 = measure(40.0) / speech;
        assert!(
            (0.15..0.30).contains(&at_40),
            "40 Hz relative response {at_40:.3}, expected ~0.22 (-13 dB)"
        );

        let at_20 = measure(20.0) / speech;
        assert!(
            at_20 < 0.09,
            "20 Hz relative response {at_20:.3}, expected ~0.055 (-25 dB)"
        );
    }

    /// The highpass is the reason the preprocessor is per-stream rather than
    /// per-callback: restarted every chunk, its delay taps reopen from zero
    /// and stamp a transient on audio that was continuous.
    #[test]
    fn highpass_state_survives_chunk_boundaries() {
        let input = tone(1_000.0, TARGET_SAMPLE_RATE, 0.1);

        let mut streaming = AudioPreprocessor::new(TARGET_SAMPLE_RATE, 1, None);
        let mut continuous = Vec::new();
        for chunk in input.chunks(160) {
            continuous.extend(streaming.process(chunk));
        }

        // Same audio, but with the filter restarted per chunk — the old
        // behaviour. The two must NOT agree, which is the whole point.
        let mut restarted = Vec::new();
        for chunk in input.chunks(160) {
            let mut fresh = AudioPreprocessor::new(TARGET_SAMPLE_RATE, 1, None);
            restarted.extend(fresh.process(chunk));
        }

        assert_eq!(continuous.len(), restarted.len());
        let worst = continuous
            .iter()
            .zip(restarted.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            worst > 1e-4,
            "restarting the filter per chunk changed nothing (worst delta \
             {worst:.2e}) — the state is not actually being carried"
        );
    }
}
