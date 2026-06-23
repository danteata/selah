# Analytics Events Wiring Status

Generated 2026-06-14. Tracks the wiring of every value in
`AnalyticsEventType` (src/services/analytics/types.ts) into the
component handlers that produce them.

## Status legend
- ✅ **Wired** — `trackEvent(...)` call exists at the right place, with meaningful properties
- 🔧 **Partial** — event is fired in some paths but missing in others
- ⏳ **Todo** — enum value defined but no `trackEvent` call anywhere
- ❌ **N/A** — intentionally skipped (see notes)

---

## ✅ Completed in this session

| Event | File | Trigger |
|---|---|---|
| `app_initialized` | `src/App.tsx` | `AppRoutes` mount |
| `app_loaded` | `src/App.tsx` | `AppRoutes` mount (with `load_ms`) |
| `session_start` | `src/App.tsx` | First `AppRoutes` mount |
| `page_viewed` | `src/App.tsx` | Every `location.pathname` change (via `analytics.page()`) |
| `error_occurred` | `src/components/offline/RouteErrorBoundary.tsx` | (was already wired) |
| `auth_attempted` | `src/pages/auth/Login.tsx`, `Signup.tsx` | (was already wired) |
| `auth_failed` | `src/pages/auth/Login.tsx`, `Signup.tsx` | (was already wired) |
| `user_signed_in` | `src/pages/auth/Login.tsx` | (was already wired) |
| `user_signed_up` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `user_signed_out` | `src/pages/Dashboard.tsx` | `onSignOut` from `DashboardHeader` |
| `auth_google_clicked` | `src/pages/auth/Login.tsx`, `Signup.tsx` | (was already wired) |
| `signup_step_completed` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `email_verification_sent` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `email_verification_attempted` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `church_created` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `church_joined` | `src/pages/auth/Signup.tsx` | (was already wired) |
| `slide_created` | `src/hooks/useSlideCreation.ts` | (was already wired — every createXxxSlide) |
| `slide_edited` | `src/hooks/useQuickActionHandlers.ts` | `handleSlideEditorSave` (was already wired) |
| `slide_deleted` | `src/components/live/LiveOutput.tsx` | `handleDeleteSlide` (was already wired) |
| `slide_displayed` | `src/components/live/LiveOutput.tsx` | `handleSetLiveSlide` (was already wired) |
| `live_session_started` | `src/hooks/useLiveSession.ts` | (was already wired) |
| `live_session_ended` | `src/hooks/useLiveSession.ts` | (was already wired) |
| `live_collaboration_joined` | `src/hooks/useLiveSession.ts` | (was already wired) |
| `multi_monitor_opened` | `src/hooks/useNativeMultiMonitor.ts` | (was already wired) |
| `bible_search_performed` | `src/components/bible/BibleList.tsx` | (was already wired) |
| `bible_verse_selected` | `src/components/bible/BibleList.tsx` | (was already wired) |
| `bible_version_changed` | `src/components/bible/BibleList.tsx` | (was already wired) |
| `bible_version_selected` | `src/components/bible/BibleVersionSelect.tsx` | `handleSelect` |
| `bible_embedding_sync_started` | `src/components/sermon-listener/LocalEmbeddingSync.tsx` | `handleSeed` |
| `bible_embedding_sync_completed` | `src/components/sermon-listener/LocalEmbeddingSync.tsx` | `handleSeed` (with `elapsed_ms`) |
| `bible_semantic_search` | `src/hooks/useSemanticVerseSearch.ts` | `search` callback |
| `sermon_listener_started` | `src/hooks/useSermonListener.ts` | `start()` `onStart` |
| `sermon_listener_stopped` | `src/hooks/useSermonListener.ts` | `stop()` (with `duration_seconds` + `verses_detected`) |
| `sermon_listener_transcription` | `src/hooks/useSermonListener.ts` | `onResult` final, throttled to 1/5s |
| `sermon_listener_verse_detected` | `src/hooks/useSermonListener.ts` | Regex + semantic match paths |
| `sermon_listener_error` | `src/hooks/useSermonListener.ts` | `onError` + unsupported check |
| `settings_opened` | `src/components/settings/SettingsModal.tsx` | (was already wired) |
| `settings_tab_changed` | `src/components/settings/SettingsModal.tsx` | (was already wired) |
| `theme_changed` | `src/hooks/useQuickActionHandlers.ts` | `toggleDarkMode` (was already wired) |
| `quick_action_used` | `src/hooks/useQuickActionHandlers.ts` | (was already wired — all 9 actions) |
| `media_uploaded` | `src/components/media/MediaUpload.tsx` | `handleUpload` success |
| `media_removed` | `src/components/media/MediaUpload.tsx` | `removeFile` |
| `download_initiated` | `src/pages/Downloads.tsx` | (was already wired — `HeroCTA` + `VariantRow`) |
| `desktop_update_checked` | `src/App.tsx` | `check()` in `App()` |
| `desktop_update_installed` | `src/App.tsx` | `check()` when status indicates update available |
| `library_accessed` | `src/components/library/LibraryPanel.tsx` | `useEffect` on `isOpen` |
| `offline_mode_entered` | `src/providers/ConvexConnectionProvider.tsx` | `checkConnection` when connection drops |
| `landing_cta_clicked` | `src/components/landing/Hero.tsx` | "Get My Church Started" Link (was already wired) |
| `landing_section_viewed` | `src/components/landing/FeaturesRail.tsx` | (was already wired via scroll-reveal) |

---

## ⏳ Remaining — apply the same pattern

For every entry below, the implementation follows this template:

```tsx
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'

// Inside the component:
const { trackEvent } = useAnalytics()

// In the handler (right where the action completes):
trackEvent(AnalyticsEventType.EVENT_NAME, { key: value, ... })
```

| Event | File | Trigger |
|---|---|---|
| `slide_reordered` | `src/hooks/useLiveSession.ts:618`, `:633` | `handleReorderQueue` (queue scope) and `handleSyncOperatorSlides` (operator deck scope) |
| `song_selected` | `src/components/songs/SongList.tsx` | `handleCreateSlides` after slides are created (with `slide_count` + `has_template`) |
| `song_searched` | `src/components/songs/SongList.tsx` | Throttled `useEffect` on `query` (max 1/2s, requires length ≥ 2) |
| `hymn_viewed` | `src/components/hymns/HymnList.tsx` | `handleCreateSlides` (with `hymn_number` + `slide_count`) |
| `background_changed` | `src/components/utils/BackgroundPicker.tsx` | `handleChange` wrapper around `onChange` + local upload path |
| `schedule_created` | `src/components/schedules/ScheduleSelector.tsx` | `handleCreateSchedule` |
| `schedule_edited` | `src/components/schedules/ScheduleSelector.tsx` | `handleSaveEdit` (name rename) |
| `schedule_viewed` | `src/components/schedules/ScheduleSelector.tsx` | `handleSelectSchedule` |
| `countdown_started` | `src/components/live/LiveOutput.tsx` | When a countdown slide becomes live (in the preview useEffect) |
| `countdown_completed` | `src/components/live/LiveOutput.tsx` | When the preview interval hits 0 |
| `alert_triggered` | `src/hooks/useLiveSession.ts:701` | `handleSetOverlay` when `alertId` is passed |
| `lower_third_displayed` | `src/components/live/LiveOutput.tsx` | `handleSetLiveSlide` when `slide.layout === 'lower-third'` |
| `team_invitation_sent` | `src/components/team/TeamManagementPanel.tsx` | Inside `InviteModal.handleSubmit` (link + email paths) |
| `team_member_joined` | `src/components/team/TeamManagementPanel.tsx` | `MembersList` `useEffect` diff-detects new members on the team list |
| `invitation_accepted` | `src/pages/JoinChurch.tsx` | (was already wired) |
| `desktop_update_checked` | `src/hooks/useAppUpdater.ts` | `runCheck` at start + on-demand (App.tsx's dead-code `check()` also has it but is never called) |
| `desktop_update_installed` | `src/hooks/useAppUpdater.ts` | When `result !== 'up to date'` (update available, app will restart) |
| `download_completed` | Hard to detect on web. Recommended: piggyback on the desktop `useAppUpdater` and add an `onDownloadClick` hit on the public `Downloads` page. |  |
| `performance_timing` | `src/utils/perf.ts` (new) | Wrap any critical action (slide switch, search, embedding sync) with a `performance.now()`-based helper that fires `trackEvent` on completion |

---

## Pattern examples for the remaining events

### `slide_reordered` (in SlideList)
```tsx
const { trackEvent } = useAnalytics()
const handleLayoutChange = useCallback((newLayout) => {
    // ... existing layout persistence ...
    trackEvent(AnalyticsEventType.SLIDE_REORDERED, {
        slide_count: newLayout.length,
    })
}, [trackEvent])
```

### `background_changed` (in BackgroundPicker)
```tsx
const { trackEvent } = useAnalytics()
const handlePick = (background: string, backgroundType: string) => {
    onPick(background, backgroundType)
    trackEvent(AnalyticsEventType.BACKGROUND_CHANGED, {
        background_type: backgroundType,
        is_default: !!isDefaultBackground,
    })
}
```

### `countdown_completed` (in LiveOutput)
The preview interval at `src/components/live/LiveOutput.tsx:394-403` ticks down — when it hits 0, fire:
```tsx
trackEvent(AnalyticsEventType.COUNTDOWN_COMPLETED, {
    duration_seconds: initialSeconds,
    slide_id: liveSlide.id,
})
```

### `alert_triggered` / `lower_third_displayed`
Look in `src/components/editor/AddAlertModal.tsx` (or wherever the alert CTA submits) and add the `trackEvent` next to the existing mutation. For lower-thirds, extend the `SLIDE_DISPLAYED` block in `LiveOutput.tsx:216` with an `if (slide.layout === 'lower-third')` branch.

---

## ❌ Skipped intentionally

| Event | Reason |
|---|---|
| `app_loaded` already wired | Confirmed in `App.tsx`. If you want a more precise measurement (after React hydration, after all queries resolve), wrap the `setTimeout(..., 0)` in a real `requestIdleCallback` or after a `Promise.all` of critical queries. |
| `landing_section_viewed` (was already wired) | Uses IntersectionObserver via `useScrollReveal` in `FeaturesRail.tsx`. Fires once per section entry. |

---

## How to verify

1. Set `VITE_ANALYTICS_PROVIDER=amplitude` and `VITE_AMPLITUDE_KEY=<key>` in `.env.local`.
2. `npm run dev`, then trigger each event (sign in, start sermon listener, present a slide, etc.).
3. Open Amplitude → *Events* → you should see your custom events flowing.
4. Open Amplitude → *Session Replay* → you should see recording sessions.

## Migration notes

The amplitude provider now uses `@amplitude/unified` instead of `@amplitude/analytics-browser` directly. The unified SDK bundles both analytics and session replay under one `initAll()` call. All existing methods (`track`, `identify`, `reset`, `setOptOut`, `flush`, `Identify`) still work via the unified export.

The provider is configured with:
- `analytics.autocapture: false` (manual tracking, matches your baseline decision)
- `sessionReplay.sampleRate: 1` (100% sampling — change via `options.sessionReplaySampleRate` if needed)
- App super-properties attached on init: `app_version`, `is_desktop`
