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
    pub fn duration_secs(&self) -> f64 {
        self.duration_ms as f64 / 1000.0
    }
}

/// Simple linear resampling
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

/// Mix stereo to mono
pub fn mix_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }

    samples
        .chunks(channels as usize)
        .map(|chunk| {
            let sum: f32 = chunk.iter().sum();
            sum / channels as f32
        })
        .collect()
}

/// Process audio samples (mix to mono, resample, and buffer)
pub fn process_audio_samples(
    samples: &[f32],
    source_sample_rate: u32,
    source_channels: u16,
) -> Vec<f32> {
    // Mix to mono if stereo
    let mono_samples = mix_to_mono(samples, source_channels);

    // Resample to 16kHz if needed
    if source_sample_rate != TARGET_SAMPLE_RATE {
        resample_cubic(&mono_samples, source_sample_rate, TARGET_SAMPLE_RATE)
    } else {
        mono_samples
    }
}
