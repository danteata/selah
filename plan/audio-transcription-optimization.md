# Audio Capture & Transcription Optimization Plan

## Executive Summary

This document outlines optimizations for Selah's audio capture and transcription system, leveraging desktop-native capabilities to achieve superior performance compared to the web version.

## Current Architecture Analysis

### Selah's Current Implementation

```
┌─────────────────────────────────────────────────────────────────┐
│                    Current Web-Based Architecture                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Microphone    │───▶│ AudioContext/   │───▶│ WAV/WEBM   │ │
│  │   (MediaStream) │    │ MediaRecorder   │    │ Encoding   │ │
│  └─────────────────┘    └─────────────────┘    └─────┬──────┘ │
│                                                       │        │
│                                                       ▼        │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Transcript    │◀───│ Faster-Whisper  │◀───│ HTTP POST  │ │
│  │   Display       │    │ Server (Remote) │    │ (Network)  │ │
│  └─────────────────┘    └─────────────────┘    └────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Current Limitations

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Browser audio processing | ~50-100ms latency | ScriptProcessorNode runs on main thread |
| Network round-trip | 100-500ms per chunk | HTTP POST to remote server |
| WAV encoding overhead | 10-30ms per chunk | Browser-side encoding |
| Microphone only | Limited source | Browser security model |
| CORS/Proxy complexity | Configuration burden | Browser security model |
| No offline support | Requires internet | Remote server dependency |

## Voicebox Architecture (Reference)

Voicebox demonstrates key desktop-native patterns:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Voicebox Desktop Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │ System Audio    │───▶│ Rust Native     │───▶│ Float32    │ │
│  │ (Loopback)      │    │ Capture         │    │ Samples    │ │
│  └─────────────────┘    └─────────────────┘    └─────┬──────┘ │
│                                                       │        │
│                                                       ▼        │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Transcript    │◀───│ MLX/PyTorch     │◀───│ Local IPC  │ │
│  │   Display       │    │ Whisper (Local) │    │ (No Net)   │ │
│  └─────────────────┘    └─────────────────┘    └────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Voicebox Insights

1. **Native Audio Capture** ([`audio_capture/mod.rs`](/home/daniel/code/opensource/voicebox/tauri/src-tauri/src/audio_capture/mod.rs))
   - Platform-specific implementations (macOS/Windows/Linux)
   - System audio loopback via ScreenCaptureKit (macOS) / WASAPI (Windows)
   - Direct Float32 sample access, no encoding overhead

2. **Local Transcription** ([`backends/mlx_backend.py`](/home/daniel/code/opensource/voicebox/backend/backends/mlx_backend.py))
   - MLX Whisper for Apple Silicon optimization
   - Models cached locally after first download
   - Async transcription with progress tracking

3. **Sidecar Architecture** ([`main.rs`](/home/daniel/code/opensource/voicebox/tauri/src-tauri/src/main.rs))
   - Python server bundled with Tauri app
   - Auto-starts with app, auto-dies on close
   - Local HTTP on port 17493

## Proposed Optimizations

### Phase 1: Native Audio Capture (High Impact)

#### 1.1 System Audio Loopback Capture

**Problem:** Currently limited to microphone input. Sermons often play through system audio.

**Solution:** Implement native audio loopback capture.

```rust
// src-tauri/src/audio_capture/mod.rs
pub struct AudioCaptureState {
    pub samples: Arc<Mutex<Vec<f32>>>,
    pub sample_rate: Arc<Mutex<u32>>,
    pub channels: Arc<Mutex<u16>>,
    pub capture_type: CaptureType, // Microphone | System | Both
}

#[tauri::command]
async fn start_audio_capture(
    capture_type: CaptureType,
    sample_rate: u32, // 16000 for Whisper optimization
) -> Result<(), String> {
    // Platform-specific implementation
}
```

**Benefits:**
- Capture audio from YouTube, Spotify, Zoom, etc.
- No browser permission prompts
- Lower latency (direct OS API access)
- Configurable sample rate (16kHz optimal for Whisper)

#### 1.2 Platform Implementations

| Platform | API | Features |
|----------|-----|----------|
| macOS 12.3+ | ScreenCaptureKit | System audio, app exclusion |
| Windows | WASAPI Loopback | System audio, device selection |
| Linux | PulseAudio Monitor | System audio, pipewire support |

### Phase 2: Local Whisper Integration (High Impact)

#### 2.1 Bundled Whisper.cpp Sidecar

**Problem:** Network latency (100-500ms per chunk) and requires internet.

**Solution:** Bundle whisper.cpp as a sidecar binary.

```json
// tauri.conf.json
{
  "bundle": {
    "externalBin": ["binaries/whisper-cpp"]
  }
}
```

```rust
// src-tauri/src/whisper.rs
#[tauri::command]
async fn transcribe_audio(
    samples: Vec<f32>,
    model: String, // "base.en", "small.en"
) -> Result<TranscriptionResult, String> {
    // Write samples to temp WAV
    // Call whisper.cpp sidecar
    // Return transcription
}
```

**Benefits:**
- Zero network latency
- Complete offline operation
- Privacy (audio never leaves device)
- No API costs

#### 2.2 Model Management

```rust
// src-tauri/src/models.rs
#[tauri::command]
async fn download_model(model: String) -> Result<(), String> {
    // Download from HuggingFace / GitHub releases
    // Show progress via Tauri events
    // Cache in app data directory
}

#[tauri::command]
async fn list_models() -> Vec<ModelInfo> {
    // List downloaded models with sizes
}
```

**Model Recommendations:**

| Model | Size | RAM | Speed | Accuracy |
|-------|------|-----|-------|----------|
| tiny.en | ~75MB | ~400MB | Fastest | Good |
| base.en | ~142MB | ~600MB | Fast | Better |
| small.en | ~466MB | ~1GB | Medium | Great (recommended) |
| distil-small.en | ~300MB | ~800MB | Fast | Great |

### Phase 3: VAD Optimization (Medium Impact)

#### 3.1 Native VAD Implementation

**Problem:** Current VAD runs in browser via ONNX, adding overhead.

**Solution:** Implement VAD in Rust using `vad-rs` or similar.

```rust
// src-tauri/src/vad.rs
use vad_rs::Vad;

pub struct NativeVad {
    vad: Vad,
    speech_buffer: Vec<f32>,
}

impl NativeVad {
    pub fn process(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        // Returns Some(utterance) when speech ends
        // Returns None while speech continues
    }
}
```

**Benefits:**
- Lower CPU usage (native code vs WASM)
- Better integration with audio capture
- Consistent behavior across platforms

#### 3.2 Hybrid Approach (Alternative)

Keep browser VAD but feed it from native audio capture:

```typescript
// src/services/sermon-listener/nativeAudioCapture.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

class NativeAudioCapture {
    async start(onSamples: (samples: Float32Array) => void) {
        // Listen for audio samples from Rust
        await listen('audio-samples', (event) => {
            onSamples(new Float32Array(event.payload as ArrayBuffer));
        });
        
        // Start native capture
        await invoke('start_audio_capture', { 
            sampleRate: 16000,
            captureType: 'system'
        });
    }
}
```

### Phase 4: Streaming Transcription (Medium Impact)

#### 4.1 Real-time Partial Results

**Problem:** Current implementation waits for complete utterances.

**Solution:** Implement streaming transcription with partial results.

```rust
// src-tauri/src/streaming_whisper.rs
#[tauri::command]
async fn start_streaming_transcription() -> Result<(), String> {
    // Spawn whisper.cpp with streaming mode
    // Emit partial results via Tauri events
}

// Frontend receives:
// { "type": "partial", "text": "In the beginning" }
// { "type": "final", "text": "In the beginning God created the heavens and the earth." }
```

#### 4.2 WebSocket Bridge (Alternative)

For remote Whisper servers, use WebSocket instead of HTTP:

```typescript
// src/services/sermon-listener/websocketTranscription.ts
class WebSocketTranscription {
    private ws: WebSocket;
    
    async connect(endpoint: string) {
        this.ws = new WebSocket(endpoint);
        this.ws.binaryType = 'arraybuffer';
    }
    
    sendAudio(samples: Float32Array) {
        this.ws.send(samples.buffer);
    }
    
    onResult(callback: (result: TranscriptionResult) => void) {
        this.ws.onmessage = (event) => {
            callback(JSON.parse(event.data));
        };
    }
}
```

### Phase 5: Audio Pipeline Optimization (Lower Impact)

#### 5.1 Replace ScriptProcessorNode with AudioWorklet

**Problem:** ScriptProcessorNode runs on main thread, causing jitter.

**Solution:** Use AudioWorklet for off-thread audio processing.

```typescript
// src/worklets/audio-capture.worklet.ts
class AudioCaptureWorklet extends AudioWorkletProcessor {
    process(inputs: Float32Array[][]) {
        const input = inputs[0][0];
        if (input) {
            this.port.postMessage(input);
        }
        return true;
    }
}

registerProcessor('audio-capture', AudioCaptureWorklet);
```

#### 5.2 Direct 16kHz Capture

**Problem:** Resampling from 44.1/48kHz adds CPU overhead.

**Solution:** Request 16kHz directly from AudioContext.

```typescript
// Current: resample from 48kHz
const audioContext = new AudioContext(); // defaults to 44100 or 48000

// Optimized: native 16kHz
const audioContext = new AudioContext({ sampleRate: 16000 });
```

## Implementation Priority

| Priority | Feature | Impact | Effort | Dependencies |
|----------|---------|--------|--------|--------------|
| 1 | Local whisper.cpp sidecar | High | Medium | None |
| 2 | Native audio capture (mic) | High | Medium | Tauri setup |
| 3 | System audio loopback | High | High | #2 |
| 4 | Model management UI | Medium | Low | #1 |
| 5 | AudioWorklet migration | Medium | Low | None |
| 6 | Native VAD | Medium | Medium | #2 |
| 7 | Streaming transcription | Medium | Medium | #1 |
| 8 | WebSocket for remote | Low | Low | None |

## Architecture Comparison

### Before (Web-Based)

```
Microphone → AudioContext → ScriptProcessor → WAV Encode → HTTP POST → 
Remote Server → Whisper → HTTP Response → Transcript

Latency: 200-600ms per chunk
Offline: No
Privacy: Audio sent to server
```

### After (Desktop-Native)

```
System Audio → Rust Capture → Float32 Samples → IPC → 
Local whisper.cpp → IPC Event → Transcript

Latency: 50-150ms per chunk
Offline: Yes
Privacy: Audio never leaves device
```

## File Structure

```
src-tauri/
├── src/
│   ├── audio_capture/
│   │   ├── mod.rs           # Platform dispatch
│   │   ├── macos.rs         # ScreenCaptureKit implementation
│   │   ├── windows.rs       # WASAPI loopback implementation
│   │   └── linux.rs         # PulseAudio implementation
│   ├── whisper/
│   │   ├── mod.rs           # Whisper interface
│   │   ├── sidecar.rs       # whisper.cpp sidecar management
│   │   └── models.rs        # Model download/management
│   ├── vad/
│   │   └── mod.rs           # Native VAD implementation
│   └── lib.rs               # Tauri commands
├── binaries/
│   └── whisper-cpp/         # Platform-specific whisper.cpp binaries
└── Cargo.toml

src/
├── services/
│   └── sermon-listener/
│       ├── nativeCaptureService.ts    # Tauri audio capture
│       ├── localWhisperService.ts     # Local whisper.cpp client
│       ├── streamingTranscription.ts  # Streaming support
│       └── index.ts
└── hooks/
    └── useNativeTranscription.ts      # React hook for native transcription
```

## Configuration

```typescript
// src/types/transcription.d.ts
interface DesktopTranscriptionConfig {
    // Audio source
    audioSource: 'microphone' | 'system' | 'both';
    sampleRate: 16000;
    
    // Transcription
    provider: 'local' | 'remote';
    model: 'tiny.en' | 'base.en' | 'small.en' | 'distil-small.en';
    language: string;
    
    // VAD
    vadEnabled: boolean;
    vadSensitivity: number; // 0.0 - 1.0
    
    // Remote (fallback)
    remoteEndpoint?: string;
}
```

## Testing Strategy

1. **Unit Tests**
   - Audio capture sample rate conversion
   - VAD speech detection accuracy
   - Model download resume capability

2. **Integration Tests**
   - End-to-end transcription latency
   - Memory usage during long sessions
   - CPU usage comparison (web vs native)

3. **Performance Benchmarks**
   - Latency: web vs native
   - Memory: web vs native
   - CPU: web vs native
   - Battery impact

## Migration Path

1. **Phase 1:** Add local whisper.cpp as option alongside remote
2. **Phase 2:** Add native audio capture as option
3. **Phase 3:** Make local/native the default for desktop
4. **Phase 4:** Deprecate web-based for desktop builds

## Questions for Consideration

1. Should we support GPU acceleration for whisper.cpp (CUDA/Metal)?
2. What's the minimum RAM requirement for each model?
3. Should models be downloaded on-demand or bundled with installer?
4. How to handle model updates?
5. Should we support custom models (fine-tuned for biblical terms)?

## References

- [Voicebox Source](/home/daniel/code/opensource/voicebox)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Tauri Sidecar](https://tauri.app/v1/guides/building/sidecar/)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
- [WASAPI Loopback](https://docs.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
