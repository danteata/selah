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
    #[allow(dead_code)]
    pub silence_threshold: f32,
    /// Minimum speech duration in milliseconds (default: 250)
    pub min_speech_ms: u32,
    /// Minimum silence duration to end speech in milliseconds (default: 100)
    pub min_silence_ms: u32,
    /// Padding to add around speech segments in milliseconds (default: 30)
    #[allow(dead_code)]
    pub speech_pad_ms: u32,
    /// Number of *consecutive* speech chunks required before a segment is
    /// opened (onset smoothing). A value of 1 reproduces the old behaviour of
    /// reacting to a single frame; higher values reject transient noise — a
    /// cough, a chair scrape, a mic pop — that would otherwise open a bogus
    /// segment. At 512 samples / 32 ms per chunk, 3 ≈ 96 ms. (default: 3)
    pub onset_chunks: usize,
    /// Hard ceiling on how long one speech segment may run before it is cut
    /// and emitted regardless of whether silence was ever heard (default:
    /// 10_000 ms).
    ///
    /// Without this the segmenter only ever closes a segment on
    /// `min_silence_ms` of contiguous sub-threshold audio — which congregational
    /// singing over a band never produces. Silero reports speech continuously,
    /// `speech_buffer` grows without bound, and *nothing is ever transcribed*
    /// even though audio is plainly arriving: the transcript simply stops
    /// mid-song while the level meter keeps moving. Capping the segment
    /// guarantees forward progress for any input, at the cost of an occasional
    /// mid-phrase cut (which {@link CUT_BACK_WINDOW_MS} below minimizes).
    pub max_speech_ms: u32,
    /// Emit a segment anyway once the VAD has reported no speech for this long
    /// while audio is plainly audible (default: 8000 ms; 0 disables).
    ///
    /// Silero detects *speech*. Dense full-band worship, with sustained sung
    /// vowels over drums and keys, is not speech, and it rejects it. Measured
    /// on a five-minute worship track, speech onsets arrived every few seconds
    /// for the first two and a half minutes and then essentially stopped —
    /// three onsets in the remaining two and a half minutes, as the
    /// arrangement thickened. The transcript died with them, while the level
    /// meter showed a strong signal throughout, because nothing had failed:
    /// the VAD was answering the question it was built to answer.
    ///
    /// So this asks a different question. If audio is audible and the VAD has
    /// found nothing in it for a while, hand it to the engine regardless and
    /// let the downstream filters judge the text. The cost is that a purely
    /// instrumental passage now reaches the engine too, and may transcribe to
    /// nonsense; losing the back half of every song is the worse trade.
    pub fallback_after_ms: u32,
    /// RMS below which a frame counts as genuinely silent, and so does not
    /// count toward {@link fallback_after_ms}. Set well under speech level: the
    /// point is only to tell "audio nobody classified" apart from "no audio".
    pub silence_rms: f32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            speech_threshold: 0.5,
            silence_threshold: 0.35,
            min_speech_ms: 250,
            min_silence_ms: 100,
            speech_pad_ms: 30,
            onset_chunks: 3,
            max_speech_ms: 10_000,
            fallback_after_ms: 8_000,
            silence_rms: 0.005,
        }
    }
}

/// Silero VAD state
pub struct SileroVad {
    session: Session,
    h: Array3<f32>, // Hidden state (2, 1, 64)
    c: Array3<f32>, // Cell state (2, 1, 64)
    sample_rate: i64,
    config: VadConfig,
    /// Count of recoveries from a non-finite recurrent state — see `process`.
    nonfinite_recoveries: u64,
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
            nonfinite_recoveries: 0,
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
        let input_names: Vec<String> = self
            .session
            .inputs()
            .iter()
            .map(|input| input.name().to_string())
            .collect();

        let _output_names: Vec<String> = self
            .session
            .outputs()
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
        let outputs = self
            .session
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

        // Silero is recurrent, and `h`/`c` are carried across every call for
        // the whole session. That makes a single non-finite value permanent:
        // the recurrence feeds it forward, `probability` becomes NaN, and
        // because every comparison against NaN is false, `is_speech` answers
        // "no" for the rest of the service. No error is raised and nothing is
        // logged — the level meter keeps moving (features are computed before
        // the VAD runs), while segments, transcript and song tracking all stop
        // dead. Recover by clearing the state and treating this chunk as
        // silence, so a numerical hiccup costs one 32 ms frame instead of the
        // remainder of the session.
        if !probability.is_finite()
            || self.h.iter().any(|v| !v.is_finite())
            || self.c.iter().any(|v| !v.is_finite())
        {
            self.nonfinite_recoveries += 1;
            // Rate-limited: if it ever becomes persistent this would otherwise
            // be ~31 lines a second.
            if self.nonfinite_recoveries == 1 || self.nonfinite_recoveries.is_multiple_of(100) {
                tracing::warn!(
                    "[VAD] non-finite state (probability {:?}); resetting — occurrence {}",
                    probability,
                    self.nonfinite_recoveries
                );
            }
            // Zero the fields directly rather than calling `reset()`: the
            // inference outputs still hold a mutable borrow of `self.session`
            // for this scope, and a whole-`self` method would collide with it.
            self.h = Array3::<f32>::zeros((2, 1, 64));
            self.c = Array3::<f32>::zeros((2, 1, 64));
            return Ok(0.0);
        }

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
    #[allow(dead_code)]
    pub fn is_silence(&self, probability: f32) -> bool {
        probability < self.config.silence_threshold
    }

    /// Get the configuration
    pub fn config(&self) -> &VadConfig {
        &self.config
    }
}

/// How far back from a forced cut we will look for a momentary dip below the
/// speech threshold to cut at instead. A breath between sung phrases is often
/// only one or two chunks long — far short of `min_silence_ms` — so it never
/// closes a segment on its own, but it is still a much better place to split
/// than an arbitrary sample in the middle of a word.
const CUT_BACK_WINDOW_MS: u32 = 1_500;

/// Root mean square level of a frame, the cheapest usable "is there audio
/// here at all" measure.
fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

/// Why a segment ended — the capture loop logs it, because "the VAD produced
/// nothing" and "the VAD produced plenty and nobody transcribed it" look
/// identical from outside and need different fixes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentCause {
    /// Closed normally, on `min_silence_ms` of quiet.
    Silence,
    /// Cut at `max_speech_ms` while speech continued.
    MaxLength,
    /// Audible audio the VAD never called speech (`fallback_after_ms`).
    NoSpeechFallback,
}

impl SegmentCause {
    pub fn as_str(self) -> &'static str {
        match self {
            SegmentCause::Silence => "silence",
            SegmentCause::MaxLength => "max-length",
            SegmentCause::NoSpeechFallback => "no-speech-fallback",
        }
    }
}

/// A completed speech segment plus where it sits on the capture timeline.
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    /// Milliseconds from the first captured sample to this segment's *first*
    /// sample. Callers shift the engine's utterance-relative word timings by
    /// this to put them on the session timeline, so it has to be the segment's
    /// start — using the moment the segment *closed* (which is what the capture
    /// loop's own clock reports) puts every timestamp a whole segment-length
    /// late, and the song tracker's latency estimate reads that as "the
    /// transcript is caught up" when it is seconds behind.
    pub start_ms: u32,
    /// What ended this segment.
    pub cause: SegmentCause,
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
    /// Consecutive speech chunks required to open a segment (onset smoothing)
    onset_chunks: usize,
    /// Consecutive speech chunks seen so far while not yet speaking
    onset_chunks_seen: usize,
    /// Total samples drained through the VAD since the last `reset()`. The
    /// authoritative capture timeline — derived from the audio itself rather
    /// than wall-clock, so it can't drift when the processing thread is late.
    samples_processed: u64,
    /// Length of `speech_buffer` at the most recent sub-threshold chunk within
    /// the current segment, i.e. the last place the voice dipped. Used as the
    /// preferred split point for a forced cut. `None` until the segment has
    /// dipped at all.
    last_dip_len: Option<usize>,
    /// Audible audio the VAD declined to call speech, held in case it declines
    /// for long enough to be worth transcribing anyway. See
    /// `VadConfig::fallback_after_ms`.
    nonspeech_buffer: Vec<f32>,
}

impl VadSegmenter {
    /// Create a new VAD segmenter
    pub fn new(model_path: &Path) -> Result<Self, String> {
        Self::with_config(model_path, VadConfig::default())
    }

    /// Create a VAD segmenter with custom configuration
    pub fn with_config(model_path: &Path, config: VadConfig) -> Result<Self, String> {
        let onset_chunks = config.onset_chunks.max(1);
        let vad = SileroVad::with_config(model_path, config)?;

        Ok(Self {
            vad,
            audio_buffer: Vec::new(),
            speech_buffer: Vec::new(),
            is_speaking: false,
            silence_chunks: 0,
            sample_rate: 16000,
            chunk_size: 512, // 32ms at 16kHz
            pre_speech_buffer: Vec::new(),
            pre_speech_chunks: 10, // ~320ms pre-speech buffer
            onset_chunks,
            onset_chunks_seen: 0,
            samples_processed: 0,
            last_dip_len: None,
            nonspeech_buffer: Vec::new(),
        })
    }

    /// Append a chunk to the rolling pre-speech buffer, trimming it to
    /// `pre_speech_chunks` worth of samples. Used to keep a short pre-roll so
    /// the first word isn't clipped, and to retain onset frames until a
    /// segment is committed.
    fn push_pre_speech(&mut self, chunk: &[f32]) {
        self.pre_speech_buffer.extend_from_slice(chunk);
        let cap = self.chunk_size * self.pre_speech_chunks;
        if self.pre_speech_buffer.len() > cap {
            let drain_count = self.pre_speech_buffer.len() - cap;
            self.pre_speech_buffer.drain(..drain_count);
        }
    }

    /// Process audio samples and return complete speech segments
    /// Returns Some(segment) when a complete speech segment is detected
    pub fn process(&mut self, samples: &[f32]) -> Result<Option<SpeechSegment>, String> {
        // Add samples to buffer
        self.audio_buffer.extend_from_slice(samples);

        let mut result = None;

        // Process in VAD-sized chunks
        while self.audio_buffer.len() >= self.chunk_size {
            // Extract chunk
            let chunk: Vec<f32> = self.audio_buffer.drain(..self.chunk_size).collect();
            self.samples_processed += self.chunk_size as u64;

            // Run VAD
            let probability = self.vad.process(&chunk)?;

            if self.vad.is_speech(probability) {
                // Keep the rolling pre-speech buffer fresh first, so the prefill
                // we prepend on commit already contains the onset frames.
                self.push_pre_speech(&chunk);

                if !self.is_speaking {
                    // Onset smoothing: require N consecutive speech chunks before
                    // committing, so a single noisy frame can't open a segment.
                    self.onset_chunks_seen += 1;
                    if self.onset_chunks_seen >= self.onset_chunks {
                        self.is_speaking = true;
                        self.onset_chunks_seen = 0;
                        self.silence_chunks = 0;
                        self.last_dip_len = None;
                        // The VAD found speech after all, so anything held for
                        // the fallback belongs to this segment's run-up and is
                        // already covered by the pre-speech buffer.
                        self.nonspeech_buffer.clear();
                        // Prepend pre-speech buffer (already includes onset frames
                        // and the current chunk) to capture the start of words.
                        self.speech_buffer
                            .extend_from_slice(&self.pre_speech_buffer);
                    }
                    // Otherwise stay tentatively silent; frames are preserved in
                    // pre_speech_buffer and replayed when/if onset completes.
                } else {
                    self.speech_buffer.extend_from_slice(&chunk);
                    self.silence_chunks = 0;
                }
            } else if self.is_speaking {
                // Still in speech segment but detected silence
                self.speech_buffer.extend_from_slice(&chunk);
                self.silence_chunks += 1;
                // Remember this dip: if the segment later has to be force-cut,
                // splitting here beats splitting mid-word.
                self.last_dip_len = Some(self.speech_buffer.len());

                // Check if silence duration exceeds threshold
                let silence_ms =
                    (self.silence_chunks as u32 * self.chunk_size as u32 * 1000) / self.sample_rate;
                if silence_ms >= self.vad.config().min_silence_ms {
                    // Speech segment ended
                    result = self.close_segment();
                }
            } else {
                // Not speaking and this chunk is silence: the onset run (if any)
                // is broken, so reset it. Keep the pre-speech buffer rolling.
                self.onset_chunks_seen = 0;
                self.push_pre_speech(&chunk);

                // Hold audible-but-unclassified audio, and hand it over once
                // there is enough of it. Genuinely quiet frames clear the hold
                // instead, so a real pause between songs stays a pause rather
                // than accumulating into a spurious segment.
                let fallback_after = self.vad.config().fallback_after_ms;
                if fallback_after > 0 {
                    if rms(&chunk) >= self.vad.config().silence_rms {
                        self.nonspeech_buffer.extend_from_slice(&chunk);
                    } else {
                        self.nonspeech_buffer.clear();
                    }
                    let held_ms =
                        self.nonspeech_buffer.len() as u64 * 1000 / self.sample_rate as u64;
                    if held_ms >= fallback_after as u64 {
                        result = self.emit_nonspeech();
                    }
                }
            }

            // Forced cut. Sustained input that never dips long enough to close a
            // segment — congregational singing over a band is the standard case —
            // would otherwise accumulate forever and never reach the engine.
            if result.is_none() && self.is_speaking && self.speech_ms() >= self.vad.config().max_speech_ms
            {
                result = self.force_cut();
            }

            // A completed segment leaves the rest of this call's audio in
            // `audio_buffer` for the next one, rather than being overwritten by
            // a later segment from the same call (only one can be returned).
            if result.is_some() {
                break;
            }
        }

        Ok(result)
    }

    /// Duration of the open speech buffer in milliseconds. Widened to u64
    /// before scaling: `len * 1000` overflows a u32 at ~75 hours of samples,
    /// and the buffer's only bound is `max_speech_ms`, which is configurable.
    fn speech_ms(&self) -> u32 {
        (self.speech_buffer.len() as u64 * 1000 / self.sample_rate as u64) as u32
    }

    /// Sample offset of the first sample currently in `speech_buffer`.
    fn speech_start_sample(&self) -> u64 {
        self.samples_processed
            .saturating_sub(self.speech_buffer.len() as u64)
    }

    fn start_ms_for(&self, start_sample: u64) -> u32 {
        (start_sample * 1000 / self.sample_rate as u64) as u32
    }

    /// End the open segment normally (silence heard). Emits it if it cleared
    /// `min_speech_ms`; either way the segmenter returns to the not-speaking
    /// state ready for the next utterance.
    fn close_segment(&mut self) -> Option<SpeechSegment> {
        let start_ms = self.start_ms_for(self.speech_start_sample());
        let long_enough = self.speech_ms() >= self.vad.config().min_speech_ms;
        let samples = std::mem::take(&mut self.speech_buffer);
        self.is_speaking = false;
        self.silence_chunks = 0;
        self.last_dip_len = None;
        if long_enough {
            Some(SpeechSegment {
                samples,
                start_ms,
                cause: SegmentCause::Silence,
            })
        } else {
            None
        }
    }

    /// Cut the open segment at `max_speech_ms` and keep listening — the speaker
    /// (or singer) has not stopped, so the tail stays open as the start of the
    /// next segment and no audio is dropped.
    ///
    /// Prefers the most recent momentary dip below the speech threshold as the
    /// split point, when there was one close enough to the cut, so the split
    /// lands in a breath rather than mid-word.
    fn force_cut(&mut self) -> Option<SpeechSegment> {
        let cut_back_samples =
            (CUT_BACK_WINDOW_MS as usize * self.sample_rate as usize) / 1000;
        let split = match self.last_dip_len {
            Some(len)
                if len > 0
                    && len <= self.speech_buffer.len()
                    && self.speech_buffer.len() - len <= cut_back_samples =>
            {
                len
            }
            _ => self.speech_buffer.len(),
        };

        let start_sample = self.speech_start_sample();
        let tail = self.speech_buffer.split_off(split);
        let samples = std::mem::replace(&mut self.speech_buffer, tail);
        // Still speaking: the remainder becomes the head of the next segment.
        self.silence_chunks = 0;
        self.last_dip_len = None;

        Some(SpeechSegment {
            samples,
            start_ms: self.start_ms_for(start_sample),
            cause: SegmentCause::MaxLength,
        })
    }

    /// Hand over audio the VAD never classified as speech. See
    /// `VadConfig::fallback_after_ms` for why this exists.
    fn emit_nonspeech(&mut self) -> Option<SpeechSegment> {
        let samples = std::mem::take(&mut self.nonspeech_buffer);
        if samples.is_empty() {
            return None;
        }
        let start_sample = self.samples_processed.saturating_sub(samples.len() as u64);
        tracing::info!(
            "[VAD] {} ms of audible audio with no detected speech; transcribing it anyway",
            samples.len() as u64 * 1000 / self.sample_rate as u64,
        );
        Some(SpeechSegment {
            samples,
            start_ms: self.start_ms_for(start_sample),
            cause: SegmentCause::NoSpeechFallback,
        })
    }

    /// Flush any remaining speech buffer
    pub fn flush(&mut self) -> Option<SpeechSegment> {
        if self.speech_buffer.is_empty() {
            return None;
        }
        if self.speech_ms() < self.vad.config().min_speech_ms {
            return None;
        }
        let start_ms = self.start_ms_for(self.speech_start_sample());
        Some(SpeechSegment {
            samples: std::mem::take(&mut self.speech_buffer),
            start_ms,
            cause: SegmentCause::Silence,
        })
    }

    /// Reset segmenter state
    pub fn reset(&mut self) {
        self.vad.reset();
        self.audio_buffer.clear();
        self.speech_buffer.clear();
        self.pre_speech_buffer.clear();
        self.is_speaking = false;
        self.silence_chunks = 0;
        self.onset_chunks_seen = 0;
        self.samples_processed = 0;
        self.last_dip_len = None;
        self.nonspeech_buffer.clear();
    }

    /// Check if currently in a speech segment
    pub fn is_speaking(&self) -> bool {
        self.is_speaking
    }

    /// The pre-roll (pre-speech ambience + onset frames) buffered for the
    /// segment that just opened, EXCLUDING its trailing `exclude_len` samples.
    ///
    /// The batch path prepends the whole `pre_speech_buffer` to `speech_buffer`
    /// on commit so the first word isn't clipped. A streaming consumer that
    /// only starts feeding on the `is_speaking` false->true edge would miss
    /// that pre-roll, so it should feed this prefix first. `exclude_len` is the
    /// length of the current tick the caller is about to feed separately (the
    /// pre-roll's tail overlaps it, since those samples were just pushed here),
    /// so subtracting it avoids re-feeding that audio.
    pub fn stream_prefill(&self, exclude_len: usize) -> &[f32] {
        let end = self.pre_speech_buffer.len().saturating_sub(exclude_len);
        &self.pre_speech_buffer[..end]
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
        // Onset smoothing defaults to 3 consecutive speech chunks (~96 ms).
        assert_eq!(config.onset_chunks, 3);
        // Sustained input must be cut and emitted even if it never falls silent.
        assert_eq!(config.max_speech_ms, 10_000);
        // Audible audio the VAD never calls speech is transcribed anyway.
        assert_eq!(config.fallback_after_ms, 8_000);
    }

    #[test]
    fn rms_separates_audible_audio_from_silence() {
        // Digital silence and a dithered-noise floor must both read as silent,
        // or a quiet room would accumulate into fallback segments all service.
        let silence = vec![0.0f32; 512];
        assert!(rms(&silence) < VadConfig::default().silence_rms);

        let noise_floor: Vec<f32> = (0..512)
            .map(|i| if i % 2 == 0 { 0.0005 } else { -0.0005 })
            .collect();
        assert!(rms(&noise_floor) < VadConfig::default().silence_rms);

        // A signal at ordinary programme level must read as audible.
        let audible: Vec<f32> = (0..512)
            .map(|i| ((i as f32) * 0.05).sin() * 0.2)
            .collect();
        assert!(rms(&audible) >= VadConfig::default().silence_rms);
    }

    #[test]
    fn rms_of_nothing_is_zero() {
        assert_eq!(rms(&[]), 0.0);
    }
}
