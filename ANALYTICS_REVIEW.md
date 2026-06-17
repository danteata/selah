# Analytics Integration Review — Selah

> **Date:** Current session  
> **Scope:** Full codebase audit of `src/services/analytics`, tracking usage, and gaps

---

## 1. Current State Summary

The analytics architecture is **well-designed and provider-agnostic**:

| Layer | File | Status |
|-------|------|--------|
| Provider interface | `src/services/analytics/types.ts` | ✅ Solid |
| Service singleton | `src/services/analytics/service.ts` | ✅ Good error handling |
| React context | `src/providers/AnalyticsProvider.tsx` | ✅ Proper init/flush |
| React hook | `src/hooks/useAnalytics.ts` | ✅ Clean API |
| PostHog provider | `src/services/analytics/providers/posthog.ts` | ✅ Feature-complete |
| Amplitude provider | `src/services/analytics/providers/amplitude.ts` | ✅ Lazy-loaded |
| Console provider | `src/services/analytics/providers/console.ts` | ✅ Dev-friendly |
| No-op provider | `src/services/analytics/providers/noop.ts` | ✅ Fallback safe |

**Supported providers:** PostHog, Amplitude, Console (dev), NoOp.  
**Privacy:** `sanitizeAuthError()` prevents PII leakage from error messages.  
**Configuration:** Driven by `VITE_ANALYTICS_PROVIDER` env var; defaults to `console` in dev.

---

## 2. Where Tracking IS Working (✅)

Only **~15% of defined events** are actually instrumented:

| Area | Events Tracked | Files |
|------|---------------|-------|
| **Auth funnel** | `AUTH_ATTEMPTED`, `USER_SIGNED_IN`, `USER_SIGNED_UP`, `AUTH_FAILED`, `AUTH_GOOGLE_CLICKED`, `EMAIL_VERIFICATION_SENT`, `SIGNUP_STEP_COMPLETED`, etc. | `Login.tsx`, `Signup.tsx` |
| **Landing page** | `LANDING_CTA_CLICKED` (5 locations), `PAGE_VIEWED` | `Landing.tsx` |
| **Onboarding** | `CHURCH_CREATED`, `CHURCH_JOINED`, `INVITATION_ACCEPTED` | `ChurchSetup.tsx`, `JoinChurch.tsx` |
| **Dashboard** | `MEDIA_SELECTED`, `SLIDE_TEMPLATE_USED`, `PAGE_VIEWED` | `Dashboard.tsx` |
| **Downloads** | `DOWNLOAD_INITIATED` | `Downloads.tsx` |
| **Settings** | `SETTINGS_OPENED`, `SETTINGS_TAB_CHANGED` | `SettingsModal.tsx` |
| **User ID** | `identify()` with church_id, role, is_superadmin | `Dashboard.tsx` |

---

## 3. Critical Gap: 50+ Defined Events Are NEVER Used

The `AnalyticsEventType` enum in `types.ts` defines **~70 events**. Only **~12** are actually called anywhere. The remaining **~58 events** are dead code.

### Defined-but-Unused Event Categories

| Category | Unused Events |
|----------|--------------|
| **App lifecycle** | `APP_INITIALIZED`, `APP_LOADED`, `SESSION_START` |
| **Slides / Live** | `SLIDE_CREATED`, `SLIDE_EDITED`, `SLIDE_DELETED`, `SLIDE_DISPLAYED`, `SLIDE_REORDERED`, `LIVE_SESSION_STARTED`, `LIVE_SESSION_ENDED`, `LIVE_COLLABORATION_JOINED`, `MULTI_MONITOR_OPENED` |
| **Bible** | `BIBLE_VERSION_SELECTED`, `BIBLE_SEARCH_PERFORMED`, `BIBLE_VERSE_SELECTED`, `BIBLE_EMBEDDING_SYNC_STARTED`, `BIBLE_EMBEDDING_SYNC_COMPLETED`, `BIBLE_SEMANTIC_SEARCH` |
| **Songs / Hymns** | `SONG_SELECTED`, `SONG_SEARCHED`, `HYMN_VIEWED` |
| **Media** | `MEDIA_UPLOADED`, `MEDIA_REMOVED`, `BACKGROUND_CHANGED` |
| **Schedules** | `SCHEDULE_CREATED`, `SCHEDULE_EDITED`, `SCHEDULE_VIEWED` |
| **Sermon Listener** | `SERMON_LISTENER_STARTED`, `SERMON_LISTENER_STOPPED`, `SERMON_LISTENER_TRANSCRIPTION`, `SERMON_LISTENER_VERSE_DETECTED`, `SERMON_LISTENER_ERROR` |
| **Countdown / Alerts** | `COUNTDOWN_STARTED`, `COUNTDOWN_COMPLETED`, `ALERT_TRIGGERED`, `LOWER_THIRD_DISPLAYED` |
| **Settings** | `SETTING_CHANGED`, `THEME_CHANGED`, `BIBLE_VERSION_CHANGED` |
| **Team** | `TEAM_INVITATION_SENT`, `TEAM_MEMBER_JOINED` |
| **Desktop** | `DESKTOP_UPDATE_CHECKED`, `DESKTOP_UPDATE_INSTALLED` |
| **Errors / Perf** | `ERROR_OCCURRED`, `PERFORMANCE_TIMING` |
| **Feature usage** | `QUICK_ACTION_USED`, `LIBRARY_ACCESSED`, `OFFLINE_MODE_ENTERED` |

---

## 4. Missing Tracking by Feature Area

### 🔴 Highest Impact — Core Product Functionality

#### A. Slide Operations (The #1 gap)
**Where it happens:** `useSlideCreation.ts`, `SlideEditor.tsx`, `Dashboard.tsx` (keyboard shortcuts), `LiveOutput.tsx`

**What's missing:**
- `SLIDE_CREATED` — never fired when users create bible/song/hymn/text/media/countdown/alert slides
- `SLIDE_EDITED` — never fired when users open the slide editor and save changes
- `SLIDE_DELETED` — never fired when users delete slides (keyboard `Delete` or UI)
- `SLIDE_DISPLAYED` — never fired when a slide goes live (`setSharedLiveSlide`)
- `SLIDE_REORDERED` — never fired when slides are reordered
- `BACKGROUND_CHANGED` — never fired when users change slide backgrounds

**Impact:** This is the core loop of the app. You have zero visibility into how users actually build and present slides.

---

#### B. Live Session & Collaboration
**Where it happens:** `useLiveSession.ts`, `LiveSessionControls.tsx`, `LiveOutput.tsx`

**What's missing:**
- `LIVE_SESSION_STARTED` / `LIVE_SESSION_ENDED` — session lifecycle
- `LIVE_COLLABORATION_JOINED` — when contributors/viewers join
- Collaboration mode changes (strict → open → moderated)
- Queue operations (suggest, approve, reject)
- Operator transfer events
- `MULTI_MONITOR_OPENED` — when live output window opens
- Screen/monitor selection events

---

#### C. Bible Search & Navigation
**Where it happens:** `BibleList.tsx`, `useScripture.ts`, `useSemanticVerseSearch.ts`, `useVoiceSearch.ts`

**What's missing:**
- `BIBLE_SEARCH_PERFORMED` — text search, voice search, semantic search
- `BIBLE_VERSE_SELECTED` — when a verse is added to slides
- `BIBLE_VERSION_SELECTED` / `BIBLE_VERSION_CHANGED` — version switches
- `BIBLE_SEMANTIC_SEARCH` — semantic/embedding-based searches
- Voice command usage ("next verse", "previous verse", "switch to NIV")
- Search result click-through rates

---

#### D. Sermon Listener
**Where it happens:** `useSermonListener.ts`, `SermonListenerPanel.tsx`, `useTranscripts.ts`

**What's missing:**
- `SERMON_LISTENER_STARTED` / `SERMON_LISTENER_STOPPED` — transcription lifecycle
- `SERMON_LISTENER_TRANSCRIPTION` — transcription provider used, duration, accuracy signals
- `SERMON_LISTENER_VERSE_DETECTED` — detection method (regex vs semantic), confidence
- `SERMON_LISTENER_ERROR` — mic permission denied, model load failure, network errors
- Provider switches (web-speech ↔ desktop-whisper)
- Transcript save/export/operations
- Sermon notes generation
- Capture source (microphone vs system audio)

---

#### E. Schedules
**Where it happens:** `useSchedules.ts`, `ScheduleModal.tsx`

**What's missing:**
- `SCHEDULE_CREATED`, `SCHEDULE_EDITED`, `SCHEDULE_VIEWED`
- Active schedule switches
- Schedule sharing/invitation flows

---

#### F. Media & Backgrounds
**Where it happens:** `MediaPicker.tsx`, `BackgroundPicker.tsx`, `useLocalBackground.ts`

**What's missing:**
- `MEDIA_UPLOADED` — upload success/failure
- `MEDIA_REMOVED` — media deletion
- `BACKGROUND_CHANGED` — gradient, image, video background changes
- Video background usage

---

#### G. Songs & Hymns
**Where it happens:** `useSong.ts`, `useHymn.ts`, song search UI

**What's missing:**
- `SONG_SELECTED`, `SONG_SEARCHED`, `HYMN_VIEWED`
- Song source (local vs remote)

---

#### H. Templates
**Where it happens:** `useTemplates.ts`, `TemplateBrowser.tsx`, `CreateTemplateModal.tsx`

**What's missing:**
- Template creation, update, deletion
- Template favoriting
- Default template seeding events
- Category filtering

**Note:** `SLIDE_TEMPLATE_USED` is tracked in `Dashboard.tsx` — this is the only template event wired up.

---

#### I. Library
**Where it happens:** `useLibrary.ts`, `LibraryPanel.tsx`

**What's missing:**
- `LIBRARY_ACCESSED`
- Add to library, remove from library, use from library
- Library category usage

---

#### J. Quick Actions & Keyboard Shortcuts
**Where it happens:** `useQuickActionHandlers.ts`, `useKeyboardShortcuts.ts`, `CommandBar.tsx`

**What's missing:**
- `QUICK_ACTION_USED` — every quick action event (`newSlide`, `openSettings`, `toggleDarkMode`, etc.)
- Keyboard shortcut usage (which shortcuts are actually used)
- Command bar invocation and selection

---

#### K. Countdowns, Alerts, Lower Thirds
**Where it happens:** `AddCountdownModal.tsx`, `AddAlertModal.tsx`, `LowerThirdEditor.tsx`

**What's missing:**
- `COUNTDOWN_STARTED`, `COUNTDOWN_COMPLETED`
- `ALERT_TRIGGERED`
- `LOWER_THIRD_DISPLAYED`

---

#### L. Settings Changes
**Where it happens:** `SettingsModal.tsx`, `BibleVersionSettings.tsx`, various setting toggles

**What's missing:**
- `SETTING_CHANGED` — individual setting changes (font, transition interval, collaboration mode, dark mode, etc.)
- `THEME_CHANGED` — dark/light toggle
- `BIBLE_VERSION_CHANGED` — default version change
- Embedding sync start/complete/failure (`BIBLE_EMBEDDING_SYNC_STARTED`, `BIBLE_EMBEDDING_SYNC_COMPLETED`)

---

### 🟡 Medium Impact — Platform & Quality

#### M. Error Tracking
**Where it happens:** `RouteErrorBoundary.tsx`, `ConvexErrorBoundary.tsx`, unhandled errors across the app

**What's missing:**
- `ERROR_OCCURRED` — **never fired anywhere**
- Error boundaries only `console.error()` — errors in production are invisible to analytics
- No tracking of: transcription errors, network failures, Convex plan limit errors, mic permission denials

---

#### N. Performance Timing
**Where it happens:** App boot, slide rendering, search latency, model loading

**What's missing:**
- `PERFORMANCE_TIMING` — **never fired anywhere**
- App initialization time
- Bible search latency
- Semantic search latency
- Embedding sync duration
- Whisper model download/load time
- Slide-to-live latency

---

#### O. Desktop-Specific Features
**Where it happens:** `App.tsx` (update check), Tauri APIs, `useNativeMultiMonitor.ts`

**What's missing:**
- `DESKTOP_UPDATE_CHECKED`, `DESKTOP_UPDATE_INSTALLED`
- App version at startup
- Tauri vs web usage split
- Native window management events
- NDI output start/stop (`useNdiOutput.ts`)

---

#### P. Offline / Connectivity
**Where it happens:** `useOnlineStatus.ts`, `useLocalFirst.ts`, `ConvexConnectionProvider.tsx`

**What's missing:**
- `OFFLINE_MODE_ENTERED` — when users go offline
- Online/offline transitions
- Offline duration
- Fallback usage (IndexedDB vs Convex)

---

#### Q. App Lifecycle
**Where it happens:** `App.tsx`, `AnalyticsProvider.tsx`

**What's missing:**
- `APP_INITIALIZED` — app bootstrap complete
- `APP_LOADED` — first render complete
- `SESSION_START` — user session begin (with session duration potential)
- Time-to-interactive

---

## 5. Specific Improvement Recommendations

### Priority 1 — Core Product Loop (Do First)

1. **Instrument `useSlideCreation.ts`**
   - Fire `SLIDE_CREATED` with properties: `slide_type`, `source` (quick-action, bible-list, template, sermon-listener), `schedule_id`
   - This single hook covers ~80% of slide creation paths.

2. **Instrument `useLiveSession.ts`**
   - Fire `LIVE_SESSION_STARTED` / `LIVE_SESSION_ENDED` with `schedule_id`, `collaboration_mode`, `participant_count`
   - Fire `LIVE_COLLABORATION_JOINED` with `role` (contributor/viewer)

3. **Instrument `useNativeMultiMonitor.ts` / `useMultiMonitor.ts`**
   - Fire `MULTI_MONITOR_OPENED` with `is_desktop`, `screen_count`, `method` (tauri-window / presentation-api)

4. **Instrument `BibleList.tsx`**
   - Fire `BIBLE_SEARCH_PERFORMED` with `method` (text, voice, semantic), `query_length`, `has_results`
   - Fire `BIBLE_VERSE_SELECTED` with `version`, `book`, `chapter`

5. **Instrument `useSermonListener.ts`**
   - Fire `SERMON_LISTENER_STARTED` with `provider`, `language`, `capture_source`
   - Fire `SERMON_LISTENER_STOPPED` with `duration_seconds`, `verse_count`, `transcript_length`
   - Fire `SERMON_LISTENER_VERSE_DETECTED` with `method` (regex/semantic), `confidence`
   - Fire `SERMON_LISTENER_ERROR` with `error_category` (use existing `classifyTranscriptionError`)

---

### Priority 2 — Feature Adoption & Engagement

6. **Instrument `useSchedules.ts`**
   - Fire `SCHEDULE_CREATED`, `SCHEDULE_EDITED`, active schedule switches

7. **Instrument `useLibrary.ts`**
   - Fire `LIBRARY_ACCESSED`, add/remove/use events

8. **Instrument `useTemplates.ts`**
   - Fire template CRUD events, favorite toggles

9. **Instrument `useQuickActionHandlers.ts`**
   - Fire `QUICK_ACTION_USED` with `action_name` for every quick action

10. **Instrument Settings changes**
    - Fire `SETTING_CHANGED` with `setting_key`, `old_value`, `new_value` (sanitized)
    - Fire `THEME_CHANGED`, `BIBLE_VERSION_CHANGED`

---

### Priority 3 — Quality & Reliability

11. **Add error tracking to error boundaries**
    ```tsx
    // In RouteErrorBoundary.componentDidCatch
    analytics.trackEvent(AnalyticsEventType.ERROR_OCCURRED, {
      error_category: 'react_render_error',
      route_name: this.props.name,
      error_message: sanitizeError(error.message),
    })
    ```

12. **Add performance timing**
    - Track app init time: `APP_INITIALIZED` with `init_duration_ms`
    - Track bible search latency: `BIBLE_SEARCH_PERFORMED` with `latency_ms`
    - Track semantic search latency: `BIBLE_SEMANTIC_SEARCH` with `latency_ms`, `fallback_used`
    - Track embedding sync duration: `BIBLE_EMBEDDING_SYNC_COMPLETED` with `duration_ms`, `verse_count`, `with_fragments`

13. **Add offline tracking**
    - Fire `OFFLINE_MODE_ENTERED` when `navigator.onLine` goes false
    - Include `offline_duration_ms` when coming back online

14. **Add desktop update tracking**
    - Fire `DESKTOP_UPDATE_CHECKED` / `DESKTOP_UPDATE_INSTALLED` in `App.tsx`

---

### Priority 4 — Data Quality & Privacy

15. **Ensure no sensitive content leaks to analytics**
    - **Never** track: slide text content, sermon transcripts, bible verse text, user emails
    - **Safe to track:** slide type counts, feature usage flags, error categories, performance timings
    - Add a `sanitizeEventProperties()` helper that strips `content`, `transcript`, `text` fields

16. **Set richer user properties**
    ```ts
    analytics.setUserProperties({
      church_id: currentUser.churchId,
      role: currentUser.role,
      is_desktop: isDesktop(),
      preferred_bible_version: settings.defaultBibleVersion,
      has_used_sermon_listener: boolean,
      has_used_semantic_search: boolean,
      has_used_multi_monitor: boolean,
      slide_count_7d: number,
      session_count_7d: number,
    })
    ```

17. **Add Amplitude super-properties**
    - The Amplitude provider doesn't set `app_version` or `is_desktop` as super-properties (PostHog does via `posthog.register()`). Add these to Amplitude's `Identify` object on init.

---

## 6. Suggested Implementation Pattern

For hooks that are used across many components, add tracking **inside the hook** rather than in every UI component:

```ts
// useSlideCreation.ts
export function useSlideCreation() {
  const { trackEvent } = useAnalytics() // add this

  const createBibleSlide = useCallback((scripture: Scripture, version: string) => {
    const slide = buildSlide(scripture, version)
    trackEvent(AnalyticsEventType.SLIDE_CREATED, {
      slide_type: 'bible',
      source: 'quick_action',
      version,
      book: scripture.book,
    })
    return slide
  }, [trackEvent])
}
```

For error boundaries, inject analytics via a static import (safe because the singleton exists before React mounts):

```ts
// RouteErrorBoundary.tsx
import { analytics, AnalyticsEventType } from '../services/analytics'

componentDidCatch(error: Error, info: ErrorInfo) {
  analytics.trackEvent(AnalyticsEventType.ERROR_OCCURRED, {
    error_category: 'react_render_error',
    route_name: this.props.name,
    error_message: sanitizeError(error.message),
  })
}
```

---

## 7. Quick Wins (Can Be Done in One Session)

| # | Change | File(s) | Effort |
|---|--------|---------|--------|
| 1 | Add `SLIDE_CREATED` to `useSlideCreation.ts` | 1 file | 10 min |
| 2 | Add `LIVE_SESSION_STARTED/ENDED` to `useLiveSession.ts` | 1 file | 10 min |
| 3 | Add `SERMON_LISTENER_STARTED/STOPPED` to `useSermonListener.ts` | 1 file | 10 min |
| 4 | Add `ERROR_OCCURRED` to `RouteErrorBoundary.tsx` | 1 file | 5 min |
| 5 | Add `BIBLE_SEARCH_PERFORMED` to `BibleList.tsx` | 1 file | 10 min |
| 6 | Add `MULTI_MONITOR_OPENED` to `useNativeMultiMonitor.ts` | 1 file | 10 min |
| 7 | Add `SETTING_CHANGED` to settings toggles | 2-3 files | 20 min |
| 8 | Add `APP_INITIALIZED` with timing to `App.tsx` | 1 file | 10 min |
| 9 | Add `OFFLINE_MODE_ENTERED` to `useOnlineStatus.ts` | 1 file | 5 min |
| 10 | Add Amplitude super-properties | 1 file | 10 min |

**Total: ~1.5 hours for 10 high-impact events.**

---

## 8. Events to Consider Deprecating

If you don't plan to track these, remove them from the enum to reduce dead code:

- `LIBRARY_ACCESSED` → unless you build a library usage dashboard
- `LANDING_SECTION_VIEWED` → requires intersection observer instrumentation
- `PERFORMANCE_TIMING` → replace with Web Vitals / custom timing properties on other events

Or keep them as a "tracking backlog" — just be aware they create maintenance noise.

---

## Appendix: Full Event Inventory

| Event | Defined | Used | Priority |
|-------|---------|------|----------|
| `APP_INITIALIZED` | ✅ | ❌ | P3 |
| `APP_LOADED` | ✅ | ❌ | P3 |
| `SESSION_START` | ✅ | ❌ | P3 |
| `USER_SIGNED_IN` | ✅ | ✅ | — |
| `USER_SIGNED_UP` | ✅ | ✅ | — |
| `USER_SIGNED_OUT` | ✅ | ❌ | P2 |
| `AUTH_ATTEMPTED` | ✅ | ✅ | — |
| `AUTH_FAILED` | ✅ | ✅ | — |
| `AUTH_GOOGLE_CLICKED` | ✅ | ✅ | — |
| `SIGNUP_STEP_COMPLETED` | ✅ | ✅ | — |
| `EMAIL_VERIFICATION_SENT` | ✅ | ✅ | — |
| `EMAIL_VERIFICATION_ATTEMPTED` | ✅ | ✅ | — |
| `PAGE_VIEWED` | ✅ | ✅ | — |
| `LANDING_CTA_CLICKED` | ✅ | ✅ | — |
| `LANDING_SECTION_VIEWED` | ✅ | ❌ | Low |
| `SLIDE_CREATED` | ✅ | ❌ | **P1** |
| `SLIDE_EDITED` | ✅ | ❌ | **P1** |
| `SLIDE_DELETED` | ✅ | ❌ | **P1** |
| `SLIDE_DISPLAYED` | ✅ | ❌ | **P1** |
| `SLIDE_REORDERED` | ✅ | ❌ | P2 |
| `SLIDE_TEMPLATE_USED` | ✅ | ✅ | — |
| `LIVE_SESSION_STARTED` | ✅ | ❌ | **P1** |
| `LIVE_SESSION_ENDED` | ✅ | ❌ | **P1** |
| `LIVE_COLLABORATION_JOINED` | ✅ | ❌ | **P1** |
| `MULTI_MONITOR_OPENED` | ✅ | ❌ | **P1** |
| `BIBLE_VERSION_SELECTED` | ✅ | ❌ | P2 |
| `BIBLE_SEARCH_PERFORMED` | ✅ | ❌ | **P1** |
| `BIBLE_VERSE_SELECTED` | ✅ | ❌ | **P1** |
| `BIBLE_EMBEDDING_SYNC_STARTED` | ✅ | ❌ | P2 |
| `BIBLE_EMBEDDING_SYNC_COMPLETED` | ✅ | ❌ | P2 |
| `BIBLE_SEMANTIC_SEARCH` | ✅ | ❌ | P2 |
| `SONG_SELECTED` | ✅ | ❌ | P2 |
| `SONG_SEARCHED` | ✅ | ❌ | P2 |
| `HYMN_VIEWED` | ✅ | ❌ | P2 |
| `MEDIA_UPLOADED` | ✅ | ❌ | P2 |
| `MEDIA_SELECTED` | ✅ | ✅ | — |
| `MEDIA_REMOVED` | ✅ | ❌ | P2 |
| `BACKGROUND_CHANGED` | ✅ | ❌ | P2 |
| `SCHEDULE_CREATED` | ✅ | ❌ | P2 |
| `SCHEDULE_EDITED` | ✅ | ❌ | P2 |
| `SCHEDULE_VIEWED` | ✅ | ❌ | P2 |
| `SERMON_LISTENER_STARTED` | ✅ | ❌ | **P1** |
| `SERMON_LISTENER_STOPPED` | ✅ | ❌ | **P1** |
| `SERMON_LISTENER_TRANSCRIPTION` | ✅ | ❌ | P2 |
| `SERMON_LISTENER_VERSE_DETECTED` | ✅ | ❌ | **P1** |
| `SERMON_LISTENER_ERROR` | ✅ | ❌ | **P1** |
| `COUNTDOWN_STARTED` | ✅ | ❌ | P2 |
| `COUNTDOWN_COMPLETED` | ✅ | ❌ | P2 |
| `ALERT_TRIGGERED` | ✅ | ❌ | P2 |
| `LOWER_THIRD_DISPLAYED` | ✅ | ❌ | P2 |
| `SETTING_CHANGED` | ✅ | ❌ | P2 |
| `SETTINGS_OPENED` | ✅ | ✅ | — |
| `SETTINGS_TAB_CHANGED` | ✅ | ✅ | — |
| `THEME_CHANGED` | ✅ | ❌ | P2 |
| `BIBLE_VERSION_CHANGED` | ✅ | ❌ | P2 |
| `TEAM_INVITATION_SENT` | ✅ | ❌ | P2 |
| `TEAM_MEMBER_JOINED` | ✅ | ❌ | P2 |
| `CHURCH_CREATED` | ✅ | ✅ | — |
| `CHURCH_JOINED` | ✅ | ✅ | — |
| `INVITATION_ACCEPTED` | ✅ | ✅ | — |
| `DOWNLOAD_INITIATED` | ✅ | ✅ | — |
| `DOWNLOAD_COMPLETED` | ✅ | ❌ | P2 |
| `DESKTOP_UPDATE_CHECKED` | ✅ | ❌ | P3 |
| `DESKTOP_UPDATE_INSTALLED` | ✅ | ❌ | P3 |
| `ERROR_OCCURRED` | ✅ | ❌ | **P1** |
| `PERFORMANCE_TIMING` | ✅ | ❌ | P3 |
| `QUICK_ACTION_USED` | ✅ | ❌ | P2 |
| `LIBRARY_ACCESSED` | ✅ | ❌ | P2 |
| `OFFLINE_MODE_ENTERED` | ✅ | ❌ | P3 |
