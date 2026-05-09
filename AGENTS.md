# Selah — Agent Context

## Collaboration Architecture (Hybrid Local-First)

### Overview
Multi-user real-time collaboration for live presentation control. Uses Convex subscriptions when online, falls back to Zustand + BroadcastChannel when offline. A single designated "operator" controls the projector; others are "contributors" (can queue slides) or "viewers" (watch only). Sessions support configurable collaboration modes: `strict`, `moderated`, or `open`.

### Tables
| Table | Purpose |
|---|---|
| `liveSessions` | Per-schedule collaborative session. Fields: `scheduleId`, `operatorId`, `liveSlideId`, `operatorSlideIds`, `queue` (structured: `[{slideId, suggestedBy, suggestedAt}]`), `collaborationMode` (`strict` / `open` / `moderated`), `isBlank`, `activeOverlay`, `status` |
| `presence` | Heartbeat-based online tracking. Fields: `userId`, `churchId`, `location`, `activeScheduleId`, `liveSessionId`, `sessionRole`, `lastSeen` |
| `slides` | Now has `lockedBy` / `lockedAt` for edit locking (auto-expires after 5min) |

### Convex Functions
| File | Key Functions |
|---|---|
| `convex/liveSessions.ts` | `startSession` (accepts `collaborationMode`), `endSession`, `joinSession`, `leaveSession`, `setLiveSlide` (operator or open-mode), `setOperatorSlides` (operator only), `addToQueue` (mode-aware: blocked in strict, appended in moderated, position-insertable in open), `removeFromQueue`, `acceptFromQueue` (operator only — moves from queue to operatorSlideIds), `reorderQueue` (operator only), `toggleBlank` (operator only), `setOverlay`, `transferOperator` |
| `convex/presence.ts` | `heartbeat` (15s interval), `getPresenceByChurch`, `getPresenceBySession`, `leavePresence`, `cleanupStalePresence` |
| `convex/slides.ts` | `lockSlide`, `unlockSlide`, `unlockExpiredLocks` |
| `convex/schedules.ts` | `updateSchedule`/`deleteSchedule` now enforce `editorIds`; `addScheduleEditor`, `removeScheduleEditor` added |

### Hooks
| Hook | Purpose |
|---|---|
| `useLiveSession` | Bridges Zustand local state ↔ Convex shared session. Exposes `collaborationMode`, `isOpen`/`isStrict`/`isModerated` booleans. Optimistic local updates with rollback on failure. Syncs `operatorSlideIds` and structured `queue` from server with equality guards to prevent re-render thrash |
| `usePresence` | 15s heartbeat, visibility-aware updates, auto-leave on unmount |
| `useCollaborationToasts` | Watches `liveSessions` + `presence` subscriptions, shows `sonner` toasts for slide changes, queue suggestions, suggestion acceptance, and session events |

### UI Components
| Component | Location |
|---|---|
| `LiveSessionControls` | Top bar — collaboration mode picker (Strict/Review/Open), "Start Session" button, "End" (operator), "Join" / "Watch" (contributors), operator handoff dropdown. Displays active mode badge during session |
| `PresenceAvatars` | Top bar — avatar stack showing who's online with role badges |
| `SlideCard` | Orange "Editing" badge when `lockedBy` is set. "Suggest to queue" button for connected contributors |
| `LiveOutput` | Operator: prev/next advance synced to shared session, Accept/Dismiss on suggested queue items. Contributor in moderated: "Suggest" button. Contributor in open: prev/next directly advance the shared live slide |

### Collaboration Modes
| Mode | Contributor Nav Arrows | Contributor "Go Live" | Queue Behavior | Best For |
|---|---|---|---|---|
| `strict` | Disabled | ❌ | Only operator can add | Formal services |
| `moderated` | Disabled (suggest instead) | ❌ | Contributors suggest → operator approves | Mid-size teams, rehearsals |
| `open` | Enabled (changes live) | ✅ | Direct action, no approval gate | Informal, small teams |

### Session Roles
| Role | Abilities |
|---|---|
| `operator` | Start session, advance slides, blank screen, accept/reorder queue, transfer control, set collaboration mode |
| `contributor` | Join session, suggest slides to queue (moderated), directly advance slides (open), view live feed |
| `viewer` | Watch live feed only |

### Key Decisions
- **Configurable collaboration modes** let operators choose the right level of control per service
- **Single operator model** prevents chaos during formal services (strict/moderated modes)
- **Structured queue entries** (`{slideId, suggestedBy, suggestedAt}`) enable contributor attribution
- **`operatorSlideIds`** persists the accepted slide order to Convex so it survives refresh/transfer
- **Optimistic updates with rollback** ensure snappy UI while maintaining server consistency
- **Per-schedule sessions** support simultaneous services (main + youth)
- **Presence as separate table** (not embedded array) for proper Convex indexing
- **Toast library: sonner** (`sonner` package installed)

## Multi-Monitor / Live Output (Web + Desktop)

### Architecture
The live output system has **two code paths**: native (Tauri desktop) and web (browser Presentation API). Both are managed through `useNativeMultiMonitor`, which auto-detects the environment.

### Critical Rule: Every desktop-only code path MUST have a web fallback
When adding features to `useNativeMultiMonitor`, `ScreenPicker`, or `LiveOutput`:
- Every `if (isDesktop)` branch MUST have an `else` that handles web mode
- `openLiveWindow()` MUST NOT throw in web mode — use `multiMonitorService.startPresentation()` or `window.open()` as fallback
- `detectMonitors()` MUST call `setMonitors()` in BOTH branches — the web branch previously only returned mapped screens without updating React state, causing "No screens detected"
- `init()` web branch MUST auto-detect screens (call `multiMonitorService.detectScreens()` + `setMonitors()`), not just subscribe to `webState`
- ScreenPicker MUST use `monitors` (not `screens`) for the screen list, since `monitors` is the unified state that's populated in both modes

### Testing
- Test files: `src/store/__tests__/sharedQueue.test.ts`, `src/hooks/__tests__/liveSessionSync.test.ts`, `src/hooks/__tests__/useNativeMultiMonitor.test.ts`
- Key scenarios covered: queue sync backward compat (queue vs queuedSlideIds), operatorSlideIds operator-only sync, collaboration mode behaviors, session cleanup race conditions, screen detection mapping
