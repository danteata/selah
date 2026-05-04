# Selah — Agent Context

## Collaboration Architecture (Hybrid Local-First)

### Overview
Multi-user real-time collaboration for live presentation control. Uses Convex subscriptions when online, falls back to Zustand + BroadcastChannel when offline. A single designated "operator" controls the projector; others are "contributors" (can queue slides) or "viewers" (watch only).

### Tables
| Table | Purpose |
|---|---|
| `liveSessions` | Per-schedule collaborative session. Fields: `scheduleId`, `operatorId`, `liveSlideId`, `queuedSlideIds`, `isBlank`, `activeOverlay`, `status` |
| `presence` | Heartbeat-based online tracking. Fields: `userId`, `churchId`, `location`, `activeScheduleId`, `liveSessionId`, `sessionRole`, `lastSeen` |
| `slides` | Now has `lockedBy` / `lockedAt` for edit locking (auto-expires after 5min) |

### Convex Functions
| File | Key Functions |
|---|---|
| `convex/liveSessions.ts` | `startSession`, `endSession`, `joinSession`, `leaveSession`, `setLiveSlide` (operator only), `addToQueue`, `removeFromQueue`, `reorderQueue` (operator only), `toggleBlank` (operator only), `setOverlay`, `transferOperator` |
| `convex/presence.ts` | `heartbeat` (15s interval), `getPresenceByChurch`, `getPresenceBySession`, `leavePresence`, `cleanupStalePresence` |
| `convex/slides.ts` | `lockSlide`, `unlockSlide`, `unlockExpiredLocks` |
| `convex/schedules.ts` | `updateSchedule`/`deleteSchedule` now enforce `editorIds`; `addScheduleEditor`, `removeScheduleEditor` added |

### Hooks
| Hook | Purpose |
|---|---|
| `useLiveSession` | Bridges Zustand local state ↔ Convex shared session. Online: operator's `setLiveSlide` syncs to Convex; offline: Zustand works standalone |
| `usePresence` | 15s heartbeat, visibility-aware updates, auto-leave on unmount |
| `useCollaborationToasts` | Watches `liveSessions` + `presence` subscriptions, shows `sonner` toasts for slide changes, queue additions, session events |

### UI Components
| Component | Location |
|---|---|
| `LiveSessionControls` | Top bar — "Go Live" (start session), "End" (operator), "Join" / "Watch" (contributors), operator handoff dropdown |
| `PresenceAvatars` | Top bar — avatar stack showing who's online with role badges |
| `SlideCard` | Orange "Editing" badge when `lockedBy` is set |
| `LiveOutput` | Operator: prev/next advance to shared session. Contributor: "Suggest Next" button instead of disabled arrows |

### Session Roles
| Role | Abilities |
|---|---|
| `operator` | Start session, advance slides, blank screen, reorder queue, transfer control |
| `contributor` | Join session, add to queue, suggest next slide |
| `viewer` | Watch live feed only |

### Key Decisions
- **Single operator model** prevents chaos during service
- **Direct-to-queue** for contributors (no approval gate)
- **Per-schedule sessions** support simultaneous services (main + youth)
- **Presence as separate table** (not embedded array) for proper Convex indexing
- **Toast library: sonner** (`sonner` package installed)
