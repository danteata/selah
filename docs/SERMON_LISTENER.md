# Sermon Listener Feature

A real-time sermon transcription and Bible verse detection feature that listens to sermons via microphone and automatically detects when Bible verses are mentioned, looking them up and presenting them live.

## Overview

The Sermon Listener feature uses the Web Speech API for real-time speech recognition and a custom Bible verse detection engine to identify scripture references as they are spoken during a sermon.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sermon Listener System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────┐ │
│  │   Microphone    │───▶│ Speech          │───▶│ Transcript │ │
│  │   (Web Speech   │    │ Recognition     │    │ Buffer     │ │
│  │    API)         │    │ Service         │    │            │ │
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

## Components

### 1. Speech Recognition Service (`src/services/sermon-listener/speechRecognition.ts`)

Wraps the Web Speech API for cross-browser speech recognition.

**Features:**
- Real-time transcription with interim results
- Continuous listening mode
- Language support (configurable)
- Error handling and recovery

**Usage:**
```typescript
import { speechRecognitionService } from '@/services/sermon-listener'

// Start listening
await speechRecognitionService.start({
  lang: 'en-US',
  continuous: true,
  interimResults: true,
  onResult: (transcript, isFinal, confidence) => {
    console.log('Transcript:', transcript, 'Final:', isFinal)
  }
})

// Stop listening
speechRecognitionService.stop()
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

// Convert to internal label format
const label = verseToLabel(verses[0]) // "43:3:16"
```

### 3. useSermonListener Hook (`src/hooks/useSermonListener.ts`)

React hook that combines speech recognition with verse detection.

**Features:**
- Real-time transcription
- Automatic verse detection
- Scripture lookup integration
- Auto-display to live view (optional)

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
    start,
    stop,
    reset,
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

**Usage:**
```tsx
import { SermonListenerPanel } from '@/components/sermon-listener'

// In your dashboard or live view
<SermonListenerPanel
  autoLookup={true}
  autoDisplay={false}
  language="en-US"
/>
```

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

// Check if enabled
const isEnabled = featureFlags.isEnabled('sermon_listener', false)
```

**Use the feature-gated component:**
```tsx
import { FeatureGatedSermonListener } from '@/components/sermon-listener'

<FeatureGatedSermonListener
  autoLookup={true}
  autoDisplay={false}
/>
```

## Settings & Configuration

The Sermon Listener can be configured through app settings, allowing users to toggle between Web Speech API and Whisper.cpp.

### Settings Interface

```typescript
interface SermonListenerSettings {
  /** Enable sermon listener feature */
  enabled?: boolean
  /** Transcription provider: 'web-speech' | 'whisper' */
  transcriptionProvider?: 'web-speech' | 'whisper'
  /** Whisper model size: 'tiny' | 'base' | 'small' | 'medium' */
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium'
  /** Auto-display detected verses */
  autoDisplay?: boolean
  /** Auto-lookup detected verses */
  autoLookup?: boolean
  /** Language for speech recognition */
  language?: string
}
```

### Using the Settings Component

```tsx
import { SermonListenerSettings } from '@/components/sermon-listener'

// In a modal or settings panel
<SermonListenerSettings onClose={() => setShowSettings(false)} />
```

### Programmatic Configuration

```typescript
import { useSermonListener } from '@/hooks'

function MyComponent() {
  const {
    isListening,
    provider,
    isModelLoading,
    modelLoadingProgress,
    start,
    stop,
    setProvider,  // Switch between 'web-speech' and 'whisper'
  } = useSermonListener({
    provider: 'whisper',  // Override settings
    autoLookup: true,
  })

  // Switch provider dynamically
  const handleSwitchToWhisper = async () => {
    const success = await setProvider('whisper')
    if (success) {
      console.log('Switched to Whisper.cpp')
    }
  }

  return (
    <div>
      <p>Current provider: {provider}</p>
      {isModelLoading && (
        <p>Loading model: {modelLoadingProgress}%</p>
      )}
      <button onClick={isListening ? stop : start}>
        {isListening ? 'Stop' : 'Start'}
      </button>
    </div>
  )
}
```

## Browser Support

The Web Speech API is supported in:
- ✅ Chrome 33+
- ✅ Edge 79+
- ✅ Safari 14.1+
- ✅ iOS Safari 14.5+
- ❌ Firefox (not supported)

**Note:** For Firefox and unsupported browsers, the component displays a helpful message indicating the feature is not available.

## Future Enhancements

### Whisper.cpp Integration (Recommended for Production)

For offline/better transcription, you can use [whisper.cpp](https://github.com/ggml-org/whisper.cpp) instead of Web Speech API:

**Why Whisper.cpp?**
- ✅ Works in all browsers (via WASM)
- ✅ Fully offline - no data leaves the device
- ✅ Better accuracy for biblical terms
- ✅ No browser compatibility issues
- ❌ Requires model download (~75MB-1GB)
- ❌ Slight processing delay (batch vs streaming)

**Quick Setup with transformers.js:**

```bash
bun add @xenova/transformers
```

```typescript
// Update useSermonListener to use Whisper
import { pipeline } from '@xenova/transformers'

const transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-base.en',
    { progress_callback: (progress) => console.log(progress) }
)

// Transcribe audio
const result = await transcriber(audioUrl)
console.log(result.text)
```

**Or use whisper.cpp WASM directly:**

See [`src/services/sermon-listener/whisperTranscription.ts`](src/services/sermon-listener/whisperTranscription.ts) for a complete implementation skeleton.

**Model Size Comparison:**
| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny.en | ~75MB | Fastest | Good |
| base.en | ~142MB | Fast | Better |
| small.en | ~466MB | Medium | Great |
| medium.en | ~1.5GB | Slow | Excellent |

For sermon listening, `base.en` or `small.en` are recommended for the best balance of speed and accuracy.
```

## Testing

### Manual Testing

1. Enable the feature flag:
   ```bash
   VITE_FF_SERMON_LISTENER=true
   ```

2. Start the development server:
   ```bash
   bun run dev
   ```

3. Open the app in Chrome or Edge

4. Add the `SermonListenerPanel` to your dashboard or create a test page

5. Click "Start" and speak Bible verses:
   - "John three sixteen"
   - "Psalm twenty-three one"
   - "First Corinthians thirteen four"

### Unit Tests

```typescript
// Test verse detection
import { detectVerses } from '@/services/sermon-listener'

describe('verseDetection', () => {
  it('should detect standard verse references', () => {
    const verses = detectVerses('John 3:16')
    expect(verses).toHaveLength(1)
    expect(verses[0].reference).toBe('John 3:16')
  })

  it('should detect verse ranges', () => {
    const verses = detectVerses('Psalm 23:1-6')
    expect(verses).toHaveLength(1)
    expect(verses[0].verseStart).toBe(1)
    expect(verses[0].verseEnd).toBe(6)
  })

  it('should detect numbered books', () => {
    const verses = detectVerses('1 John 4:8')
    expect(verses).toHaveLength(1)
    expect(verses[0].book).toBe('1 John')
  })
})
```

## Troubleshooting

### "Speech recognition not supported"
- Ensure you're using Chrome, Edge, or Safari
- Check that you're using HTTPS (required for Web Speech API)
- On Safari, ensure Siri is enabled in system settings

### No transcription results
- Check microphone permissions
- Ensure microphone is working in other apps
- Try speaking more clearly or closer to the microphone

### Verses not being detected
- Ensure you're using standard verse reference formats
- Try using full book names instead of obscure abbreviations
- Check the console for any errors

### Performance issues
- The Web Speech API runs in the browser and may use significant CPU
- Consider using a dedicated device for sermon listening
- Future: integrate whisper.cpp for better performance

## Files Created

```
src/
├── services/
│   └── sermon-listener/
│       ├── index.ts              # Service exports
│       ├── speechRecognition.ts  # Web Speech API wrapper
│       └── verseDetection.ts     # Bible verse detection
├── hooks/
│   └── useSermonListener.ts      # React hook
└── components/
    └── sermon-listener/
        ├── index.ts              # Component exports
        ├── SermonListenerPanel.tsx        # Main UI component
        └── FeatureGatedSermonListener.tsx # Feature-flagged wrapper
```

## License

Part of the Selah project.