# Bundled Whisper Server

This directory contains the faster-whisper server that gets bundled with the Selah desktop app for offline transcription.

## Overview

The whisper server is a Python-based HTTP server that provides transcription endpoints using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2-based implementation). It's packaged as a standalone executable using PyInstaller and bundled with the Tauri app as a sidecar.

## Building the Server

### Prerequisites

- Python 3.9+
- pip

### Build for Current Platform

```bash
./build-whisper.sh
```

This will create a standalone executable in `dist/selah-whisper-server-{platform}`.

### Platform-Specific Notes

**macOS:**
- The executable will be signed with your developer certificate during the Tauri build process
- Models are downloaded on first use to `~/.cache/huggingface/`

**Windows:**
- Requires Visual C++ Redistributable
- Models are downloaded to `%USERPROFILE%\.cache\huggingface\`

**Linux:**
- Requires glibc 2.17+
- Models are downloaded to `~/.cache/huggingface/`

## Server API

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/transcribe` | POST | Transcribe audio file |
| `/transcribe-raw` | POST | Transcribe raw PCM audio |
| `/models` | GET | List available models |
| `/load-model` | POST | Load a specific model |

### Example Usage

```bash
# Health check
curl http://127.0.0.1:17493/health

# Transcribe a file
curl -X POST http://127.0.0.1:17493/transcribe \
  -F "audio=@recording.wav" \
  -F "language=en" \
  -F "vad_filter=true"

# List models
curl http://127.0.0.1:17493/models
```

## Available Models

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | 75MB | Fastest | Lowest |
| tiny.en | 75MB | Fastest | Low (English only) |
| base | 150MB | Fast | Good |
| base.en | 150MB | Fast | Good (English only) |
| small | 500MB | Medium | Better |
| small.en | 500MB | Medium | Better (English only) |
| medium | 1.5GB | Slow | High |
| medium.en | 1.5GB | Slow | High (English only) |
| large-v3 | 3GB | Slowest | Best |
| distil-large-v3 | 1.5GB | Medium | High |

**Recommended:** `base.en` for English sermons - good balance of speed and accuracy.

## Integration with Selah

The server is automatically managed by the Tauri backend:

1. **Start**: Called via `start_whisper_server` Tauri command
2. **Stop**: Called via `stop_whisper_server` Tauri command
3. **Status**: Checked via `get_whisper_server_status` Tauri command

The frontend uses the `desktopWhisperService.ts` to communicate with the server.

## Development

### Running Locally (Without Building)

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python whisper-server.py --port 17493 --model base.en
```

### Testing

```bash
# Run with a test file
python whisper-server.py --port 17493 --model base.en &
curl -X POST http://127.0.0.1:17493/transcribe -F "audio=@test.wav"
```

## Troubleshooting

### Server Won't Start

1. Check if port 17493 is already in use
2. Check if Python dependencies are installed
3. Check logs for error messages

### Transcription Quality Issues

1. Try a larger model (e.g., `small.en` instead of `base.en`)
2. Enable VAD filtering: `vad_filter=true`
3. Add biblical hotwords for better recognition of religious terms

### Performance Issues

1. Use a smaller model for faster transcription
2. Enable GPU acceleration if available (CUDA)
3. Use `distil-large-v3` for best speed/accuracy balance
