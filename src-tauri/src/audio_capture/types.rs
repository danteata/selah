//! Audio capture types and utilities

use base64::{engine::general_purpose, Engine as _};
use hound::{WavSpec, WavWriter};
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

/// Simple linear resampling
#[allow(dead_code)]
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let new_length = (samples.len() as f64 / ratio) as usize;
    let mut result = Vec::with_capacity(new_length);

    for i in 0..new_length {
        let src_index = i as f64 * ratio;
        let src_index_floor = src_index.floor() as usize;
        let fraction = src_index - src_index_floor as f64;

        // Linear interpolation
        let y0 = samples.get(src_index_floor).copied().unwrap_or(0.0f32);
        let y1 = samples.get(src_index_floor + 1).copied().unwrap_or(y0);

        result.push(y0 * (1.0f32 - fraction as f32) + y1 * fraction as f32);
    }

    result
}

/// Cubic interpolation resampling (higher quality)
pub fn resample_cubic(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let new_length = (samples.len() as f64 / ratio) as usize;
    let mut result = Vec::with_capacity(new_length);

    for i in 0..new_length {
        let src_index = i as f64 * ratio;
        let src_index_floor = src_index.floor() as usize;
        let fraction = src_index - src_index_floor as f64;

        let y0 = samples
            .get(src_index_floor.saturating_sub(1))
            .copied()
            .unwrap_or(0.0);
        let y1 = samples.get(src_index_floor).copied().unwrap_or(0.0);
        let y2 = samples.get(src_index_floor + 1).copied().unwrap_or(y1);
        let y3 = samples.get(src_index_floor + 2).copied().unwrap_or(y2);

        // Cubic interpolation
        let c0 = y1;
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

        let t = fraction as f32;
        result.push(((c3 * t + c2) * t + c1) * t + c0);
    }

    result
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
        const B0: f32 = 0.944_35;
        const B1: f32 = -1.888_70;
        const B2: f32 = 0.944_35;
        const A1: f32 = -1.889_15;
        const A2: f32 = 0.888_25;

        let output = B0 * input + self.d1;
        self.d1 = B1 * input - A1 * output + self.d2;
        self.d2 = B2 * input - A2 * output;
        output
    }

    fn apply(samples: &mut [f32]) {
        let mut filter = Self::new();
        // +3 dB gain ≈ 1.4125 linear
        const GAIN: f32 = 1.4125;
        for sample in samples.iter_mut() {
            *sample = filter.process_sample(*sample) * GAIN;
        }
    }
}

/// Process audio samples (mix to mono, resample, highpass filter, and buffer)
pub fn process_audio_samples(
    samples: &[f32],
    source_sample_rate: u32,
    source_channels: u16,
) -> Vec<f32> {
    process_audio_samples_on_channel(samples, source_sample_rate, source_channels, None)
}

/// As [`process_audio_samples`], but taking a single input channel rather than
/// the average of all of them. See [`downmix`] for why that is worth a setting.
pub fn process_audio_samples_on_channel(
    samples: &[f32],
    source_sample_rate: u32,
    source_channels: u16,
    selected_channel: Option<u16>,
) -> Vec<f32> {
    // Mix to mono if stereo
    let mut mono_samples = downmix(samples, source_channels, selected_channel);

    // Resample to 16kHz if needed
    if source_sample_rate != TARGET_SAMPLE_RATE {
        mono_samples = resample_cubic(&mono_samples, source_sample_rate, TARGET_SAMPLE_RATE);
    }

    // Apply highpass filter (85 Hz) and +3 dB gain to suppress rumble/boost speech
    HighpassFilter::apply(&mut mono_samples);

    mono_samples
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
