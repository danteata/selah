# Bundled GGUF transcription model

This directory holds the GGUF model bundled as the offline default for the native
(transcribe-cpp) transcription engine. On first run, `ModelManager::seed_bundled`
copies `moonshine-streaming-small-Q8_0.gguf` from here into the app data dir's
`transcription-models/`.

The bundled model is deliberately a **streaming** one, so live transcription works
with zero downloads on a fresh install. The previous default (`ggml-base.en.bin`,
Whisper base.en) could not stream, which meant the out-of-the-box experience was
batch transcription with a full VAD-utterance of latency. It remains in the
catalog as a `legacy` entry so existing installs keep working, and
`scripts/download-gguf-model.mjs` deletes it from this directory if it is still
lying around — otherwise the resource glob would ship both models.

The model file is **not** committed (it's ~189 MB). It is fetched and
SHA-256-verified at build time by `scripts/download-gguf-model.mjs` (run via
`npm run download-gguf-model` or `desktop:prebuild`). This README keeps the Tauri
resource glob valid before the download has run.
