# Selah

A modern, real-time worship presentation application built with React, TypeScript, and Convex. Selah helps churches manage and display song lyrics, Bible verses, hymns, and media content during services.

![Selah](./final-login-page-screenshot.png)

## Features

### Core Functionality
- **Song Management** - Create, edit, and organize worship songs with verse/chorus structure
- **Bible Display** - Search and display Bible verses with multiple versions support
- **Hymn Library** - Access a comprehensive hymn library with lyrics and verses
- **Media Integration** - Display images, videos, and external content (YouTube, Vimeo)
- **Countdown Timers** - Create countdown timers for service start times
- **Alerts & Announcements** - Display priority alerts and announcements

### Presentation Features
- **Live Output** - Separate fullscreen output window for projection
- **Slide Preview** - Preview slides before going live
- **Quick Actions** - Rapid access to common tasks via keyboard shortcuts
- **Templates** - Save and reuse slide designs
- **Schedules** - Organize slides into service schedules

### Technical Features
- **Real-time Sync** - Changes sync instantly across all connected devices
- **Offline Support** - Continue working offline with IndexedDB persistence
- **Dark Mode** - Full dark mode support for comfortable viewing
- **Responsive Design** - Works on desktop and tablet devices
- **Keyboard Shortcuts** - Efficient navigation and control

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **Backend**: Convex (real-time database & functions)
- **Authentication**: Clerk
- **Offline Storage**: Dexie (IndexedDB wrapper)
- **Testing**: Vitest, React Testing Library

## Project Structure

```
selah/
├── convex/                 # Convex backend functions and schema
│   ├── schema.ts          # Database schema definitions
│   ├── users.ts           # User management functions
│   ├── churches.ts        # Church organization functions
│   ├── slides.ts          # Slide CRUD operations
│   ├── songs.ts           # Song library functions
│   ├── schedules.ts       # Service schedule functions
│   └── templates.ts       # Template management
├── src/
│   ├── components/        # React components
│   │   ├── alerts/        # Alert creation modal
│   │   ├── bible/         # Bible selection list
│   │   ├── countdown/     # Countdown timer modal
│   │   ├── editor/        # Slide editor
│   │   ├── hymns/         # Hymn selection list
│   │   ├── library/       # Media library panel
│   │   ├── live/          # Live output display
│   │   ├── media/         # Media picker and upload
│   │   ├── modals/        # Various modal dialogs
│   │   ├── preview/       # Slide preview component
│   │   ├── quick-actions/ # Quick action buttons
│   │   ├── schedules/     # Schedule management
│   │   ├── settings/      # Settings modal
│   │   ├── slides/        # Slide card and chip components
│   │   ├── songs/         # Song list and management
│   │   ├── templates/     # Template browser
│   │   └── sermon-listener/ # Sermon transcription & verse detection
│   ├── hooks/             # Custom React hooks
│   ├── pages/             # Page components
│   │   ├── auth/          # Authentication pages
│   │   ├── Dashboard.tsx  # Main dashboard
│   │   ├── LiveView.tsx   # Fullscreen live output
│   │   └── ChurchSetup.tsx # Church creation/join
│   ├── services/          # External service integrations
│   │   └── sermon-listener/ # Transcription services
│   └── store/             # Zustand state store
├── deploy/
│   └── whisper-cpp/       # Whisper.cpp Docker configuration
├── scripts/
│   └── start-whisper-cpp.sh # Helper script to start Whisper.cpp
└── ...config files
```

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- A Convex account (free tier available)
- A Clerk account (free tier available)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd selah
   ```

2. Install dependencies:
   ```bash
   bun install
   # or
   npm install
   ```

3. Set up environment variables:
   Create a `.env.local` file with:
   ```
   VITE_CONVEX_URL=your_convex_deployment_url
   VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   ```

4. Start the development server:
   ```bash
   bun run dev
   # or
   npm run dev
   ```

5. Open http://localhost:5173 in your browser

### Available Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start development server with hot reload |
| `build` | Build for production |
| `preview` | Preview production build locally |
| `lint` | Run ESLint checks |
| `test` | Run tests once |
| `test:watch` | Run tests in watch mode |
| `whisper:start` | Start local whisper.cpp server (requires Docker or manual setup) |

## Sermon Listener & Transcription

Selah supports real-time sermon transcription with automated scripture detection. You can choose from several transcription providers:

### 1. Web Speech API (Default - No Setup Required)

Browser-native transcription. Requires no additional setup but depends on browser support (best in Chrome/Edge).

**Pros:**
- Works out of the box - no additional software needed
- Good for basic usage

**Cons:**
- Only works in Chrome, Edge, and Safari (not Firefox)
- Requires internet connection (runs via Google's servers)
- May have accuracy issues with religious/biblical terms

### 2. Whisper.cpp (Local/Offline - Recommended for Better Accuracy)

A local whisper.cpp server that runs entirely on your machine. This provides:
- **Fully offline operation** - no internet required after setup
- **Better accuracy** for biblical terms and names
- **Works in any browser**
- **No data leaves your machine**

#### Setting Up Whisper.cpp

**Option A: Using Docker (Recommended)**

1. Install [Docker Desktop](https://www.docker.com/) for your operating system
2. Start Docker Desktop and wait for it to be ready
3. Run the helper script from your project directory:

```bash
bun run whisper:start
# or
npm run whisper:start
```

This script will:
- Build a Docker image with whisper.cpp and the small English model
- Start a container running on port 8080
- Show you the endpoint URL

**Option B: Manual Setup (Without Docker)**

If you don't want to use Docker, you can build whisper.cpp manually:

```bash
# 1. Clone whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# 2. Build the server
mkdir build && cd build
cmake .. -DWHISPER_SERVER=ON
cmake --build . --config Release -j$(nproc)

# 3. Download a model (small.en is recommended for sermons)
cd ..
./models/download-ggml-model.sh small.en

# 4. Start the server
./build/bin/whisper-server -m ./models/ggml-small.en.bin --host 127.0.0.1 --port 8080
```

#### Configuring Whisper.cpp in Selah

1. After starting the whisper.cpp server (it should be running on port 8080)
2. Open Selah and go to **Settings** (gear icon in the header)
3. Find the **Sermon Listener** section
4. Select **Whisper.cpp Local (Offline)** as the transcription provider
5. The endpoint should already be set to `http://127.0.0.1:8080/inference` (default)
6. Click **Save Settings**
7. Return to the Sermon Listener panel and click **Start Listening**

### 3. Whisper API (Remote)

Use a remote OpenAI-compatible Whisper endpoint. This requires:
- A valid endpoint URL (your own server or a service)
- Optional: API key for authentication

**Use this if:**
- You have a cloud-hosted whisper.cpp server
- You're using OpenAI's Whisper API directly
- You want to use a remote transcription service

## Usage Guide

### Creating a Church
1. Sign up for a new account
2. Create a new church or join an existing one using an invite code
3. Set up your church profile

### Managing Slides
1. Use the **Quick Actions** panel to create new slides
2. Choose from text, Bible verses, hymns, songs, or media
3. Edit slides using the slide editor
4. Drag and drop to reorder slides

### Going Live
1. Select a slide to preview
2. Click "Go Live" to send to the live output
3. Open the live view in a separate window for projection
4. Use keyboard shortcuts for quick navigation

### Using the Sermon Listener
1. Ensure the Sermon Listener panel is visible on your dashboard
2. Click the settings gear on the panel to configure:
   - Choose your transcription provider (Web Speech, Whisper.cpp, or Whisper API)
   - Set your preferred Bible version for verse lookups
   - Enable auto-lookup and/or auto-display options
3. Click **Start Listening** to begin
4. Speak naturally - the app will detect Bible verse references and display them

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + F` | Toggle fullscreen (live view) |
| Number keys | Quick slide selection |

## Troubleshooting

### "Failed to initialize whisper-cpp provider" Error

This error appears when you select Whisper.cpp as your transcription provider but the whisper.cpp server is not running.

**Solution:**

1. Make sure Docker Desktop is running (if using Docker)
2. Start the whisper.cpp server:
   ```bash
   bun run whisper:start
   ```
3. Wait a few seconds for the server to start
4. In Selah settings, verify the endpoint is set to `http://127.0.0.1:8080/inference`
5. Click **Save Settings** and try again

**To check if whisper.cpp is running:**
```bash
# If using Docker
docker ps

# Or try to reach the server
curl http://127.0.0.1:8080
```

### "Speech recognition not supported"
- Ensure you're using Chrome, Edge, or Safari (not Firefox)
- Check that you're using HTTPS (required for Web Speech API in some browsers)
- On Safari, ensure Siri is enabled in system settings

### No transcription results with Web Speech API
- Check microphone permissions in your browser
- Ensure microphone is working in other apps
- Try speaking more clearly or closer to the microphone

### Verses not being detected
- Ensure you're using standard verse reference formats (e.g., "John 3:16", "Psalm 23:1")
- Try using full book names instead of obscure abbreviations
- Check the browser console for any errors

### Docker Issues

**"Docker not found"**
- Install Docker Desktop from https://www.docker.com/
- Make sure Docker Desktop is running (check the menu bar icon)
- On Linux, you may need to add your user to the docker group: `sudo usermod -aG docker $USER`

**Container won't start**
- Check if port 8080 is already in use: `lsof -i :8080`
- Stop any existing whisper.cpp containers: `docker stop selah-whisper`

### Performance Issues
- The Web Speech API runs in the browser and may use significant CPU
- Consider using a dedicated device for sermon listening
- Whisper.cpp on a local machine provides better performance than Web Speech API

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing-feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [React](https://react.dev/) and [Vite](https://vite.dev/)
- Backend powered by [Convex](https://convex.dev/)
- Authentication by [Clerk](https://clerk.com/)
- Icons from [Lucide](https://lucide.dev/)
- Styling with [Tailwind CSS](https://tailwindcss.com/)
- Transcription powered by [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
