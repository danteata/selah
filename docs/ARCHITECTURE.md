# Selah Architecture Documentation

A comprehensive technical documentation of the Selah worship presentation application's architecture, design patterns, and implementation details.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Frontend Architecture](#frontend-architecture)
5. [Backend Architecture (Convex)](#backend-architecture-convex)
6. [State Management](#state-management)
7. [Services Layer](#services-layer)
8. [Key Features](#key-features)
9. [Data Models](#data-models)
10. [Authentication & Authorization](#authentication--authorization)
11. [Multi-Monitor Support](#multi-monitor-support)
12. [AI/ML Features](#aiml-features)
13. [Deployment](#deployment)
14. [Development Guidelines](#development-guidelines)

---

## Overview

Selah is a modern, real-time worship presentation application designed for churches to manage and display song lyrics, Bible verses, hymns, and media content during services. It features AI-powered capabilities including live sermon transcription and automatic scripture detection.

### Core Capabilities

- **Presentation Management**: Create, edit, and display slides for songs, Bible verses, hymns, and media
- **Real-time Sync**: All changes sync instantly across connected clients via Convex
- **Multi-Monitor Support**: Separate fullscreen output window for projection
- **AI-Powered Transcription**: Live sermon transcription with automatic verse detection
- **Offline Support**: IndexedDB persistence keeps the app functional without network

---

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2.0 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 7.2.4 | Build tool & dev server |
| React Router | 7.12.0 | Client-side routing |
| Tailwind CSS | 4.1.18 | Styling |
| Framer Motion | 12.34.0 | Animations |
| GSAP | 3.14.2 | Advanced animations |
| TipTap | 3.19.0 | Rich text editing |
| Zustand | 5.0.3 | State management |
| TanStack Query | 5.90.19 | Server state management |
| react-grid-layout | 2.2.2 | Draggable dashboard panels |

### Backend & Infrastructure

| Technology | Version | Purpose |
|------------|---------|---------|
| Convex | 1.31.5 | Real-time backend & database |
| Clerk | 5.59.4 | Authentication provider |
| Dexie | 4.0.10 | IndexedDB wrapper for offline storage |

### AI/ML

| Technology | Purpose |
|------------|---------|
| @xenova/transformers | In-browser ML embeddings (WASM) |
| onnxruntime-web | ONNX model runtime |
| @ricky0123/vad-react | Voice Activity Detection |
| sql.js | In-browser SQLite for Bible data |

### Analytics & Monitoring

| Technology | Purpose |
|------------|---------|
| Amplitude | Analytics |
| PostHog | Product analytics & feature flags |

### Testing

| Technology | Purpose |
|------------|---------|
| Vitest | Test runner |
| React Testing Library | Component testing |
| happy-dom | DOM environment |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   React     │  │   Zustand   │  │   Dexie     │  │   Services  │       │
│  │   Components│  │   Store     │  │  (IndexedDB)│  │   Layer     │       │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│  ┌────────────────────────────────┴────────────────────────────────┐      │
│  │                      Custom Hooks Layer                          │      │
│  │  useSermonListener, useScripture, useSlideCreation, etc.        │      │
│  └────────────────────────────────┬────────────────────────────────┘      │
│                                   │                                         │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONVEX BACKEND                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Users     │  │  Churches   │  │   Slides    │  │   Songs     │       │
│  │   Table     │  │   Table     │  │   Table     │  │   Table     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  Schedules  │  │  Templates  │  │ Transcripts │  │ BibleVers.  │       │
│  │   Table     │  │   Table     │  │   Table     │  │   Table     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                        │
│  │ VerseEmbed. │  │ Invitations │  │ GlobalSett. │                        │
│  │   Table     │  │   Table     │  │   Table     │                        │
│  └─────────────┘  └─────────────┘  └─────────────┘                        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────┐        │
│  │                    Real-time Subscriptions                     │        │
│  │         Auto-sync changes to all connected clients            │        │
│  └───────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Clerk     │  │ Faster-     │  │ ElevenLabs  │  │  Analytics  │       │
│  │   Auth      │  │  Whisper    │  │   API       │  │ (Amplitude/ │       │
│  │             │  │  (STT)      │  │   (STT)     │  │  PostHog)   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Application Entry Point

The application follows a layered architecture with clear separation of concerns:

```typescript
// src/main.tsx - Application bootstrap
// src/App.tsx - Root component with providers
```

**Provider Hierarchy** (innermost to outermost):
1. `ClerkProvider` - Authentication
2. `ConvexProviderWithClerk` - Database with auth integration
3. `QueryClientProvider` - React Query for server state
4. `BrowserRouter` - Client-side routing

### Routing Structure

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Dashboard` | Main application (auth required) |
| `/live` | `LiveView` | Projection output window |
| `/landing` | `Landing` | Marketing/landing page |
| `/login` | `LoginPage` | User login |
| `/signup` | `SignupPage` | User registration |
| `/join/:code` | `JoinChurch` | Church invitation acceptance |
| `/test` | `TestPage` | Development testing |

### Component Organization

```
src/components/
├── admin/           # Admin-only features
│   ├── BibleVersionUploader.tsx
│   ├── GlobalSermonListenerSettings.tsx
│   ├── SongMigrationWizard.tsx
│   └── VerseEmbeddingUploader.tsx
├── alerts/          # Alert/announcement system
├── bible/           # Bible navigation and display
├── countdown/       # Countdown timer functionality
├── dashboard/       # Main dashboard layout
├── editor/          # Slide editing (TipTap)
├── hymns/           # Hymn library
├── layout/          # Layout components
├── library/         # Media library
├── live/            # Live output management
├── media/           # Media upload and picker
├── modals/          # Modal dialogs
├── preview/         # Slide preview
├── quick-actions/   # Quick action sidebar
├── schedules/       # Service schedule management
├── sermon-listener/ # AI transcription feature
├── settings/        # Application settings
├── slides/          # Slide cards and chips
├── songs/           # Song management
├── team/            # Team management
├── templates/       # Template browser
└── utils/           # Shared utility components
```

### Key Component Patterns

#### 1. Modal Management
Modals are controlled via Zustand store state:

```typescript
// Modal state in appStore.ts
interface ModalState {
    settings: boolean
    shortcuts: boolean
    editor: boolean
    mediaPicker: boolean
    templateBrowser: boolean
    alertModal: boolean
    countdownModal: boolean
    libraryPanel: boolean
    scheduleModal: boolean
    lowerThirdEditor: boolean
}

// Usage in components
const modals = useAppStore((state) => state.modals)
const openModal = useAppStore((state) => state.openModal)
const closeModal = useAppStore((state) => state.closeModal)
```

#### 2. Event-Driven Communication
Global events are handled via mitt emitter:

```typescript
// src/types/index.ts
export type AppEvents = {
    'live-transfer': Slide
    'new-text': Slide | undefined | [Slide]
    'new-bible': Slide | undefined | [Slide]
    'go-live': undefined
    'media-seek': number
    // ... more events
}

// Usage
const { emit, on } = useEmitter()
emit('new-bible', slide)
```

---

## Backend Architecture (Convex)

### Database Schema

The Convex backend defines the following tables:

#### Core Tables

| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `users` | User accounts and profiles | `by_email`, `by_church`, `by_clerk_id`, `by_role` |
| `churches` | Church organizations | - |
| `schedules` | Service schedules | `by_church`, `by_author` |
| `slides` | Individual slides | `by_schedule`, `by_church`, `by_user` |
| `songs` | Song library | `by_church`, `by_creator` |
| `templates` | Slide templates | `by_category`, `by_creator` |

#### Specialized Tables

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `bibleVersions` | Bible translation metadata | File storage reference |
| `verseEmbeddings` | Vector embeddings for semantic search | Vector index (384 dimensions) |
| `transcripts` | Sermon transcripts | Detected verses array |
| `invitations` | Team invitation management | Status tracking |
| `globalAppSettings` | System-wide configuration | Singleton document |

### Vector Search

The `verseEmbeddings` table supports semantic Bible verse search:

```typescript
// Vector index configuration
verseEmbeddings: defineTable({
    reference: v.string(),
    book: v.string(),
    bookNumber: v.number(),
    chapter: v.number(),
    verse: v.number(),
    text: v.string(),
    version: v.string(),
    embedding: v.array(v.float64()),
})
.vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 384,  // all-MiniLM-L6-v2 model
    filterFields: ["book", "version"]
})
```

### Convex Functions Structure

```
convex/
├── schema.ts           # Database schema definition
├── auth.ts             # User authentication functions
├── auth.config.js      # Clerk auth configuration
├── users.ts            # User CRUD operations
├── churches.ts         # Church management
├── slides.ts           # Slide operations
├── songs.ts            # Song library
├── schedules.ts        # Service schedules
├── templates.ts        # Template management
├── bibleVersions.ts    # Bible version operations
├── verseEmbeddings.ts  # Embedding operations
├── transcripts.ts      # Transcript storage
├── invitations.ts      # Team invitations
├── globalAppSettings.ts # Global configuration
├── emails.ts           # Email functions
└── migration.ts        # Data migration utilities
```

---

## State Management

### Zustand Store

The application uses Zustand for global state management with persistence:

```typescript
// src/store/appStore.ts
interface AppStore extends AppState {
    // Schedule Management
    setSchedules: (schedules: Schedule[]) => void
    setActiveSchedule: (schedule: Schedule | null) => void
    
    // Slide Operations
    appendActiveSlide: (slide: Slide, position?: number) => void
    updateActiveSlide: (slide: Slide) => void
    removeActiveSlide: (slide: Slide) => void
    setActiveSlides: (slides: Slide[]) => void
    
    // Live Output
    setLiveOutputSlidesId: (slides: string[]) => void
    setLiveSlide: (slideId: string) => void
    
    // UI State
    openModal: (modal: keyof ModalState) => void
    closeModal: (modal: keyof ModalState) => void
    setQuickActionsPage: (page: QuickActionsPage) => void
    
    // Undo/Redo
    undo: () => void
    redo: () => void
    
    // Theme
    toggleDarkMode: () => void
    setDarkMode: (isDark: boolean) => void
}
```

### State Persistence

The store uses Zustand's persist middleware with localStorage:

```typescript
export const useAppStore = create<AppStore>()(
    persist(
        (set, get) => ({ /* ... */ }),
        {
            name: 'selah-app-store',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                // Only persist specific state
                settings: state.settings,
                isDarkMode: state.isDarkMode,
                // ...
            })
        }
    )
)
```

### Offline Support with IndexedDB

Dexie provides offline data persistence:

```typescript
// src/hooks/useIndexedDB.ts
export function useIndexedDB() {
    // Local database for offline slides, songs, etc.
    // Syncs with Convex when online
}
```

---

## Services Layer

The services layer provides abstraction for external integrations:

### Analytics Service

```typescript
// src/services/analytics/index.ts
export type AnalyticsProvider = 'posthog' | 'amplitude' | 'noop'

interface AnalyticsAdapter {
    init(): Promise<void>
    track(event: string, properties?: Record<string, unknown>): void
    identify(userId: string, traits?: Record<string, unknown>): void
    page(name: string): void
}
```

### Feature Flags Service

```typescript
// src/services/feature-flags/index.ts
export type FeatureFlagProvider = 'posthog' | 'config' | 'noop'

interface FeatureFlagAdapter {
    init(): Promise<void>
    isEnabled(flag: string, defaultValue?: boolean): boolean
    getAllFlags(): Record<string, boolean>
}
```

### Payments Service

```typescript
// src/services/payments/index.ts
export type PaymentProvider = 'paystack' | 'noop'

interface PaymentAdapter {
    init(): Promise<void>
    initializeTransaction(options: TransactionOptions): Promise<TransactionResult>
    verifyTransaction(reference: string): Promise<VerificationResult>
}
```

### Sermon Listener Services

The sermon listener feature has multiple service implementations:

```
src/services/sermon-listener/
├── index.ts                      # Service exports
├── speechRecognition.ts          # Web Speech API wrapper
├── fasterWhisperTranscription.ts # Faster-Whisper client
├── whisperCppTranscription.ts    # Whisper.cpp client
├── whisperTranscription.ts       # OpenAI Whisper API client
├── elevenLabsTranscription.ts    # ElevenLabs client
├── unifiedTranscription.ts       # Unified provider interface
├── verseDetection.ts             # Regex-based verse detection
├── semanticVerseDetection.ts     # ML-based verse matching
├── localEmbeddings.ts            # In-browser embeddings
└── vadTranscriptionService.ts    # Voice Activity Detection
```

---

## Key Features

### 1. Slide Management

Slides are the core unit of presentation:

```typescript
interface Slide {
    _id?: string
    id: string
    index: number
    name: string
    type: string           // 'text', 'scripture', 'song', 'hymn', 'media', etc.
    layout: string         // 'full-text', 'split', 'empty', etc.
    contents: string[]
    backgroundType?: string
    background?: string
    backgroundVideoKey?: string | null
    slideStyle?: SlideStyle
    data?: Song | Scripture | Hymn | Countdown | ExtendedFileT
}
```

### 2. Bible Integration

- Multiple Bible version support via CSV upload
- Verse navigation with book/chapter/verse picker
- Semantic verse search using vector embeddings
- Real-time verse lookup during sermon transcription

### 3. Song & Hymn Library

- Song creation with verse/chorus structure
- Hymn library with metadata
- Background assignment per content type
- Template support for consistent styling

### 4. Templates

Reusable slide designs with categories:
- `announcement`
- `worship`
- `sermon`
- `prayer`
- `general`

### 5. Schedules

Service organization with:
- Multiple editors support
- Slide ordering
- Last updated tracking

---

## Data Models

### User

```typescript
interface User {
    _id: string
    fullname: string
    email: string
    role: 'superadmin' | 'admin' | 'member'
    avatar: string
    theme: string
    churchId: string
    emailVerified?: boolean
    subscription?: {
        plan: 'free' | 'teams'
        startDate: string
        endDate: string | null
    }
}
```

### Church

```typescript
interface Church {
    _id: string
    name: string
    type: string
    address: string
    pastor: string
    userIds?: string[]
    users: User[]
    storageUsed?: number
    subscriptionPlan: 'free' | 'teams'
    defaultInviteCode?: string
}
```

### Scripture

```typescript
interface Scripture {
    label: string
    labelShortFormat: string
    version: string
    content: string | BibleVerse[]
}

interface BibleVerse {
    book: string
    chapter: string
    verse: string
    scripture: string
}
```

### Song

```typescript
interface Song {
    _id?: string
    id: string
    lyrics: string
    title: string
    artist: string
    album?: string
    cover?: string
    author?: string
    verses?: string[]
    isPublic?: boolean
    createdBy?: string
    churchId?: string
}
```

---

## Authentication & Authorization

### Clerk Integration

Authentication is handled by Clerk with Convex integration:

```typescript
// src/App.tsx
<ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}>
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {/* Application */}
    </ConvexProviderWithClerk>
</ClerkProvider>
```

### Role-Based Access Control

Three user roles with hierarchical permissions:

| Role | Permissions |
|------|-------------|
| `superadmin` | Full system access, global settings |
| `admin` | Church management, team management |
| `member` | Standard features, slide creation |

```typescript
// src/hooks/useUserRole.ts
export function useUserRole() {
    const { currentUser } = useChurch()
    
    return {
        isSuperadmin: currentUser?.role === 'superadmin',
        isAdmin: currentUser?.role === 'admin' || currentUser?.role === 'superadmin',
        canAccessAdmin: /* role check */,
        currentUser
    }
}
```

### Church Context

Users belong to a church organization:

```typescript
// src/components/layout/ChurchContext.tsx
// Provides church context to all child components
// Handles church selection and switching
```

---

## Multi-Monitor Support

### Presentation API Integration

The application uses the Presentation API for multi-screen support:

```typescript
// src/services/multi-monitor/index.ts
class MultiMonitorService {
    isPresentationApiAvailable(): boolean
    isScreenEnumerationAvailable(): boolean
    async detectScreens(): Promise<ScreenInfo[]>
    async startPresentation(screenId?: string): Promise<void>
    async stopPresentation(): Promise<void>
}
```

### Live Output Window

Separate window for projection:

```typescript
// src/pages/LiveView.tsx
// - Receives state via BroadcastChannel
// - Listens for localStorage events
// - Fullscreen support
// - Video/image background rendering
```

### Cross-Window Communication

State synchronization between windows:

```typescript
// BroadcastChannel for real-time updates
const channel = new BroadcastChannel('selah-live-channel')
channel.postMessage({ type: 'state-update', state: liveState })

// localStorage for persistence
localStorage.setItem('selah-live-state', JSON.stringify(state))
```

---

## AI/ML Features

### Sermon Listener

Real-time sermon transcription with verse detection:

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

### Transcription Providers

| Provider | Type | Setup Required |
|----------|------|----------------|
| Web Speech API | Browser-native | None |
| Faster-Whisper | Self-hosted | Docker server |
| Whisper.cpp | Self-hosted | Local server |
| Whisper API | Cloud | API key |
| ElevenLabs | Cloud | API key |

### Verse Detection

Two-tier verse detection system:

1. **Regex Detection**: Pattern matching for verse references
   - Standard: "John 3:16"
   - Abbreviated: "Jn 3:16"
   - Ranges: "Psalm 23:1-6"
   - Numbered books: "1 John 4:8"

2. **Semantic Detection**: ML-based paraphrase matching
   - Uses @xenova/transformers for embeddings
   - 384-dimensional vectors (all-MiniLM-L6-v2)
   - Cosine similarity matching

### Voice Activity Detection (VAD)

Silero VAD integration for speech segmentation:

```typescript
// src/services/sermon-listener/vadTranscriptionService.ts
// - Detects speech segments
// - Reduces silence in audio chunks
// - Improves transcription accuracy
```

---

## Deployment

### Fly.io Configuration

The application is deployed to Fly.io:

```toml
# fly.toml
app = "selah"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3000"

[[services]]
  internal_port = 3000
  protocol = "tcp"

[[services.ports]]
  handlers = ["http"]
  port = 80

[[services.ports]]
  handlers = ["tls", "http"]
  port = 443
```

### Whisper.cpp Sidecar

Separate deployment for transcription service:

```
deploy/whisper-cpp/
├── Dockerfile
└── fly.toml
```

### Docker Configuration

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build
COPY . .
RUN bun run build

# Serve
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=base /app/dist ./dist
EXPOSE 3000
CMD ["bun", "run", "preview"]
```

---

## Development Guidelines

### Project Structure Conventions

1. **Components**: One component per file, named exports
2. **Hooks**: Custom hooks in `src/hooks/`, export from index
3. **Services**: Service adapters in `src/services/`, provider pattern
4. **Types**: Centralized in `src/types/index.ts`
5. **Constants**: Application constants in `src/constants/`

### Naming Conventions

- **Components**: PascalCase (e.g., `SlideEditor.tsx`)
- **Hooks**: camelCase with `use` prefix (e.g., `useSlideCreation.ts`)
- **Services**: camelCase with descriptive suffix (e.g., `fasterWhisperTranscription.ts`)
- **Types**: PascalCase interfaces (e.g., `Slide`, `Schedule`)

### State Management Guidelines

1. **Global State**: Use Zustand for app-wide state
2. **Server State**: Use Convex queries/mutations
3. **Local State**: Use React useState for component-local state
4. **Derived State**: Compute from existing state, don't duplicate

### Testing

```bash
# Run tests
bun run test

# Watch mode
bun run test:watch
```

Tests are located alongside source files in `__tests__` directories.

### Environment Variables

Required environment variables:

```bash
# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=

# Convex Backend
VITE_CONVEX_URL=

# Analytics (optional)
VITE_AMPLITUDE_API_KEY=
VITE_POSTHOG_KEY=

# Transcription (optional)
VITE_FASTER_WHISPER_ENDPOINT=
VITE_WHISPER_CPP_ENDPOINT=
VITE_ELEVENLABS_API_KEY=

# Feature Flags (optional)
VITE_FF_SERMON_LISTENER=
```

---

## Appendix

### File Statistics

| Category | File Count | Total Size |
|----------|------------|------------|
| Components | ~50 | ~500KB |
| Hooks | 20 | ~100KB |
| Services | 15 | ~200KB |
| Convex Functions | 12 | ~100KB |
| Types | 4 | ~30KB |

### Key Dependencies Analysis

**Production Dependencies** (51 total):
- UI: React, Framer Motion, GSAP, Lucide icons
- State: Zustand, TanStack Query
- Backend: Convex, Clerk
- Editor: TipTap ecosystem
- ML: @xenova/transformers, onnxruntime-web
- Storage: Dexie, sql.js
- Utilities: clsx, fuzzysort, mitt

**Development Dependencies** (24 total):
- Build: Vite, TypeScript, ESLint
- Testing: Vitest, React Testing Library
- Styling: Tailwind CSS, PostCSS

---

*Documentation generated from codebase analysis. Last updated: February 2026*
