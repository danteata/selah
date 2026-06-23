# Bundled GGUF Whisper models

This directory holds the GGUF Whisper model bundled as the offline default for
the native (transcribe-rs) transcription engine. On first run,
`ModelManager::seed_bundled` copies `ggml-base.en.bin` from here into the app
data dir's `transcription-models/`.

The model file is **not** committed (it's ~142 MB). It is fetched at build time
by `scripts/download-gguf-model.mjs` (run via `npm run download-gguf-model` or
`desktop:prebuild`). This README keeps the Tauri resource glob valid before the
download has run.
