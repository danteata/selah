//! Silero VAD (Voice Activity Detection) using ONNX Runtime
//!
//! This module provides native VAD using the same Silero model as the web version,
//! but running directly in Rust for lower latency and no JavaScript bridge overhead.

use ndarray::{Array1, Array2, Array3, IxDyn};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Value;
use std::path::Path;

/// Silero VAD configuration
pub struct VadConfig {
    /// Probability threshold for speech detection (default: 0.5)
    pub speech_threshold: f32,
    /// Probability threshold for silence detection (default: 0.35)
    pub silence_threshold: f32,
    /// Minimum speech duration in milliseconds (default: 250)
    pub min_speech_ms: u32,
    /// Minimum silence duration to end speech in milliseconds (default: 100)
    pub min_silence_ms: u32,
    /// Padding to add around speech segments in milliseconds (default: 30)
    pub speech_pad_ms: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            speech_threshold: 0.5,
            silence_threshold: 0.35,
            min_speech_ms: 250,
            min_silence_ms: 100,
            speech_pad_ms: 30,
        }
    }
}

/// Silero VAD state
pub struct SileroVad {
    session: Session,
    h: Array3<f32>,  // Hidden state (2, 1, 64)
    c: Array3<f32>,  // Cell state (2, 1, 64)
    sample_rate: i64,
    config: VadConfig,
}

impl SileroVad {
    /// Load Silero VAD model from file
    pub fn new(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("Failed to create session builder: {}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("Failed to set optimization level: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load VAD model from {:?}: {}", model_path, e))?;

        // Initialize hidden states with zeros - use fixed dimension arrays
        let h = Array3::<f32>::zeros((2, 1, 64));
        let c = Array3::<f32>::zeros((2, 1, 64));

        Ok(Self {
            session,
            h,
            c,
            sample_rate: 16000,
            config: VadConfig::default(),
        })
    }

    /// Create VAD with custom configuration
    pub fn with_config(model_path: &Path, config: VadConfig) -> Result<Self, String> {
        let mut vad = Self::new(model_path)?;
        vad.config = config;
        Ok(vad)
    }

    /// Process a chunk of audio and return speech probability
    /// Audio must be 16kHz mono f32 samples
    /// Chunk size must be 512, 768, or 1024 samples
    pub fn process(&mut self, audio: &[f32]) -> Result<f32, String> {
        let chunk_size = audio.len();
        
        // Silero VAD expects specific chunk sizes
        if chunk_size != 512 && chunk_size != 768 && chunk_size != 1024 {
            return Err(format!(
                "Invalid VAD chunk size: {}, expected 512, 768, or 1024",
                chunk_size
            ));
        }

        // Create input tensors using fixed dimension arrays for ort 2.0
        // Input: (1, chunk_size) 
        let input_array = Array2::from_shape_vec((1, chunk_size), audio.to_vec())
            .map_err(|e| format!("Failed to create input tensor: {}", e))?;

        // Sample rate: (1,)
        let sr_array = Array1::from_vec(vec![self.sample_rate]);

        // Hidden states: (2, 1, 64)
        let h_array = self.h.clone();
        let c_array = self.c.clone();

        // Create input values using ort 2.0 API
        // Value::from_array returns Value<TensorValueType<T>>, need to convert to Value
        let input_value = Value::from_array(input_array)
            .map_err(|e| format!("Failed to create input value: {}", e))?
            .into_dyn();
        let sr_value = Value::from_array(sr_array)
            .map_err(|e| format!("Failed to create sr value: {}", e))?
            .into_dyn();
        let h_value = Value::from_array(h_array)
            .map_err(|e| format!("Failed to create h value: {}", e))?
            .into_dyn();
        let c_value = Value::from_array(c_array)
            .map_err(|e| format!("Failed to create c value: {}", e))?
            .into_dyn();

        // Get input/output names from the model
        let input_names: Vec<String> = self.session.inputs()
            .iter()
            .map(|input| input.name().to_string())
            .collect();
        
        let _output_names: Vec<String> = self.session.outputs()
            .iter()
            .map(|output| output.name().to_string())
            .collect();

        // Create named inputs for session.run()
        let inputs: Vec<(String, Value)> = vec![
            (input_names[0].clone(), input_value),
            (input_names[1].clone(), sr_value),
            (input_names[2].clone(), h_value),
            (input_names[3].clone(), c_value),
        ];

        // Run inference
        let outputs = self.session
            .run(inputs)
            .map_err(|e| format!("VAD inference failed: {}", e))?;

        // Get output probability - try_extract_tensor returns (&Shape, &[T])
        let output = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output: {}", e))?;
        
        // output is (&Shape, &[f32]) - get the first element
        let probability = output.1[0];

        // Update hidden states
        let hn = outputs[1]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract hn: {}", e))?;
        let cn = outputs[2]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract cn: {}", e))?;

        // Convert back to ndarray - Shape has dimensions as slice
        // Shape implements Index to get dimensions
        let shape_slice = hn.0.as_ref();
        let hn_shape: Vec<usize> = shape_slice.iter().map(|d| *d as usize).collect();
        let shape_slice = cn.0.as_ref();
        let cn_shape: Vec<usize> = shape_slice.iter().map(|d| *d as usize).collect();
        
        // Create Array3 from the data
        self.h = ndarray::Array::from_shape_vec(IxDyn(&hn_shape), hn.1.to_vec())
            .map_err(|e| format!("Failed to reshape hn: {}", e))?
            .into_dimensionality::<ndarray::Ix3>()
            .map_err(|e| format!("Failed to convert hn to Array3: {}", e))?;
        self.c = ndarray::Array::from_shape_vec(IxDyn(&cn_shape), cn.1.to_vec())
            .map_err(|e| format!("Failed to reshape cn: {}", e))?
            .into_dimensionality::<ndarray::Ix3>()
            .map_err(|e| format!("Failed to convert cn to Array3: {}", e))?;

        Ok(probability)
    }

    /// Reset VAD state (call when starting new capture)
    pub fn reset(&mut self) {
        self.h = Array3::<f32>::zeros((2, 1, 64));
        self.c = Array3::<f32>::zeros((2, 1, 64));
    }

    /// Check if probability indicates speech
    pub fn is_speech(&self, probability: f32) -> bool {
        probability >= self.config.speech_threshold
    }

    /// Check if probability indicates silence
    pub fn is_silence(&self, probability: f32) -> bool {
        probability < self.config.silence_threshold
    }

    /// Get the configuration
    pub fn config(&self) -> &VadConfig {
        &self.config
    }
}

/// VAD-based speech segmenter
/// Accumulates audio and emits complete speech segments
pub struct VadSegmenter {
    vad: SileroVad,
    /// Buffer for accumulating audio samples
    audio_buffer: Vec<f32>,
    /// Buffer for current speech segment
    speech_buffer: Vec<f32>,
    /// Whether currently in a speech segment
    is_speaking: bool,
    /// Number of silence chunks since speech ended
    silence_chunks: u32,
    /// Sample rate (16kHz)
    sample_rate: u32,
    /// Chunk size for VAD processing
    chunk_size: usize,
    /// Pre-speech buffer (to capture start of words)
    pre_speech_buffer: Vec<f32>,
    /// Pre-speech buffer duration in chunks
    pre_speech_chunks: usize,
}

impl VadSegmenter {
    /// Create a new VAD segmenter
    pub fn new(model_path: &Path) -> Result<Self, String> {
        Self::with_config(model_path, VadConfig::default())
    }

    /// Create a VAD segmenter with custom configuration
    pub fn with_config(model_path: &Path, config: VadConfig) -> Result<Self, String> {
        let vad = SileroVad::with_config(model_path, config)?;
        
        Ok(Self {
            vad,
            audio_buffer: Vec::new(),
            speech_buffer: Vec::new(),
            is_speaking: false,
            silence_chunks: 0,
            sample_rate: 16000,
            chunk_size: 512,  // 32ms at 16kHz
            pre_speech_buffer: Vec::new(),
            pre_speech_chunks: 10,  // ~320ms pre-speech buffer
        })
    }

    /// Process audio samples and return complete speech segments
    /// Returns Some(wav_data) when a complete speech segment is detected
    pub fn process(&mut self, samples: &[f32]) -> Result<Option<Vec<f32>>, String> {
        // Add samples to buffer
        self.audio_buffer.extend_from_slice(samples);

        let mut result = None;

        // Process in VAD-sized chunks
        while self.audio_buffer.len() >= self.chunk_size {
            // Extract chunk
            let chunk: Vec<f32> = self.audio_buffer.drain(..self.chunk_size).collect();

            // Run VAD
            let probability = self.vad.process(&chunk)?;

            if self.vad.is_speech(probability) {
                if !self.is_speaking {
                    // Speech started
                    self.is_speaking = true;
                    // Add pre-speech buffer to capture start of words
                    self.speech_buffer.extend_from_slice(&self.pre_speech_buffer);
                }
                self.speech_buffer.extend_from_slice(&chunk);
                self.silence_chunks = 0;
                
                // Update pre-speech buffer
                self.pre_speech_buffer.extend_from_slice(&chunk);
                if self.pre_speech_buffer.len() > self.chunk_size * self.pre_speech_chunks {
                    let drain_count = self.pre_speech_buffer.len() - self.chunk_size * self.pre_speech_chunks;
                    self.pre_speech_buffer.drain(..drain_count);
                }
            } else if self.is_speaking {
                // Still in speech segment but detected silence
                self.speech_buffer.extend_from_slice(&chunk);
                self.silence_chunks += 1;

                // Check if silence duration exceeds threshold
                let silence_ms = (self.silence_chunks as u32 * self.chunk_size as u32 * 1000) / self.sample_rate;
                if silence_ms >= self.vad.config().min_silence_ms {
                    // Speech segment ended
                    let speech_samples = self.speech_buffer.len() as u32;
                    let speech_ms = (speech_samples * 1000) / self.sample_rate;

                    // Only emit if speech duration meets minimum
                    if speech_ms >= self.vad.config().min_speech_ms {
                        result = Some(std::mem::take(&mut self.speech_buffer));
                    }

                    // Reset for next segment
                    self.speech_buffer.clear();
                    self.is_speaking = false;
                    self.silence_chunks = 0;
                }
            } else {
                // Not speaking, update pre-speech buffer
                self.pre_speech_buffer.extend_from_slice(&chunk);
                if self.pre_speech_buffer.len() > self.chunk_size * self.pre_speech_chunks {
                    let drain_count = self.pre_speech_buffer.len() - self.chunk_size * self.pre_speech_chunks;
                    self.pre_speech_buffer.drain(..drain_count);
                }
            }
        }

        Ok(result)
    }

    /// Flush any remaining speech buffer
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if !self.speech_buffer.is_empty() {
            let speech_samples = self.speech_buffer.len() as u32;
            let speech_ms = (speech_samples * 1000) / self.sample_rate;

            if speech_ms >= self.vad.config().min_speech_ms {
                return Some(std::mem::take(&mut self.speech_buffer));
            }
        }
        None
    }

    /// Reset segmenter state
    pub fn reset(&mut self) {
        self.vad.reset();
        self.audio_buffer.clear();
        self.speech_buffer.clear();
        self.pre_speech_buffer.clear();
        self.is_speaking = false;
        self.silence_chunks = 0;
    }

    /// Check if currently in a speech segment
    pub fn is_speaking(&self) -> bool {
        self.is_speaking
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vad_config_defaults() {
        let config = VadConfig::default();
        assert_eq!(config.speech_threshold, 0.5);
        assert_eq!(config.silence_threshold, 0.35);
        assert_eq!(config.min_speech_ms, 250);
        assert_eq!(config.min_silence_ms, 100);
    }
}
