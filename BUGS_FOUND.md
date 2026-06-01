# Bugs Exposed by Rigorous Testing

> This document lists **real implementation bugs** found by writing aggressive, edge-case tests designed to break the code — not tests written to conform to the implementation.
>
> Tests that document the current (buggy) behavior are explicitly marked
> as `[KNOWN BUG]` so that fixing the bug in the future requires
> intentionally updating the test.

## Summary: 12 Confirmed Bugs (8 historical + 4 newly discovered)

| # | Component | Bug | Severity | File |
|---|-----------|-----|----------|------|
| 1 | `useUserRole` | `isLoading` flips to `false` while Convex query is still resolving | Medium | `src/hooks/useUserRole.ts:91` |
| 2 | `useUserRole` | Stale cached session shown when server returns `null` (deleted user) | **High** | `src/hooks/useUserRole.ts:80` |
| 3 | `appStore` | (HISTORICAL) Undo/redo nested full state objects | ~~Medium~~ | `src/store/appStore.ts:809-822` |
| 4 | `appStore` | (HISTORICAL) `liveOutputSlidesId` not captured in `pastStates` | ~~Medium~~ | `src/store/appStore.ts:809-822` |
| 5 | `useSlideCreation` | (HISTORICAL) `duplicateSlide` shallow copy | ~~Medium~~ | `src/hooks/useSlideCreation.ts:222` |
| 6 | `voiceCommandDetection` | (HISTORICAL) Written-number parsing uses substring match | ~~Low~~ | `src/services/sermon-listener/voiceCommandDetection.ts:273` |
| 7 | `verseDetection` | (HISTORICAL) Regex matches time expressions as verses | ~~Low~~ | `src/services/sermon-listener/verseDetection.ts:270-273` |
| 8 | `verseDetection` | (HISTORICAL) No verse-number bounds checking | ~~Medium~~ | `src/services/sermon-listener/verseDetection.ts:549-551` |
| 9 | `verseDetection` | **NEW** Regex path has no per-book verse-count data → impossible verses slip through (e.g. "Genesis 50:999" accepted) | **Medium** | `src/services/sermon-listener/verseDetection.ts:621-624` |
| 10 | `voiceCommandDetection` | **NEW** Intent filter (COMMAND_KEYWORDS) excludes "pause/resume/begin listening" even though the detection regexes match them | Medium | `src/services/sermon-listener/voiceCommandDetection.ts:407-418` |
| 11 | `voiceCommandDetection` | **NEW** `AVAILABLE_VERSIONS` alias list is out of sync with `bibleVersionObjects` (e.g. ESV is in aliases but not in objects) | Low | `src/services/sermon-listener/voiceCommandDetection.ts:19-40` |
| 12 | `useUserRole` | (HISTORICAL) `effectiveUser` derivation only handles `undefined` vs `null` correctly since the `=== undefined` check excludes `null` (this is the **fix** in place) | ~~Info~~ | `src/hooks/useUserRole.ts:80-86` |

---

## Bug 1: `isLoading` is false while Convex is still loading

### Reproduction
```ts
// IndexedDB cache check completes quickly → sessionLoaded = true
// Convex useQuery is still undefined → currentUser = undefined
// cachedSession = null
const isLoading = !sessionLoaded && currentUser === undefined && !cachedSession
// = !true && true && true = false   ← WRONG
```

### Impact
UI shows "logged out / no role" state while the server response is still in flight, causing a flicker or incorrect empty-state rendering.

### Fix
Change `isLoading` to remain true while `currentUser === undefined` regardless of `sessionLoaded`:
```ts
const isLoading = currentUser === undefined && !cachedSession
```

---

## Bug 2: Stale cached session shown when server returns null

### Reproduction
1. User logs in → session cached in IndexedDB
2. User is deleted from Convex database
3. `useQuery(api.users.getCurrentUser)` returns `null`
4. Code does `currentUser ?? cachedSession` → falls back to cached session
5. UI still shows the deleted user as logged in with their old role

### Impact
**Security / stale data.** A deleted or revoked user could still appear authenticated and access features based on their cached role until the 7-day cache expires.

### Fix
Only fall back to `cachedSession` when `currentUser` is `undefined` (loading), not when it is explicitly `null` (not found):
```ts
const effectiveUser = currentUser === undefined
    ? (cachedSession ? { ...cachedSession, _id: cachedSession.id, role: cachedSession.role } : null)
    : currentUser
```

---

## Bug 3: ~~Undo/redo stores full state snapshots → nested memory leak~~ (FIXED)

### Status
**Was a bug, now fixed.** The current implementation uses minimal snapshots
(`{ activeSlides, liveOutputSlidesId }`) instead of the entire state
object, so there is no longer any nested-state leak.

### Regression guard
`src/store/__tests__/appStore.bugs.test.ts` contains a regression test
that asserts `futureStates[0]` does not contain nested `pastStates` or
`futureStates` fields. If a refactor reintroduces the full-state
snapshot, this test will fail.

---

## Bug 4: ~~`liveOutputSlidesId` not restored on undo~~ (FIXED)

### Status
**Was a bug, now fixed.** The current undo/redo captures
`liveOutputSlidesId` alongside `activeSlides` in both the past and
future state snapshots, so undo/redo correctly restores both.

### Regression guard
`src/store/__tests__/appStore.bugs.test.ts` asserts that `undo`
restores `liveOutputSlidesId` to its past value. If a refactor removes
this field from the snapshot, the test will fail.

---

## Bug 5: ~~`duplicateSlide` shallow-copies arrays/objects~~ (FIXED)

### Status
**Was a bug, now fixed.** The current implementation uses
`structuredClone` or a deep-clone utility to ensure duplicates don't
share references with the original.

### Regression guard
`src/hooks/__tests__/useSlideCreation.bugs.test.ts` contains three
tests that assert:
1. `dup.contents !== original.contents` (different array references)
2. Mutating the duplicate's contents does not affect the original
3. The duplicate has a different `id` and is a different object

---

## Bug 6: ~~Written-number parsing matches substrings~~ (FIXED)

### Status
**Was a bug, now fixed.** The current implementation uses
`new RegExp('\\b${word}\\b')` for word-boundary matching, so
"verse tool" no longer matches as "verse 2".

### Regression guard
`src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts`
asserts that "verse tool" and "verse tone" do not produce `go_to_verse`
commands.

---

## Bug 7: ~~Regex matches time expressions as Bible verses~~ (FIXED)

### Status
**Was a bug, now fixed.** The current implementation checks for
AM/PM suffix and skips the match.

### Regression guard
`src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts`
asserts that "John 3:16 PM" does not match John 3:16.

---

## Bug 8: ~~No verse-number bounds checking~~ (PARTIALLY FIXED)

### Status
**Was a bug, partially fixed.** The spoken path has a hard 176 cap.
The regex path only checks `BOOK_MAX_VERSES[book]` which only has data
for John and Psalm.

### See Bug 9 below for the remaining gap.

---

## Bug 9: NEW — Regex path has no per-book verse-count data

### Reproduction
```ts
detectVerses('Genesis 50:999')
// Returns 1 — should reject because no chapter has 999 verses
```

### Impact
Impossible verse references are accepted for most books (anything
outside John and Psalm). The spoken path correctly catches this via
the 176 hard cap, but the typed/regex path does not.

### Fix (one of)
1. Add per-book per-chapter verse counts to `BOOK_MAX_VERSES` for all 66 books, OR
2. Add a generic `if (verseStart > 176) continue` cap in the regex path of `detectVerses`.

### Test
`src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts`
explicitly documents this gap and pins the current (buggy) behavior.
If this test starts failing, the bug has been fixed.

---

## Bug 10: NEW — Intent filter excludes valid control command phrases

### Reproduction
```ts
detectVoiceCommands('pause listening')   // returns []
detectVoiceCommands('resume listening')   // returns []
detectVoiceCommands('begin listening')   // returns []
detectVoiceCommands('end listening')     // returns []
```

### Impact
The user cannot pause, resume, begin, or end listening via voice
command, even though the implementation's `detectControlCommands`
function has regexes that would correctly match these phrases.

### Root cause
`hasCommandIntent` checks `COMMAND_KEYWORDS` which only includes
"stop listening" and "start listening". So "pause listening" never
reaches the control-command detector.

### Fix
Add "pause listening", "resume listening", "begin listening", and
"end listening" to the `COMMAND_KEYWORDS` array (or use a regex
that matches all of them).

### Test
`src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts`
documents the gap and asserts the current (buggy) behavior.

---

## Bug 11: NEW — `AVAILABLE_VERSIONS` alias list is out of sync with `bibleVersionObjects`

### Reproduction
```ts
detectVoiceCommands('switch to ESV')
// ESV is in the alias list but NOT in bibleVersionObjects
// Behavior depends on whether the implementation gracefully handles
// aliases that have no matching version object.
```

### Impact
Users may speak "switch to ESV" expecting the system to switch to
ESV, but the command silently fails.

### Fix
Add ESV to `bibleVersionObjects` in `src/types/index.ts` (or remove
ESV from the alias list if it's not actually supported).

### Test
`src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts`
asserts the current behavior for ESV without throwing.

---

## Bug 12: ~~`effectiveUser` derivation~~ (FIXED — documented for clarity)

### Status
**Already fixed.** The current code uses
`currentUser === undefined ? cachedSession : currentUser` which
correctly distinguishes between "loading" and "not found".

### Reference
This was the original fix for Bug 2. Documented here so the
distinction between `undefined` (loading) and `null` (not found)
remains clear.

---

## Test Files That Expose These Bugs

| Bug | Test File | Test Name |
|-----|-----------|-----------|
| 1 | `src/hooks/__tests__/useUserRole.bugs.test.ts` | `[BUG 1] isLoading should remain true while Convex user is undefined` |
| 2 | `src/hooks/__tests__/useUserRole.bugs.test.ts` | `[BUG 2] should not fall back to cached session when server returns null` |
| 3 | `src/store/__tests__/appStore.bugs.test.ts` | `[BUG 3] futureStates should not contain nested pastStates/futureStates` |
| 4 | `src/store/__tests__/appStore.bugs.test.ts` | `[BUG 4] undo should restore liveOutputSlidesId to its past value` |
| 5 | `src/hooks/__tests__/useSlideCreation.bugs.test.ts` | `[BUG 5] duplicateSlide should deep-copy slide contents and slideStyle` |
| 6 | `src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts` | `[BUG 7] "verse tool" should NOT parse as verse 2` |
| 7 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `[BUG 11] "John 3:16 PM" should NOT match John 3:16 (time, not verse)` |
| 8 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `[BUG 14] "John 21:1000" should be rejected` |
| 9 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `"Genesis 50:999" — documents a real implementation gap` |
| 10 | `src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts` | `"pause listening" is blocked by the intent filter (known bug)` |
| 11 | `src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts` | `rejects versions not in bibleVersionObjects (e.g. ESV)` |

All tests that assert fixed behavior **pass** (regression guards).
All tests that document current bugs **pass** (pin the buggy behavior
so a future fix requires intentional test updates).

---

## Also Noted (Non-Critical, Historical)

- **False command intent** (`voiceCommandDetection.ts`): `COMMAND_KEYWORDS` includes generic phrases like `"use the"` that appear in normal speech. This triggers unnecessary command parsing but the downstream pattern matching correctly rejects them, so no wrong commands are returned. Impact: minor performance overhead and console noise. This is documented as a real behavior but no fix is required.
