//! Native (in-process) transcription stack for the transcribe-rs migration.
//!
//! - [`models`] — model catalog + downloader (Whisper GGUF + Parakeet ONNX).
//!   Always compiled; depends only on reqwest/sha2/tar/flate2, so it builds and
//!   is testable without the native inference toolchain.
//! - [`engine`] — the `transcribe-rs`-backed inference manager. Gated behind the
//!   `native-transcription` feature since it pulls whisper.cpp + ONNX Runtime.

pub mod commands;
pub mod models;

#[cfg(feature = "native-transcription")]
pub mod engine;

#[cfg(feature = "native-transcription")]
#[allow(unused_imports)]
pub use engine::{TranscriptionConfig, TranscriptionManager, TranscriptionOutput, UnloadTimeout};

#[allow(unused_imports)]
pub use models::{EngineType, ModelInfo, ModelManager};
