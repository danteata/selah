# Native Audio Capture for Tauri Desktop App - Handoff Document

## Overview

This document describes the implementation of native audio capture for the Selah desktop app built with Tauri v2. The goal was to provide superior audio quality for transcription by using native Rust audio capture (via `cpal`) instead of web-based audio capture.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (TypeScript)                     │
├─────────────────────────────────────────────────────────────────┤
│  useSermonListener.ts                                           │
│       ↓                                                          │
│  unifiedTranscription.ts (provider: "desktop-whisper")          │
│       ↓                                                          │
│  desktopWhisperTranscription.ts                                 │
│       ↓                                                          │
│  nativeAudioCapture.ts ←→ desktopWhisperService.ts              │
│       ↓                    ↓                                     │
│  Tauri Commands         HTTP POST to localhost:17493            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Rust Backend                              │
├─────────────────────────────────────────────────────────────────┤
│  audio_capture.rs (cpal-based audio capture)                    │
│       ↓                                                          │
│  Tauri Commands:                                                │
│    - list_audio_devices                                         │
│    - start_audio_capture                                        │
│    - stop_audio_capture                                         │
│    - get_audio_chunk                                            │
│    - flush_audio_buffer                                         │
│    - clear_audio_buffer                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Whisper Server (Python)                      │
├─────────────────────────────────────────────────────────────────┤
│  whisper-server.py (Flask + faster-whisper)                     │
│       ↓                                                          │
│  Endpoints:                                                     │
│    - POST /transcribe (FormData with audio file)                │
│    - POST /transcribe-raw (raw PCM bytes)                       │
│    - GET /health                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Files Created/Modified

### Rust Backend

1. **`src-tauri/src/audio_capture.rs`** (NEW)
   - Native audio capture using `cpal` crate
   - Thread-safe state management with `parking_lot::Mutex`
   - Automatic resampling to 16kHz
   - Mono mixing for stereo sources
   - Tauri commands for audio control

2. **`src-tauri/src/main.rs`** (MODIFIED)
   - Added `mod audio_capture`
   - Registered audio capture commands in `invoke_handler`
   - Added `AudioCaptureState` to Tauri state management

3. **`src-tauri/Cargo.toml`** (MODIFIED)
   - Added dependencies:
     - `cpal = "0.15"` - Cross-platform audio I/O
     - `parking_lot = "0.12"` - High-performance mutex
     - `lazy_static = "1.4"` - Static initialization

### TypeScript Frontend

4. **`src/services/sermon-listener/nativeAudioCapture.ts`** (NEW)
   - TypeScript wrapper for Tauri audio commands
   - `NativeAudioCaptureManager` class for easy integration
   - WAV encoding function `float32SamplesToWav()`
   - Automatic chunk polling

5. **`src/services/sermon-listener/desktopWhisperTranscription.ts`** (MODIFIED)
   - Uses native audio capture by default
   - Falls back to web audio if native unavailable
   - Detailed logging for debugging

6. **`src/services/sermon-listener/desktopWhisperService.ts`** (MODIFIED)
   - Added detailed error logging
   - Returns server error text for debugging

### Whisper Server

7. **`src-tauri/binaries/whisper-server.py`** (MODIFIED)
   - Added detailed logging for debugging
   - File size validation
   - Better error messages

## Current Implementation State

### Working Components
- ✅ Tauri binary naming (target-triple format)
- ✅ Tauri shell plugin configuration for v2
- ✅ Whisper server starts successfully
- ✅ Whisper server health endpoint works
- ✅ Native audio capture starts (Rust side)
- ✅ Audio chunks are being captured
- ✅ WAV encoding in TypeScript

### Current Issue
- ❌ Transcription returns 500 error from whisper server
- Error: "Invalid data found when processing input"

### Error Logs
```
[Log] Native audio capture started
[Log] Desktop whisper transcription started (native audio capture)
[Error] Failed to load resource: the server responded with a status of 500 (INTERNAL SERVER ERROR) (transcribe, line 0)
[Error] Desktop whisper transcription failed: – Error: Transcription failed: 500
```

## Debugging Steps Taken

1. **Added detailed logging** to all components:
   - Native audio capture logs chunk size, duration, sample rate
   - WAV encoding logs blob size
   - Whisper server logs file size and transcription parameters

2. **Verified WAV encoding**:
   - Checked header format (RIFF, WAVE, fmt, data chunks)
   - Verified sample rate (16000), channels (1), bits per sample (16)
   - Float32 to Int16 conversion looks correct

3. **Checked audio capture**:
   - Native capture starts successfully
   - Audio chunks are being produced
   - Samples array has data

## Potential Issues to Investigate

1. **Audio Data Quality**
   - The native audio capture might be producing silence or very low volume
   - Check if the microphone is actually being accessed
   - Verify the audio device is not muted

2. **WAV Format Mismatch**
   - The WAV header might have incorrect values
   - The byte order might be wrong (should be little-endian)
   - The sample data might not match the header description

3. **Server-Side Issues**
   - The faster-whisper library might not accept the WAV format
   - The temp file might be corrupted
   - The model might not be loaded correctly

## Next Steps

1. **Test Audio Capture Directly**
   ```bash
   # Run the whisper server directly
   cd src-tauri/binaries
   ./selah-whisper-server-aarch64-apple-darwin --port 17493 --model base.en
   
   # Test with a known-good WAV file
   curl -X POST http://127.0.0.1:17493/transcribe \
     -F "audio=@test.wav"
   ```

2. **Add Audio Level Monitoring**
   - Add a visual indicator for audio levels
   - Log the RMS amplitude of captured audio
   - Verify the microphone is actually capturing sound

3. **Test with Raw PCM Endpoint**
   - Use the `/transcribe-raw` endpoint instead of `/transcribe`
   - Send raw PCM bytes instead of WAV
   - This bypasses potential WAV encoding issues

4. **Compare with Working Implementation**
   - The `fasterWhisperTranscription.ts` has a working `encodeWav` function
   - Compare the WAV encoding between the two implementations
   - Look for any differences in header or data encoding

## Key Code Sections

### WAV Encoding (TypeScript)
```typescript
// src/services/sermon-listener/nativeAudioCapture.ts
export function float32SamplesToWav(samples: number[], sampleRate: number = 16000): Blob {
    const float32Array = new Float32Array(samples);
    const buffer = new ArrayBuffer(44 + float32Array.length * 2);
    const view = new DataView(buffer);

    // WAV header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + float32Array.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, 1, true); // NumChannels (mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, float32Array.length * 2, true);

    // Convert Float32 to Int16
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}
```

### Native Audio Capture (Rust)
```rust
// src-tauri/src/audio_capture.rs
fn process_audio(
    buffer: &Arc<Mutex<Vec<f32>>>,
    buffer_size: &Arc<AtomicUsize>,
    samples: &[f32],
    source_sample_rate: u32,
    source_channels: u16,
) {
    // Mix to mono if stereo
    let mono_samples = if source_channels > 1 {
        samples
            .chunks(source_channels as usize)
            .map(|chunk| {
                let sum: f32 = chunk.iter().sum();
                sum / source_channels as f32
            })
            .collect::<Vec<_>>()
    } else {
        samples.to_vec()
    };

    // Resample to 16kHz if needed
    let resampled = if source_sample_rate != TARGET_SAMPLE_RATE {
        resample(&mono_samples, source_sample_rate, TARGET_SAMPLE_RATE)
    } else {
        mono_samples
    };

    // Add to buffer
    let mut buf = buffer.lock();
    buf.extend_from_slice(&resampled);
    buffer_size.store(buf.len(), Ordering::SeqCst);
}
```

## Testing Commands

```bash
# Build the whisper server binary
cd src-tauri/binaries && ./build-whisper.sh

# Run the desktop app
bun run desktop:dev

# Check if whisper server is running
curl http://127.0.0.1:17493/health

# Test transcription with a sample WAV file
curl -X POST http://127.0.0.1:17493/transcribe -F "audio=@test.wav"
```

## Dependencies

### Rust (Cargo.toml)
```toml
cpal = "0.15"
parking_lot = "0.12"
lazy_static = "1.4"
```

### Python (requirements.txt)
```
flask
flask-cors
faster-whisper
```

## Related Documentation

- [Tauri v2 Documentation](https://v2.tauri.app/)
- [cpal Crate Documentation](https://docs.rs/cpal/latest/cpal/)
- [faster-whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [WAV Format Specification](https://docs.fileformat.com/audio/wav/)
