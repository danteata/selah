# Selah

A modern, real-time worship presentation application built with React, TypeScript, and Convex. Selah helps churches manage and display song lyrics, Bible verses, hymns, and media content during services — with AI-powered features like live sermon transcription and automatic scripture detection.

![Selah](./final-login-page-screenshot.png)

## Features

### Core Presentation
- **Song Management** — Create, edit, and organize worship songs with verse/chorus structure
- **Bible Display** — Search and display Bible verses with multiple translation support; upload your own Bible versions via CSV
- **Hymn Library** — Access a comprehensive hymn library with full lyrics
- **Media Integration** — Display images, videos, and external content (YouTube, Vimeo)
- **Countdown Timers** — Create pre-service countdown timers
- **Alerts & Announcements** — Display priority announcements during services

### Presentation & Live Control
- **Live Output** — Separate fullscreen output window for projection via the Presentation API or a second tab
- **Screen Picker** — Select which connected display receives the live output
- **Slide Preview** — Preview slides before going live with rich formatting
- **Rich Text Editor** — TipTap-powered editor with font family, colour, text alignment, and highlight controls
- **Templates** — Save and reuse slide designs
- **Schedules** — Organise slides into named service schedules
- **Draggable Dashboard** — Fully customisable panel layout using react-grid-layout; panel positions and sizes are persisted

### Sermon Listener (AI-Powered)
- **Real-time Transcription** — Listen to a sermon and transcribe it live using one of four providers:
  - **Web Speech API** — Built-in browser speech recognition; no setup required
  - **Whisper.cpp (Local/Offline)** — Self-hosted Docker service for fully offline, high-accuracy transcription
  - **Whisper API (Remote)** — Any OpenAI-compatible Whisper endpoint
  - **ElevenLabs** — Cloud-based transcription via the ElevenLabs API
- **Regex Verse Detection** — Automatically detects spoken Bible references (e.g., "John 3 16") and queues them
- **Semantic Verse Detection** — Uses local ML embeddings (`@xenova/transformers`) to surface contextually relevant scriptures even when an exact reference isn't spoken
- **Transcript Persistence** — Full transcripts are saved to Convex and viewable per-session
- **Feature-Gated Access** — Sermon Listener is gated behind a feature flag / paid plan check

### Admin & Configuration
- **Bible Version Uploader** — Upload custom Bible translations from CSV files directly in the browser
- **Verse Embedding Seeder** — Generate and store vector embeddings for every verse in a Bible version to power semantic search
- **Role-Based Access** — `admin` and `owner` roles grant access to admin tools; regular members see a standard view
- **Church Setup** — Create a new church or join an existing one with an invite code

### Technical Features
- **Real-time Sync** — All slide changes, live state, and schedules sync instantly via Convex subscriptions
- **Offline Support** — IndexedDB persistence via Dexie keeps the app functional without a network
- **Analytics** — Amplitude and PostHog event tracking integrated
- **Payments Integration** — Stripe payment flow scaffolded in `src/services/payments/`
- **Feature Flags** — Per-user/church feature flag system in `src/services/feature-flags/`
- **Dark Mode** — Full dark mode throughout the UI
- **Keyboard Shortcuts** — Undo/redo, fullscreen toggle, and quick slide navigation
- **Deployment** — Production-ready Fly.io configuration for both the main app and the Whisper.cpp sidecar

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, TypeScript, Vite 7 |
| Routing | React Router v7 |
| Styling | Tailwind CSS v4, Framer Motion |
| Rich text editing | TipTap v3 |
| State management | Zustand v5 |
| Backend / real-time DB | Convex v1.31 |
| Authentication | Clerk |
| Local ML / embeddings | `@xenova/transformers` v2 (WASM, in-browser) |
| Offline storage | Dexie v4 (IndexedDB) |
| Dashboard layout | react-grid-layout |
| Analytics | Amplitude, PostHog |
| Testing | Vitest, React Testing Library, happy-dom |
| Containerisation | Docker, Fly.io |

## Project Structure

```
selah/
├── convex/                     # Convex backend (functions + schema)
│   ├── schema.ts               # All table definitions
│   ├── auth.ts / auth.config.js # Clerk-based auth
│   ├── users.ts                # User CRUD & role management
│   ├── churches.ts             # Church org & invite codes
│   ├── slides.ts               # Slide CRUD
│   ├── songs.ts                # Song library
│   ├── schedules.ts            # Service schedules
│   ├── templates.ts            # Slide templates
│   ├── transcripts.ts          # Sermon transcript storage
│   ├── bibleVersions.ts        # Bible version & verse storage
│   └── verseEmbeddings.ts      # Vector embeddings for semantic search
├── src/
│   ├── components/
│   │   ├── admin/              # BibleVersionUploader, VerseEmbeddingSeeder
│   │   ├── alerts/             # AddAlertModal
│   │   ├── bible/              # BibleVerseNavigator, BibleVersionSelect
│   │   ├── countdown/          # AddCountdownModal
│   │   ├── dashboard/          # DashboardLayout, DashboardHeader, DraggablePanel
│   │   ├── editor/             # TipTap slide editor + toolbar
│   │   ├── hymns/              # HymnList
│   │   ├── layout/             # ChurchContext provider
│   │   ├── library/            # LibraryPanel
│   │   ├── live/               # LiveOutput, ScreenPicker
│   │   ├── media/              # MediaPicker, MediaUpload
│   │   ├── modals/             # ConfirmDialog, CreateTemplateModal, ShortcutsModal, …
│   │   ├── preview/            # PreviewContent
│   │   ├── quick-actions/      # QuickActions, QuickActionsSidebar, ActionCard
│   │   ├── schedules/          # ScheduleModal, ScheduleSelector
│   │   ├── sermon-listener/    # SermonListenerPanel, SermonListenerSettings, FeatureGatedSermonListener
│   │   ├── settings/           # SettingsModal, BibleVersionSettings
│   │   ├── slides/             # SlideCard, SlideChip
│   │   ├── songs/              # SongList, AddSongModal
│   │   └── templates/          # TemplateBrowser
│   ├── hooks/
│   │   ├── useSermonListener.ts     # Core sermon listener state machine
│   │   ├── useSemanticVerseSearch.ts # Embedding-based verse search
│   │   ├── useTranscripts.ts        # Convex transcript queries/mutations
│   │   ├── useSlideCreation.ts      # Slide creation helpers
│   │   ├── useUserRole.ts           # Role & permission checks
│   │   ├── useMultiMonitor.ts       # Presentation API integration
│   │   ├── useLiveSync.ts           # Real-time live state sync
│   │   └── …
│   ├── pages/
│   │   ├── auth/               # Login, ForgotPassword, Signup
│   │   ├── Dashboard.tsx       # Main app shell
│   │   ├── LiveView.tsx        # Fullscreen projection output
│   │   ├── ChurchSetup.tsx     # Create / join church
│   │   └── Landing.tsx         # Public marketing page
│   ├── services/
│   │   ├── sermon-listener/    # Transcription providers + verse detection
│   │   │   ├── unifiedTranscription.ts    # Provider abstraction
│   │   │   ├── webSpeechTranscription.ts  # Web Speech API provider
│   │   │   ├── whisperCppTranscription.ts # Local whisper.cpp provider
│   │   │   ├── elevenLabsTranscription.ts # ElevenLabs provider
│   │   │   ├── verseDetection.ts          # Regex-based reference detection
│   │   │   ├── semanticVerseDetection.ts  # ML embedding-based detection
│   │   │   └── localEmbeddings.ts         # Embedding model loader (WASM)
│   │   ├── analytics/          # Amplitude + PostHog helpers
│   │   ├── feature-flags/      # Per-church/user feature gating
│   │   ├── payments/           # Stripe integration (scaffolded)
│   │   └── multi-monitor/      # Presentation API helpers
│   ├── store/
│   │   └── appStore.ts         # Zustand global store
│   ├── types/
│   │   ├── index.ts            # Core domain types (Slide, Song, Church, …)
│   │   └── dashboard.ts        # Dashboard panel layout types
│   └── constants/
│       └── backgrounds.ts      # Preset slide background options
├── deploy/
│   └── whisper-cpp/            # Dockerised Whisper.cpp sidecar
│       ├── Dockerfile
│       └── fly.toml            # Fly.io config for whisper sidecar
├── docs/
│   ├── SERMON_LISTENER.md      # Sermon Listener architecture docs
│   └── whisper-deployment.md   # Whisper.cpp deployment guide
├── plan/
│   ├── feature-parity.md       # Feature roadmap / parity tracking
│   └── bible-data-hybrid-storage.md
├── scripts/
│   └── start-whisper-cpp.sh    # Helper: build & start whisper.cpp via Docker
├── fly.toml                    # Fly.io config for main app
└── Dockerfile                  # Production container for main app
```

## Getting Started

### Prerequisites

- Node.js 18+ or [Bun](https://bun.sh/)
- A [Convex](https://convex.dev/) account (free tier available)
- A [Clerk](https://clerk.com/) account (free tier available)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/danteata/selah.git
   cd selah
   ```

2. Install dependencies:
   ```bash
   bun install
   # or
   npm install
   ```

3. Set up environment variables — create a `.env.local` file:
   ```env
   VITE_CONVEX_URL=your_convex_deployment_url
   VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key

   # Optional: ElevenLabs transcription
   VITE_ELEVENLABS_API_KEY=your_elevenlabs_api_key

   # Optional: Analytics
   VITE_AMPLITUDE_API_KEY=your_amplitude_key
   VITE_POSTHOG_API_KEY=your_posthog_key
   ```

4. Start the Convex dev server in a separate terminal:
   ```bash
   bunx convex dev
   ```

5. (Optional — Desktop only) Set up the Whisper transcription sidecar:
   ```bash
   # Build the whisper server binary for your platform
   cd src-tauri/binaries && ./build-whisper.sh && cd ../..

   # Download the Whisper base.en model (~105MB)
   ./scripts/download-whisper-model.sh
   ```
   The sidecar binary must be rebuilt on each target platform (macOS, Linux, Windows) using `build-whisper.sh` (or `build-whisper.bat` on Windows). The desktop app will fall back to downloading the model at runtime if the download script is skipped.

6. Start the frontend dev server:
   ```bash
   bun run dev
   # or
   npm run dev
   ```

7. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Available Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start the Vite development server |
| `build` | Type-check and build for production |
| `preview` | Preview the production build locally |
| `lint` | Run ESLint |
| `test` | Run all tests once |
| `test:watch` | Run tests in watch mode |
| `whisper:start` | Build and start the local Whisper.cpp server via Docker |
| `download-whisper-model` | Download the bundled Whisper model for desktop transcription |
| `desktop:dev` | Start Tauri desktop app in dev mode |
| `desktop:build` | Build Tauri desktop app for production |

## Sermon Listener

The Sermon Listener panel transcribes a live sermon in real time and automatically detects Bible verse references, queuing them for display on screen. It supports four transcription backends.

### Transcription Providers

#### 1. Web Speech API _(Default — no setup required)_

Uses the browser's native speech recognition. Works immediately in Chrome, Edge, and Safari.

- ✅ Zero setup
- ❌ Requires an internet connection (routes through Google servers)
- ❌ Not supported in Firefox
- ❌ Lower accuracy for biblical names and book titles

#### 2. Whisper.cpp Local _(Recommended for accuracy)_

A Docker-based local server running [whisper.cpp](https://github.com/ggerganov/whisper.cpp) with the `small.en` model.

- ✅ Fully offline — no data leaves your machine
- ✅ Higher accuracy for biblical vocabulary
- ✅ Works in any browser
- ⚠️ Requires Docker (one-time setup)

**Quick start with Docker:**
```bash
bun run whisper:start
```

This builds the Docker image and starts the whisper.cpp server on `http://127.0.0.1:8080`. See [docs/whisper-deployment.md](docs/whisper-deployment.md) for full details including Fly.io cloud deployment.

**Manual build (without Docker):**
```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
mkdir build && cd build
cmake .. -DWHISPER_SERVER=ON
cmake --build . --config Release -j$(nproc)
cd ..
./models/download-ggml-model.sh small.en
./build/bin/whisper-server -m ./models/ggml-small.en.bin --host 127.0.0.1 --port 8080
```

#### 3. Whisper API Remote

Point to any OpenAI-compatible Whisper endpoint (your own server or a cloud service). Configure the endpoint URL and optional API key in Settings.

#### 4. ElevenLabs

Cloud transcription via the [ElevenLabs](https://elevenlabs.io/) API. Requires a `VITE_ELEVENLABS_API_KEY` environment variable.

### Verse Detection

Two detection strategies run in parallel:

| Strategy | How it works |
|---|---|
| **Regex detection** | Matches spoken patterns like "John 3 16" or "Psalm 23 verse 1" against a comprehensive reference parser |
| **Semantic detection** | Runs a local ML model (`@xenova/transformers`) in the browser to produce text embeddings, then performs cosine-similarity search against pre-computed verse embeddings stored in Convex |

Semantic detection requires verse embeddings to be seeded first. Use the **Admin → Verse Embedding Seeder** panel.

### Configuration

1. Open **Settings** (gear icon in the dashboard header)
2. Navigate to the **Sermon Listener** section
3. Select your transcription provider
4. Optionally set your preferred Bible version, enable auto-lookup, and enable auto-display

## Admin Tools

Admin and owner-role users see additional panels on the dashboard:

- **Bible Version Uploader** — Upload a full Bible translation from a CSV file. Expected columns: `book`, `chapter`, `verse`, `text` (with `version` as a column or filename).
- **Verse Embedding Seeder** — Iterates over all verses for a selected Bible version and generates `@xenova/transformers` embeddings, stored in Convex for semantic verse search.

## Dashboard Layout

The dashboard uses `react-grid-layout` for a fully customisable panel arrangement. Panels include:

| Panel | Description |
|---|---|
| Quick Actions | Create slides, search, and common tasks |
| Slide Preview | Shows the currently selected / live slide |
| Live Output Controls | Go live, blank screen, navigate slides |
| Schedule | Current service order |
| Sermon Listener | Transcription and detected verses |
| Library | Songs, hymns, Bible, media |
| Admin (role-gated) | Bible uploader, embedding seeder |

Panel positions and sizes are saved to Convex per-user and restored on reload.

## Deployment

### Main App (Fly.io)

```bash
fly deploy
```

The `fly.toml` in the project root configures the React/Vite app. The `Dockerfile` builds a production image.

### Whisper.cpp Sidecar (Fly.io)

See [docs/whisper-deployment.md](docs/whisper-deployment.md) for deploying the whisper.cpp server as a separate Fly.io app so clients can use it without running Docker locally.

```bash
cd deploy/whisper-cpp
fly deploy
```

## Troubleshooting

### Whisper.cpp server not connecting

1. Confirm Docker Desktop is running: `docker ps`
2. Start the server: `bun run whisper:start`
3. Verify it's reachable: `curl http://127.0.0.1:8080`
4. In Selah Settings, confirm the endpoint is `http://127.0.0.1:8080/inference`

**Port 8080 already in use:**
```bash
lsof -i :8080
docker stop selah-whisper
```

### "Speech recognition not supported"

- Use Chrome, Edge, or Safari (Firefox is not supported by the Web Speech API)
- Ensure you are on HTTPS in production
- On macOS Safari, Siri must be enabled in System Settings

### Verses not detected

- Speak references clearly: "John three sixteen", "Psalm twenty-three one"
- Ensure the correct Bible version is selected in Settings
- For semantic detection, confirm verse embeddings have been seeded for the active version

### Microphone not working

- Check microphone permissions in your browser (`chrome://settings/content/microphone`)
- Verify the microphone works in other apps
- Try a different browser

## Contributing

Contributions are welcome! Please open an issue to discuss significant changes before submitting a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: describe your change'`
4. Push to your fork: `git push origin feature/your-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the LICENSE file for details.

## Acknowledgments

- [React](https://react.dev/) & [Vite](https://vite.dev/) — frontend framework and tooling
- [Convex](https://convex.dev/) — real-time backend
- [Clerk](https://clerk.com/) — authentication
- [TipTap](https://tiptap.dev/) — rich text editor
- [Lucide](https://lucide.dev/) — icons
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [Framer Motion](https://www.framer.com/motion/) — animations
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — local speech recognition
- [Xenova/transformers](https://github.com/xenova/transformers.js) — in-browser ML embeddings
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) — draggable dashboard
