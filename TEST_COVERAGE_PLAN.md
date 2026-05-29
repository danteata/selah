# Selah Test Coverage Plan

> Generated audit of current tests, critical gaps, and a phased roadmap to robust coverage.

---

## 1. Current State Audit

### Existing Tests (15 files)

| File | Area | Quality | Notes |
|------|------|---------|-------|
| `src/store/__tests__/appStore.test.ts` | Store | Good | Covers slides, schedules, settings, shared queue, session hydration, signOut. **Missing:** undo/redo assertions, modal state, overlay toggles, bulk select, live output slides. |
| `src/store/__tests__/sermonLayout.test.ts` | Store | Unknown | — |
| `src/store/__tests__/sharedQueue.test.ts` | Store | Good | Queue sync backward compat, operator-only sync, collaboration modes. |
| `src/lib/__tests__/semanticRetrievalPolicy.test.ts` | Business logic | **Excellent** | Well-structured, good edge cases (synonyms, stop words, theological-common filtering, archaic stems). |
| `src/utils/__tests__/bibleReference.test.ts` | Utilities | Good | — |
| `src/services/sermon-listener/__tests__/verseDetection.test.ts` | Service | Medium | Regex-based verse detection. |
| `src/services/sermon-listener/__tests__/referenceContext.test.ts` | Service | Medium | — |
| `src/services/migration/__tests__/easyWorshipParser.test.ts` | Service | Medium | Parser only. |
| `src/hooks/__tests__/liveSessionSync.test.ts` | Hook | Medium | Sync logic. |
| `src/hooks/__tests__/liveSessionUtils.test.ts` | Hook | Medium | Utilities. |
| `src/hooks/__tests__/useNativeMultiMonitor.test.ts` | Hook | **Shallow** | Tests data transformations & constants, **not actual hook behavior** (no `renderHook`). |
| `src/hooks/__tests__/useSlideCreation.test.ts` | Hook | Good | — |
| `src/components/slides/__tests__/SlideChip.test.tsx` | Component | Low | Only 1 component tested. |
| `src/components/quick-actions/__tests__/bibleReferenceDetection.test.ts` | Component logic | Medium | — |
| `src/services/__tests__/nativeMultiMonitor.test.ts` | Service | Low | Dead code? Only constants. |

### Test Stack
- **Runner:** Vitest (`vitest.config.ts`) with `happy-dom`
- **React Testing:** `@testing-library/react`, `@testing-library/user-event`
- **Assertions:** `@testing-library/jest-dom`
- **Setup:** `src/test-setup.ts` mocks `matchMedia`, `IntersectionObserver`, `ResizeObserver`

### What's Completely Missing
- **Zero Convex backend tests** (users, slides, schedules, presence, verseEmbeddings, liveSessions, auth, etc.)
- **Zero component tests** for `TopBar`, `NavRail`, `AppShell`, `ContextPanel`, `DashboardLayout`, `SermonListenerPanel`, `SlideEditor`, `SettingsModal`
- **Zero hook tests** for `useUserRole`, `useSermonListener`, `useKeyboardShortcuts`, `useSchedules`, `useScripture`, `useTemplates`, `useLiveSession`, `useAudioDevices`, `useEmbeddingStatus`, `useQuickActionHandlers`
- **Zero service tests** for `voiceCommandDetection`, `hallucinationFilter`, `semanticVerseDetection`, `localEmbeddings`, `embeddingSyncManager`, `whisperReadiness`, `desktopWhisperTranscription`, `unifiedTranscription`
- **Zero E2E / integration tests** (no Playwright, Cypress, or similar)

---

## 2. Prioritized Plan

### Phase 1: Foundation & High-Risk Business Logic (Week 1)

**Goal:** Cover the code paths that are most likely to silently break and hardest to manually verify.

#### 1.1 Expand `appStore` tests
- **Undo/redo assertions** — currently the tests call `undo()`/`redo()` but only assert comments, not actual state.
- **Modal open/close state** (`openModal`, `closeModal`, `toggleModal`)
- **Overlay toggles** (`setActiveOverlay`, black/white/none cycle)
- **Bulk select** (`toggleSlideSelection`, `clearSelectedSlides`, `selectAllSlides`)
- **Live output slides** (`setLiveOutputSlidesId`, reordering)
- **Panel mode / docking** (`setPanelMode`, `setPanelPosition`)

#### 1.2 `useUserRole` hook
- Mock `useAuth` from Clerk, `useQuery` from Convex, `useConvexConnection`
- Test cached session loading (valid, expired, corrupted)
- Test offline mode fallback (`isOffline && currentUser === undefined && cachedSession !== null`)
- Test role derivation (`superadmin` → `canAccessAdmin = true`, `member` → `false`)
- Test `hasRequiredRole` hierarchy helper

#### 1.3 `useKeyboardShortcuts` hook
- `useKeyboardShortcut` — fire synthetic `keydown` events, assert callback invoked / not invoked when input focused
- `useKeyboardShortcuts` — multiple shortcuts, `ctrlOrMeta`, `shift`, `alt`, `preventDefault`
- `useSlideNavigationShortcuts` — verify correct key maps
- `useNumberShortcuts` — Ctrl+1..9

#### 1.4 `voiceCommandDetection.ts` service
- `detectVoiceCommands` — test each command type: `next`, `previous`, `live`, `black`, `white`, `clear`, `lookup`, `display`, `chapter next`, `chapter previous`, `stop`, `start`
- Test false positives (regular sermon text containing command words)
- `stripCommandsFromTranscript` — verify command text is removed from final transcript

#### 1.5 `hallucinationFilter.ts` service
- `filterHallucinations` — known hallucination patterns ("subscribe", "like this video", "click the link", "next chapter")
- `correctAccentMishearings` — test replacement pairs ("dear" → "deer", "peace" → "piece", etc.)

#### 1.6 `verseDetection.ts` service (expand existing)
- Test `BOOK_PATTERN` against all 66 books (abbreviations, numbers, case variations)
- Test `resolveBareReferences` — context-aware book inference when no book is spoken
- Test `updateContextFromVerse` — active reference context update

---

### Phase 2: Core Presentation & Navigation Layer (Week 2)

**Goal:** Prevent UI regressions like the admin nav bug we just fixed.

#### 2.1 `TopBar` component
- Render with `canAccessAdmin = true` → Shield icon visible
- Render with `canAccessAdmin = false` → Shield icon absent
- Admin toggle click → `onToggleAdminPanel` called
- User menu opens/closes
- Schedule selector dropdown
- Workspace mode toggle
- Theme toggle

#### 2.2 `NavRail` component
- Click each nav section → `setActiveNavSection` called with correct section
- Click active section again → `setActiveNavSection(null)` (deselect)
- Sermon recording indicator (red dot when `isListening`)
- Quick Add button fires `setCommandBarOpen`

#### 2.3 `AppShell` component
- `activeNavSection = 'library'` → modal opens, section resets to `null`
- `activeNavSection = 'settings'` → same
- Keyboard shortcut `Ctrl+B` → `toggleQuickBibleBar` called
- Inline vs floating `ContextPanel` based on `panelMode`

#### 2.4 `ContextPanel` component
- Renders correct content for each `activeNavSection` (`bible`, `music`, `media`, etc.)
- Close button works
- Resize / width persistence

#### 2.5 `DashboardLayout` component
- Panel collapse/expand restores original height
- Panel close removes from layout
- Panel toggle bar shows/hides panels
- Layout persistence to `localStorage`
- Reset layout restores defaults

---

### Phase 3: Sermon Listener & Semantic Search (Week 3)

**Goal:** The sermon listener is a flagship feature with complex async state. It needs rigorous coverage.

#### 3.1 `useSermonListener` hook
- Mock `unifiedTranscriptionService`, `desktopWhisperTranscriptionService`, `subscribeWhisperReadiness`
- Test state machine: `idle` → `listening` → `paused` → `stopped`
- Test transcript accumulation and deduplication
- Test auto-lookup flow: verse detected → `useScripture` called → slide created
- Test auto-display flow: verse displayed on live output
- Test voice command handling: `next` increments live slide, `previous` decrements
- Test localStorage persistence (debounced writes)
- Test error handling: transcription error → error state set
- Test provider switching (Web Speech API ↔ Whisper)
- Test `enableSemanticDetection` on/off

#### 3.2 `semanticVerseDetection.ts` service
- Mock `localEmbeddings` (return deterministic fake embeddings)
- Mock `verseEmbeddingStore` (return fake indexed verses)
- Mock Convex `api.verseEmbeddings.vectorSearch`
- Test sliding window generation
- Test sentence deduplication
- Test threshold-based filtering (`getDynamicThreshold`)
- Test merge of regex + semantic results
- Test excluded ranges (don't re-search already-detected verses)

#### 3.3 `localEmbeddings.ts` service
- Mock `embedding.worker.ts` via `vi.mock`
- Test `embedText` / `embedBatch` message passing
- Test `isEmbedderReady` state
- Test IndexedDB caching (`getCachedVerseEmbeddings`, `cacheVerseEmbeddings`)
- Test desktop model path resolution vs. web CDN fallback

#### 3.4 `embeddingSyncManager.ts` service
- Mock `localEmbeddings`, IndexedDB, worker
- Test `startSync` with `withFragments = false` (fast mode)
- Test `startSync` with `withFragments = true` (full mode)
- Test auto-upgrade flow: fast completes → auto-upgrade triggers after 500ms
- Test progress reporting (batches, flush every 250 verses)
- Test cancellation / early exit
- Test resume behavior (if implemented)

#### 3.5 `whisperReadiness.ts` service
- Mock Tauri event listener (`listen`)
- Test `whisper-server://ready` event → subscribers notified with `{ endpoint, model }`
- Test `whisper-server://error` event → subscribers notified with error
- Test one-time subscription (no duplicate listeners)

---

### Phase 4: Convex Backend (Week 4)

**Goal:** Backend is the source of truth. Zero tests here is a major risk.

#### 4.1 Setup Convex testing
- Install `convex-test` (or use `convex` CLI test runner)
- Create `convex/__tests__/setup.ts` with test database fixtures

#### 4.2 Auth & Users (`auth.ts`, `users.ts`)
- `getCurrentUser` — returns user by clerkId
- `updateUserRole` — superadmin can promote/demote
- `createUser` — Clerk webhook sync
- `hasRequiredRole` Convex-side equivalent

#### 4.3 Schedules (`schedules.ts`)
- `createSchedule` — creates schedule, adds to user's church
- `updateSchedule` — editor/authors can edit
- `deleteSchedule` — author or superadmin
- `getSchedulesByChurch` — returns only church schedules

#### 4.4 Slides (`slides.ts`)
- `createSlide` — creates with correct churchId
- `updateSlide` — updates contents, background, style
- `deleteSlide` — soft delete
- `getSlidesBySchedule` — returns ordered slides
- `reorderSlides` — index updates

#### 4.5 Live Sessions (`liveSessions.ts`)
- `createSession` — generates unique sessionId
- `joinSession` — adds user, broadcasts state
- `updateOperatorSlideIds` — operator-only sync
- `leaveSession` — removes user, cleanup

#### 4.6 Presence (`presence.ts`)
- `heartbeat` — updates timestamp
- `getPresenceByChurch` — returns online users
- Expired presence cleanup

#### 4.7 Verse Embeddings (`verseEmbeddings.ts`)
- `vectorSearch` — returns matches within threshold
- `insertVerseEmbeddings` — batch insert
- `getEmbeddingStatus` — returns progress

---

### Phase 5: Component Smoke Tests & Integration (Week 5)

**Goal:** Broad coverage of remaining components and a few critical user flows.

#### 5.1 Component smoke tests (render + basic interaction)
- `SermonListenerPanel` — start/stop buttons, transcript display, detected verses list
- `SettingsModal` — tab switching, form inputs, save/cancel
- `SlideEditor` — text input, background picker, layout selector
- `QuickActionsSidebar` — category tabs, search input, item selection
- `BibleVersionSettings` / `LocalEmbeddingSync` — checkbox toggles, progress display
- `PreviewContent` / `LiveOutput` — slide rendering, overlay display

#### 5.2 Integration tests (critical user journeys)
- **Flow A: Create schedule → Add Bible slide → Go live**
  1. Open schedule modal → create schedule
  2. Open Bible context panel → search John 3:16
  3. Add to active slides
  4. Set live slide
  5. Verify live output shows John 3:16

- **Flow B: Admin enables sermon listener → Preaches → Verse auto-detected**
  1. Toggle admin panel (if admin)
  2. Enable sermon settings
  3. Start sermon listener
  4. Feed transcript with known verse
  5. Verify verse detected and displayed

- **Flow C: Multi-monitor live output**
  1. Open screen picker
  2. Select external monitor
  3. Open live window
  4. Change live slide
  5. Verify live window receives updated slide

---

### Phase 6: Tooling & CI (Ongoing)

#### 6.1 Coverage reporting
- Current Vitest config already has `v8` coverage.
- Run `npm run test -- --coverage` and track trends.
- Set a coverage gate (e.g., 60% → 70% → 80%) in CI.

#### 6.2 CI integration
- Add GitHub Actions workflow:
  ```yaml
  - name: Run tests
    run: npm run test
  - name: Upload coverage
    uses: codecov/codecov-action@v4
  ```

#### 6.3 Test utilities
- Create `src/test-utils.tsx` with helpers:
  - `renderWithStore(ui)` — wraps in a fresh Zustand store provider
  - `renderWithRouter(ui, route)` — wraps in `MemoryRouter`
  - `mockClerkUser(role)` — mocks `useAuth` + `useUser` hooks
  - `mockConvexQuery(result)` — mocks `useQuery` return value
  - `mockTauriApi()` — mocks `@tauri-apps/api` invoke/listen

---

## 3. Quick Wins (Start Here)

These are the highest-impact, lowest-effort tests to add immediately:

1. **`src/hooks/__tests__/useUserRole.test.ts`** — High business risk, simple to mock.
2. **`src/hooks/__tests__/useKeyboardShortcuts.test.ts`** — Simple synthetic events.
3. **`src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts`** — Pure functions, zero mocks needed.
4. **`src/services/sermon-listener/__tests__/hallucinationFilter.test.ts`** — Pure functions, zero mocks needed.
5. **`src/components/layout/__tests__/TopBar.test.tsx`** — Verify admin toggle visibility (regression guard for the bug we just fixed).
6. **`src/store/__tests__/appStore.test.ts` — fill in undo/redo assertions** — Existing test skeleton, just add real assertions.

---

## 4. Estimated Effort

| Phase | Scope | Est. Effort |
|-------|-------|-------------|
| Phase 1 | Foundation + business logic | 3–4 days |
| Phase 2 | UI shell components | 2–3 days |
| Phase 3 | Sermon listener & embeddings | 4–5 days |
| Phase 4 | Convex backend | 3–4 days |
| Phase 5 | Component smoke + integration | 3–4 days |
| Phase 6 | Tooling & CI | 1 day |
| **Total** | | **~2.5–3 weeks** |

---

## 5. Appendix: Mock Patterns to Reuse

### Mock Clerk
```ts
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ userId: 'user_123', isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { firstName: 'Test', emailAddresses: [{ emailAddress: 'test@example.com' }] } }),
}))
```

### Mock Convex
```ts
vi.mock('../../../convex/_generated/api', () => ({
  api: {},
}))

vi.mock('convex/react', () => ({
  useQuery: vi.fn((query, args) => {
    if (args === 'skip') return undefined
    return mockData
  }),
}))
```

### Mock Tauri
```ts
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event, handler) => {
    // simulate event
    return Promise.resolve(() => {})
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
```

### Mock Zustand Store
```ts
import { useAppStore } from '../store/appStore'

beforeEach(() => {
  useAppStore.getState().signOut() // resets to initial state
})
```
