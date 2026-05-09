# Live Collaboration Architecture

Selah live collaboration is a hybrid local-first system. Local Zustand state keeps solo/offline presenting fast, while Convex is the source of truth during a shared live session.

## Core Model

`liveSessions` is the shared session document. It owns:

- `scheduleId`: the schedule being presented.
- `operatorId`: the one user responsible for formal control.
- `liveSlideId`: the slide currently live.
- `operatorSlideIds`: the accepted deck order for live output and next-up.
- `queue`: structured suggestions, `{ slideId, suggestedBy, suggestedAt }`.
- `collaborationMode`: `strict`, `moderated`, or `open`.
- `isBlank`, `activeOverlay`, `status`: live output state.

`slides` stores the actual slide content by `scheduleId`. During a session, IDs alone are not enough: every collaborator must also have the slide body, contents, backgrounds, and metadata.

## Client State

Zustand still owns local presentation state:

- `activeSlides`: local slide objects available to the UI.
- `liveOutputSlidesId`: local/live deck order.
- `sharedQueueSlideIds`: rendered queue IDs.
- `liveSlideId`: currently live local slide ID.

During a session, `useLiveSession` bridges Convex into these local stores.

Important rule: shared session hydration must never treat an empty server slide list as an instruction to clear the operator's local deck. Empty can simply mean the deck has not synced yet.

## Session Resolution

`useLiveSession` resolves a session in this order:

1. Active session for the selected/effective schedule.
2. Active church session matching the selected schedule.
3. The only active church session, if exactly one exists.
4. No session if multiple sessions exist and none matches the selected schedule.

This avoids silently joining the wrong session when a church has simultaneous services.

## Slide Sync

The operator publishes the schedule deck to Convex via `slides.syncScheduleSlides`.

Collaborators hydrate session slides from `slides.getSlides(scheduleId)`. Hydration uses `replaceSlidesForSchedule`, which updates slide objects without clobbering `liveOutputSlidesId`.

Single-slide edits during a session, such as Bible verse navigation, use `slides.upsertScheduleSlide`. This lets a contributor in open mode update the current Bible slide content without deleting or replacing the rest of the operator deck.

## Live Slide Actions

`liveSessions.setLiveSlide` is the authoritative mutation.

Server permissions:

- Operator/admin can always set live slide.
- Contributor can set live slide only in `open` mode.
- Strict/moderated contributors cannot set live slide.

Client code may optimistically update local state, but Convex decides whether the action is valid. On mutation failure, local state rolls back to the server slide.

## Queue Actions

`liveSessions.addToQueue` is mode-aware:

- `strict`: only operator/admin can queue.
- `moderated`: contributors can suggest; operator accepts.
- `open`: contributors can queue directly, including insert position.

The client keeps pending queue additions visible while Convex catches up. When the server queue arrives, pending entries are merged by occurrence count and then removed once confirmed.

Duplicate queue entries are supported. Removal and reorder must operate by occurrence, not by "all slide IDs matching this value".

## UI Rules

Slide card actions should follow mode:

- Operator: Go Live.
- Open contributor: Go Live and Suggest/Queue.
- Moderated contributor: Suggest/Queue only.
- Strict contributor/viewer: no live or queue action.

Navigation arrows in `LiveOutput`:

- Operator: can navigate live.
- Open contributor: can navigate live.
- Moderated contributor: gets Suggest for next slide.
- Strict contributor/viewer: cannot navigate live.

Bible verse navigation edits the current slide content. In a session it must also call `syncSlideContent` so other devices receive the updated verse.

## Common Failure Modes

- Live feed is blank: `liveSlideId` exists but the receiving device does not have the slide object. Check `slides.getSlides(scheduleId)` hydration and `syncScheduleSlides`.
- Contributor push live only changes their device: client did not call `setLiveSlide`, or server rejected because session mode was not `open`.
- Queue appears then disappears: stale Convex queue overwrote optimistic local queue. Pending queue merge should preserve it until confirmation or rollback.
- Operator deck resets: server slide hydration replaced local slides with an empty or stale server list. Empty server lists must be ignored for hydration.
- Bible arrows only change one device: slide content changed locally but `upsertScheduleSlide` was not called.

## Testing Checklist

Test each collaboration mode with two signed-in users:

- Start session as operator.
- Confirm contributor sees the same slide deck and next-up.
- In `moderated`, contributor suggests a slide and operator sees queue update.
- In `open`, contributor pushes live and operator live feed updates.
- In `open`, contributor uses next/previous arrows and operator live feed updates.
- On a Bible slide, contributor uses verse left/right and operator live feed changes to the same verse.
- Queue duplicate slide twice, then accept/dismiss one occurrence.
- End session and confirm presence/toasts do not report stale users incorrectly.
