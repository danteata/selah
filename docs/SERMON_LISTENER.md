# Sermon Listener Feature

A real-time sermon transcription and Bible verse detection feature that listens to sermons via microphone and automatically detects when Bible verses are mentioned, looking them up and presenting them live.

## Overview

The Sermon Listener feature supports multiple transcription providers:
- **Web Speech API** - Browser-native speech recognition (Chrome, Edge, Safari)
- **Faster-Whisper** - Recommended for production, 2-4x faster than whisper.cpp
- **Whisper.cpp** - Local offline transcription server
- **ElevenLabs** - Cloud-based speech-to-text API

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sermon Listener System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Microphone    │───▶│ MediaRecorder   │───▶│ Audio      │ │
│  │   (MediaStream) │    │ (webm/opus)     │    │ Chunks     │ │
│  └─────────────────┘    └─────────────────┘    └─────┬──────┘ │
│                                                       │        │
│                                                       ▼        │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Live View     │◀───│ Scripture       │◀───│ Verse      │ │
│  │   Display       │    │ Lookup          │    │ Detection  │ │
│  └─────────────────┘    └─────────────────┘    └────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Transcription Providers

### 1. Faster-Whisper (Recommended)

Faster-Whisper uses CTranslate2 for 2-4x faster transcription compared to whisper.cpp. Uses AudioContext for direct PCM capture and encodes to WAV format.

**Advantages:**
- ✅ 2-4x faster than whisper.cpp
- ✅ Direct PCM audio capture via AudioContext
- ✅ Automatic WAV encoding at 16kHz
- ✅ OpenAI-compatible API
- ✅ Lower memory usage
- ✅ Multiple model sizes available

**Note:** The speaches server only accepts mp3, flac, and wav formats. The client captures raw PCM audio and encodes it as WAV before sending.

**Development Setup:**

1. Install and run speaches (faster-whisper server):
```bash
# Using pip
pip install speaches
speaches --model Systran/faster-whisper-base.en

# Or using Docker
docker run -p 8000:8000 ghcr.io/speaches/speaches:latest \
  --model Systran/faster-whisper-base.en
```

2. The server will be available at `http://127.0.0.1:8000`

3. Configure Vite proxy in `vite.config.ts`:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/faster-whisper': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/faster-whisper/, ''),
      },
    },
  },
})
```

4. Set environment variable:
```bash
# .env.local
VITE_FASTER_WHISPER_ENDPOINT=/faster-whisper
```

**Available Models:**
| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny.en | ~75MB | Fastest | Good |
| base.en | ~142MB | Fast | Better |
| small.en | ~466MB | Medium | Great (recommended) |
| medium.en | ~1.5GB | Slow | Excellent |
| distil-large-v3 | ~1.5GB | Fast | Excellent |

For sermon listening, `small.en` is recommended for the best balance of accuracy and reduced hallucination.

### 2. Web Speech API

Browser-native speech recognition. No server required.

**Advantages:**
- ✅ No server setup required
- ✅ Real-time streaming results
- ✅ Works immediately in supported browsers

**Limitations:**
- ❌ Chrome/Edge only (not Firefox)
- ❌ Requires internet (Google servers)
- ❌ May struggle with biblical terms
- ❌ Network errors can interrupt

**Usage:**
No setup required. Just select "Web Speech API" in settings.

### 3. Whisper.cpp

Local whisper.cpp server for offline transcription.

**Setup:**
```bash
# Clone and build
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
make

# Download model
./models/download-ggml-model.sh base.en

# Start server
./build/bin/whisper-server -m ./models/ggml-base.en.bin --host 127.0.0.1 --port 8080
```

**Configure in settings:**
- Endpoint: `http://127.0.0.1:8080/inference`

### 4. ElevenLabs

Cloud-based speech-to-text API with high accuracy.

**Setup:**
1. Get an API key from [ElevenLabs](https://elevenlabs.io)
2. Set environment variable:
```bash
VITE_ELEVENLABS_API_KEY=your_api_key_here
```

## Components

### 1. Faster-Whisper Service (`src/services/sermon-listener/fasterWhisperTranscription.ts`)

Uses MediaRecorder API for clean audio capture with webm format support.

**Features:**
- MediaRecorder-based audio capture
- Webm/opus audio format (no WAV conversion needed)
- Automatic MIME type detection
- Concurrent request management
- OpenAI-compatible API integration

**Usage:**
```typescript
import { fasterWhisperTranscriptionService } from '@/services/sermon-listener'

// Initialize
await fasterWhisperTranscriptionService.init({
  endpoint: '/faster-whisper',
  language: 'en',
  model: 'base.en',
  chunkDurationMs: 2000,
})

// Start realtime transcription
await fasterWhisperTranscriptionService.startRealtimeTranscription(
  (result) => console.log('Transcript:', result.text),
  (error) => console.error('Error:', error)
)

// Stop
await fasterWhisperTranscriptionService.stopRealtimeTranscription()
```

### 2. Verse Detection Service (`src/services/sermon-listener/verseDetection.ts`)

Parses text to detect Bible verse references in various formats.

**Supported Formats:**
- Standard: "John 3:16", "Genesis 1:1"
- Abbreviated: "Jn 3:16", "Gen 1:1", "1 Cor 13:4"
- Ranges: "Psalm 23:1-6", "Romans 8:1-4"
- Numbered books: "1 John 4:8", "2 Timothy 3:16"

**Usage:**
```typescript
import { detectVerses, verseToLabel } from '@/services/sermon-listener'

const text = "As it says in John 3:16, for God so loved the world..."
const verses = detectVerses(text)

// verses[0] = {
//   raw: "John 3:16",
//   reference: "John 3:16",
//   book: "John",
//   chapter: 3,
//   verseStart: 16,
//   confidence: 'high'
// }
```

### 3. useSermonListener Hook (`src/hooks/useSermonListener.ts`)

React hook that combines speech recognition with verse detection.

**Features:**
- Real-time transcription
- Automatic verse detection
- Scripture lookup integration
- Auto-display to live view (optional)
- Semantic verse detection (paraphrases)

**Usage:**
```typescript
import { useSermonListener } from '@/hooks'

function MyComponent() {
  const {
    isListening,
    isSupported,
    transcript,
    detectedVerses,
    currentVerse,
    currentScripture,
    provider,
    start,
    stop,
    reset,
    setProvider,
    displayCurrentVerse,
  } = useSermonListener({
    language: 'en-US',
    autoLookup: true,
    autoDisplay: false,
    onVerseDetected: (verse, scripture) => {
      console.log('Detected:', verse.reference)
    }
  })

  return (
    <div>
      <p>Provider: {provider}</p>
      <button onClick={isListening ? stop : start}>
        {isListening ? 'Stop' : 'Start'} Listening
      </button>
      {detectedVerses.map(verse => (
        <div key={verse.reference}>{verse.reference}</div>
      ))}
    </div>
  )
}
```

### 4. SermonListenerPanel Component (`src/components/sermon-listener/SermonListenerPanel.tsx`)

UI component for the sermon listening feature.

**Props:**
- `autoDisplay`: Automatically display detected verses on live view
- `autoLookup`: Automatically look up scripture content
- `language`: Speech recognition language
- `compact`: Compact mode for sidebar
- `onVerseDetected`: Callback when a verse is detected

## Feature Flag

The feature is controlled by the `sermon_listener` feature flag.

**Enable via environment variable:**
```bash
# .env.local
VITE_FF_SERMON_LISTENER=true
```

**Enable via code:**
```typescript
import { featureFlags } from '@/services/feature-flags'

const isEnabled = featureFlags.isEnabled('sermon_listener', false)
```

## Settings & Configuration

### Settings Interface

```typescript
interface SermonListenerSettings {
  /** Enable sermon listener feature */
  enabled?: boolean
  /** Transcription provider */
  transcriptionProvider?: 'web-speech' | 'whisper' | 'whisper-cpp' | 'faster-whisper' | 'elevenlabs'
  /** Whisper model size */
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium'
  /** Faster-whisper endpoint */
  fasterWhisperEndpoint?: string
  /** Whisper.cpp endpoint */
  whisperCppEndpoint?: string
  /** Chunk size for realtime uploads */
  whisperChunkDurationMs?: number
  /** Auto-display detected verses */
  autoDisplay?: boolean
  /** Auto-lookup detected verses */
  autoLookup?: boolean
  /** Language for speech recognition */
  language?: string
}
```

## Environment Variables

```bash
# Feature flag
VITE_FF_SERMON_LISTENER=true

# Faster-Whisper (recommended)
VITE_FASTER_WHISPER_ENDPOINT=/faster-whisper

# Whisper.cpp (offline)
VITE_WHISPER_CPP_ENDPOINT=http://127.0.0.1:8080/inference

# ElevenLabs
VITE_ELEVENLABS_API_KEY=your_api_key_here
```

## Development Setup

### Quick Start (Web Speech API)

1. No server required
2. Select "Web Speech API" in settings
3. Works in Chrome, Edge, Safari

### Recommended: Faster-Whisper

1. Start the faster-whisper server:
```bash
# Install speaches
pip install speaches

# Run with base.en model (recommended for sermons)
speaches --model Systran/faster-whisper-base.en --host 127.0.0.1 --port 8000
```

2. The Vite proxy is already configured to forward `/faster-whisper` to `http://127.0.0.1:8000`

3. Start Selah:
```bash
bun run dev
```

4. In Selah settings, select "Faster-Whisper" as the transcription provider

### Alternative: Whisper.cpp

1. Build and run whisper.cpp:
```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
make
./models/download-ggml-model.sh base.en
./build/bin/whisper-server -m ./models/ggml-base.en.bin --host 127.0.0.1 --port 8080
```

2. In Selah settings:
   - Provider: "Whisper.cpp Local (Offline)"
   - Endpoint: `http://127.0.0.1:8080/inference`

## Production Deployment

### Deploying Faster-Whisper to Fly.io

See [whisper-deployment.md](./whisper-deployment.md) for detailed instructions.

**Quick deployment:**
```bash
cd deploy/whisper-cpp
fly launch --name your-whisper-server --no-deploy
fly deploy
```

**Configure Selah:**
```bash
VITE_FASTER_WHISPER_ENDPOINT=https://your-whisper-server.fly.dev
```

## Troubleshooting

### "Speech recognition not supported"
- Ensure you're using Chrome, Edge, or Safari
- Check that you're using HTTPS (required for Web Speech API)
- On Safari, ensure Siri is enabled in system settings

### Faster-Whisper connection errors
- Ensure the server is running: `curl http://127.0.0.1:8000/health`
- Check the Vite proxy configuration
- Verify the endpoint URL in settings

### No transcription results
- Check microphone permissions
- Ensure microphone is working in other apps
- Try speaking more clearly or closer to the microphone
- Check browser console for errors

### Verses not being detected
- Ensure you're using standard verse reference formats
- Try using full book names instead of obscure abbreviations
- Check the console for any errors

### Performance issues
- Use faster-whisper with `base.en` model for best balance
- Consider using a dedicated device for sermon listening
- Ensure stable internet connection for cloud providers

## Browser Support

| Browser | Web Speech API | Faster-Whisper | Whisper.cpp |
|---------|---------------|----------------|-------------|
| Chrome 33+ | ✅ | ✅ | ✅ |
| Edge 79+ | ✅ | ✅ | ✅ |
| Safari 14.1+ | ✅ | ✅ | ✅ |
| Firefox | ❌ | ✅ | ✅ |

**Note:** Faster-Whisper and Whisper.cpp work in all browsers since they use MediaRecorder API.

## Files Structure

```
src/
├── services/
│   └── sermon-listener/
│       ├── index.ts                      # Service exports
│       ├── speechRecognition.ts          # Web Speech API wrapper
│       ├── fasterWhisperTranscription.ts # Faster-Whisper (MediaRecorder)
│       ├── whisperCppTranscription.ts    # Whisper.cpp client
│       ├── whisperTranscription.ts       # Whisper API client
│       ├── elevenLabsTranscription.ts    # ElevenLabs client
│       ├── unifiedTranscription.ts       # Unified provider interface
│       ├── verseDetection.ts             # Bible verse detection
│       ├── semanticVerseDetection.ts     # Semantic verse matching
│       └── localEmbeddings.ts            # Local embeddings for semantic search
├── hooks/
│   └── useSermonListener.ts              # React hook
└── components/
    └── sermon-listener/
        ├── index.ts                      # Component exports
        ├── SermonListenerPanel.tsx       # Main UI component
        ├── SermonListenerSettings.tsx    # Settings configuration
        └── FeatureGatedSermonListener.tsx # Feature-flagged wrapper
```

## License

Part of the Selah project.
