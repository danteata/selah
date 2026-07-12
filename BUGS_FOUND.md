# Bugs Exposed by Rigorous Testing

> This document lists **real implementation bugs** found by writing aggressive, edge-case tests designed to break the code — not tests written to conform to the implementation.
>
> Tests that document the current (buggy) behavior are explicitly marked
> as `[KNOWN BUG]` so that fixing the bug in the future requires
> intentionally updating the test.

## Summary: 23 Confirmed Bugs (8 historical + 15 newly discovered)

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
| 9 | `verseDetection` | (FIXED) Regex path had no per-book verse-count data → impossible verses slipped through (e.g. "Genesis 50:999" accepted) | ~~Medium~~ | `src/services/sermon-listener/verseDetection.ts:272-337` |
| 10 | `voiceCommandDetection` | **NEW** Intent filter (COMMAND_KEYWORDS) excludes "pause/resume/begin listening" even though the detection regexes match them | Medium | `src/services/sermon-listener/voiceCommandDetection.ts:407-418` |
| 11 | `voiceCommandDetection` | **NEW** `AVAILABLE_VERSIONS` alias list is out of sync with `bibleVersionObjects` (e.g. ESV is in aliases but not in objects) | Low | `src/services/sermon-listener/voiceCommandDetection.ts:19-40` |
| 12 | `useUserRole` | (HISTORICAL) `effectiveUser` derivation only handles `undefined` vs `null` correctly since the `=== undefined` check excludes `null` (this is the **fix** in place) | ~~Info~~ | `src/hooks/useUserRole.ts:80-86` |
| 13 | `BibleVerseNavigator` / `useKeyboardShortcuts` | **NEW** Verse navigator has no keyboard shortcut; arrow keys collide with the global slide-queue navigation so the operator has to use the mouse for every verse step | **High** | `src/components/bible/BibleVerseNavigator.tsx:183-195`, `src/pages/Dashboard.tsx:230-231`, `src/components/live/LiveOutput.tsx:251-254` |
| 14 | `voiceCommandDetection` / `verseDetection` / `referenceContext` | (FIXED) "verse" mis-transcribed as "versus" was not recognized by ANY of the three separate detectors that require the literal word "verse" | ~~**High**~~ | `voiceCommandDetection.ts`, `verseDetection.ts`, `referenceContext.ts` |
| 15 | `voiceCommandDetection` | (FIXED) Compound spoken chapter/verse numbers ("twenty five", "hundred and forty seven") silently truncated to their first word instead of failing | ~~**High**~~ | `src/services/sermon-listener/voiceCommandDetection.ts` |
| 16 | `voiceCommandDetection` | (FIXED) The loose "two adjacent numbers = chapter+verse" fallback misinterpreted a genuine compound chapter number as a separate chapter+verse pair | ~~Medium~~ | `src/services/sermon-listener/voiceCommandDetection.ts` |
| 17 | `voiceCommandDetection` | (FIXED) Bare "verse N" word-number parsing only covered 1-20; "verse thirty"/"verse forty seven" produced no command at all | ~~**High**~~ | `src/services/sermon-listener/voiceCommandDetection.ts` |
| 18 | `referenceContext` | (FIXED) A verse number said with NO "verse"/"versus" keyword at all, in its own separate ASR utterance right after a chapter announcement, was never resolved | ~~**High**~~ | `src/services/sermon-listener/referenceContext.ts` |
| 19 | `audio_capture` | (FIXED) Audio-features heartbeat went silent during a genuine upstream audio-delivery gap, tricking the frontend watchdog into an unnecessary capture restart | ~~Medium~~ | `src-tauri/src/audio_capture/mod.rs` |
| 20 | `ScreenPicker` | (FIXED) A `<button>` nested inside another `<button>` (invalid HTML) caused a hydration warning and unreliable clicks on the "Identify" control | ~~Low~~ | `src/components/live/ScreenPicker.tsx` |
| 21 | `useSermonListener` | (FIXED) Navigation cooldown blocked auto-display of a verse continuing the SAME reference a voice command had just set | ~~Medium~~ | `src/hooks/useSermonListener.ts` |
| 22 | `useSermonListener` / `verseDetection` | (FIXED) Regex verse detection scanned the entire ever-growing session transcript on every utterance, so an old verse could never genuinely go silent — and its own reference-based dedup made a real re-mention invisible — letting an old, already-shown verse randomly hijack whatever chapter was currently live | ~~**High**~~ | `src/hooks/useSermonListener.ts` |
| 23 | `useSermonListener` | (FIXED) Reactivation logic only ever refreshed the "last seen" timestamp of ONE still-matching reference per tick (`reActivatedRefs[0]`/`semanticReActivatedRefs[0]`), letting every other one go falsely "silent" and later hijack the live display even though it was still being matched the whole time | ~~**High**~~ | `src/hooks/useSermonListener.ts` |

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

## Bug 8: ~~No verse-number bounds checking~~ (FIXED)

### Status
**Fixed.** See Bug 9 below.

---

## Bug 9: ~~Regex path has no per-book verse-count data~~ (FIXED)

### Original reproduction
```ts
detectVerses('Genesis 50:999')
// Returned 1 — should reject because Genesis 50 only has 26 verses
```

### Original impact
Impossible verse references were accepted for most books (anything
outside John and Psalm — and even the Psalm entry was dead due to a
`'Psalm'` vs canonical `'Psalms'` key mismatch, so it never actually
fired). The spoken path caught gross cases via a 176 hard cap, but the
typed/regex path did not.

### Fix applied
`BOOK_MAX_VERSES` (`src/services/sermon-listener/verseDetection.ts`) is
now generated from `public/bibles/kjv.json` (ground truth) and covers
all 66 books, keyed by the canonical `'Psalms'` name. This also fixed
several transcription errors in the old hand-typed John entries (e.g.
John 14 was hardcoded as 21 verses; the real count is 31). The same
table is used by `llmVerseExtraction.ts`'s hallucination check, which
also had an off-by-one indexing bug (`[chapter]` instead of
`[chapter - 1]`) fixed alongside it.

### Test
`src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts`
now asserts `Genesis 50:999` is rejected.

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

## Bug 13: NEW — Verse navigator has no keyboard shortcut, arrow keys collide with slide queue

### Reproduction
1. Open the dashboard, then make a bible slide the live slide.
2. Notice the bible verse navigator appears at the bottom of the live output.
3. Try to step through verses with the arrow keys. Instead of stepping
   through the verses, the slide queue's `navigateToNextSlide` /
   `navigateToPrevSlide` handlers fire (defined in
   `src/pages/Dashboard.tsx:230-231` and `src/components/live/LiveOutput.tsx:251-254`).
4. Even more confusingly, there is NO keyboard path to verse navigation at
   all — `navigateVerse` in `BibleVerseNavigator.tsx` and `PreviewContent.tsx`
   is only ever triggered by the chevron buttons.

### Impact
**UX / accessibility bug.** The most useful keyboard shortcut for a
bible-presenting operator (next/previous verse) does not exist. Users
have to grab the mouse and click the chevron buttons for every verse
change, breaking the flow of a live presentation.

### Root cause
The `navigateVerse` callbacks exist in three components but were never
bound to a global `useEffect`-based listener. And the obvious candidate
keys (ArrowLeft/ArrowRight/ArrowUp/ArrowDown) were already taken by the
slide-queue navigation.

### Fix
- Add a new `useVerseNavigationShortcuts` hook in
  `src/hooks/useKeyboardShortcuts.ts` that listens for **N** (next),
  **P** (previous), **←** (previous), and **→** (next) on a bible
  slide.
- Deliberately skip `ArrowUp` / `ArrowDown` so the slide-queue
  navigation is never shadowed.
- Use the `enabled: boolean` option to gate the hook to only fire when
  a bible slide is currently selected/live, so it never silently
  swallows keystrokes for non-bible slides.
- `BibleVerseNavigator` now exposes `navigateVerse` via `forwardRef` so
  the parent (LiveOutput) can drive it from a single global listener.
- `LiveOutput`, `PreviewContent`, and `QuickBibleBar` all use the new
  hook with an appropriate `enabled` predicate.
- Document the new shortcuts in `ShortcutsModal.tsx`.

### Tests
`src/hooks/__tests__/useKeyboardShortcuts.test.ts` adds 8 tests for
`useVerseNavigationShortcuts` covering N/P, ←/→, modifier-key
suppression, the input-focus guard, the `enabled` flag, and
`preventDefault` behavior. Critically there is a regression-guard test
that asserts ArrowUp / ArrowDown do **not** trigger the verse callbacks
(so the slide-queue shortcut can never be silently shadowed).

---

## Bug 14: ~~"verse" mis-transcribed as "versus" not recognized anywhere~~ (FIXED)

### Reproduction
Found by reviewing real sermon transcripts, where Whisper very
frequently hears a bare spoken "verse" as "versus" (phonetically
close) — dozens of times in a single session:
```ts
detectVoiceCommands('Versus 6')       // → [] (no command at all)
detectVerses('John 3 versus 16')      // → [] (no match)
```

### Impact
**High — this was likely the single biggest cause of "the live slide
never advances past the bare chapter's verse 1"** in real usage. Every
time a preacher's "verse N" got transcribed as "versus N" (extremely
common), the reference silently failed to resolve via any of the three
independent code paths that each require the literal word "verse":
- `voiceCommandDetection.ts`'s `detectGoToVerseCommands` and the
  `BOOK_CHAPTER_VERSE_REGEX` / `BOOK_CHAPTER_REGEX` separator group.
- `verseDetection.ts`'s `CHAPTER_VERSE_PATTERN` and the
  `detectSpokenVerses` token check (`tokens[pointer] === 'verse'`).
- `referenceContext.ts`'s `BARE_VERSE_PATTERN` (bare "verse N"
  resolution against a fresh book+chapter context).

Also note `hasCommandIntent`'s `COMMAND_KEYWORDS` list included
`'verse'` as a substring-matched keyword, but `"versus".includes("verse")`
is `false` (they diverge at the 5th letter) — so "versus" utterances
were rejected before even reaching the pattern-matching stage.

### Fix
Added `"versus"` as an accepted alternative everywhere `"verse"` is
accepted as a separator/keyword, in all three files above, graded with
the exact same confidence as `"verse"` (never trusted more than it).

### Test
`voiceCommandDetection.bugs.test.ts`, `verseDetection.bugs.test.ts`,
and `referenceContext.bugs.test.ts` each assert a "versus" variant
resolves identically to the "verse" form.

---

## Bug 15: ~~Compound spoken numbers truncated to their first word~~ (FIXED)

### Reproduction
```ts
detectVoiceCommands('Psalm hundred and forty seven.')
// chapter: 100 (should be 147 — "and forty seven" silently dropped)
detectVoiceCommands('verse twenty five')
// targetVerse: 20 (should be 25 — "five" silently dropped)
detectVoiceCommands('verse thirty')
// → [] (no command at all — "thirty" wasn't even in the word list)
```

### Impact
**High.** Worse than a miss — it confidently produced the WRONG
chapter/verse instead of failing, which is exactly the failure mode
this app is designed to avoid ("better to miss than show wrong").
`detectGoToVerseCommands`'s word-number map (`WRITTEN_NUMBERS`) only
covered single words 1-20 (`too`/`to` mishearings aside), and
`CHAPTER_NUM`'s regex only ever captured one word from `SPOKEN_NUMBERS`
regardless of how many number-words followed it.

### Fix
- Replaced `parseVerseNumber`'s hand-rolled `WRITTEN_NUMBERS` map with
  a call to `parseSpokenNumber` (`verseDetection.ts`), which already
  supports full multi-word compounds ("twenty five", "hundred and
  seventy six") and "and"-joining.
- Widened `CHAPTER_NUM`/the verse-capture regex groups to a general
  `SPOKEN_NUMBER_PHRASE` (up to 4 number-words, optionally "and"-joined)
  instead of a single word, so the regex hands `parseSpokenNumber` the
  whole phrase instead of truncating it.
- Raised the verse sanity ceiling from 150 to 176 (Psalm 119, the
  longest chapter in the Bible — the old 150 cap, copied from the
  chapter cap, was itself too low for a legitimate verse number).

### Test
`voiceCommandDetection.bugs.test.ts` asserts the compound-number cases
above resolve to the correct number.

---

## Bug 16: ~~Loose chapter+verse split misfired on a genuine compound number~~ (FIXED)

### Reproduction
```ts
detectVoiceCommands('Psalm chapter twenty five')
// chapter: 20, verse: 5   (should be: chapter 25, no verse)
```

### Impact
**Medium — introduced while fixing Bug 15**, so documented here as its
own case: `BOOK_CHAPTER_VERSE_LOOSE_REGEX` exists to split two adjacent
bare numbers into chapter+verse ("John 3 16", "Romans 10, 17"). Once
compound numbers were recognized (Bug 15), that same loose heuristic
started misreading a genuine two-word compound chapter number
("twenty five" = 25) as if the two words were separate chapter and
verse numbers — and both interpretations are independently valid Bible
references, so bounds-checking alone can't tell them apart.

### Fix
Before accepting a loose chapter+verse split, check whether the two
captured words could ALSO combine into one valid number via
`parseSpokenNumber(chapterWord + ' ' + verseWord)`. If they can, the
split is ambiguous with a single compound number, so the loose match is
rejected — leaving the (correct) chapter-only detector's result as the
one that fires. Confirmed this doesn't regress the case the heuristic
exists for: "three" and "sixteen" (in `"John chapter three sixteen"`)
can't combine (two ones-scale words in a row is not a valid English
compound), so that case still correctly splits into chapter 3 verse 16.

### Test
`voiceCommandDetection.bugs.test.ts` covers both the compound-number
case ("Psalm chapter twenty five" → 25, no verse) and the
still-must-split control case ("John chapter three sixteen" → 3:16).

---

## Bug 17: ~~Bare "verse N" word-number parsing only covered 1-20~~ (FIXED)

### Reproduction
See Bug 15 — `detectGoToVerseCommands('verse thirty')` and
`'verse forty seven'` both produced no command at all before the fix,
since `WRITTEN_NUMBERS` (the map `parseVerseNumber` used) never had
entries for `thirty`, `forty`, `hundred`, etc.

### Impact
**High.** Any bare "verse N" spoken with N ≥ 21 as a word (not a digit)
— an extremely common real verse number range — silently produced no
command, leaving the live slide stuck wherever it was.

### Fix
Folded into the Bug 15 fix: `parseVerseNumber` now delegates to
`parseSpokenNumber`, which has the full 1-176+ vocabulary.

### Test
See Bug 15's test coverage.

---

## Bug 18: ~~Bare verse number with no keyword at all was never resolved~~ (FIXED)

### Reproduction
Real transcript: the preacher said "Hebrews 13" as one utterance, then
"Five." as its own, separate utterance moments later (meant as
"verse 5"). No keyword ("verse"/"versus") was present at all:
```ts
// After context = { book: 'Hebrews', chapter: 13 }
resolveBareReferences('Five.', context)   // → [] (needs a keyword)
detectVoiceCommands('Five.')              // → [] (fails hasCommandIntent)
```

### Impact
**High.** This is an extremely common real-time-ASR artifact — a
preacher announces the chapter, pauses, then just says the verse
number, and the streaming engine chunks it into its own utterance with
the "verse" word clipped or simply not repeated. Every existing
mechanism (voice commands, `referenceContext.ts`'s bare-reference
resolver) required an explicit keyword to anchor on, so this class of
utterance was silently and completely dropped — the live slide stayed
on the bare chapter's default verse 1 indefinitely.

### Fix
Added `resolveStandaloneNumberContinuation` (`referenceContext.ts`):
resolves an ASR utterance against a fresh reference context ONLY when
the ENTIRE utterance is nothing but a number (never a number embedded
in ordinary sentence text, to avoid misattributing an unrelated
count/date/quantity), and only within a much tighter 15-second
freshness window than the general 120-second context TTL — a bare
unqualified number is a much weaker signal than an explicit "verse N",
so it shouldn't stay eligible to attach to the chapter for as long.
Wired into `useSermonListener.ts` against `latestChunkForCommands`
specifically (the single latest utterance), not the full accumulated
transcript, so the "whole utterance" check is meaningful.

### Test
`referenceContext.bugs.test.ts` covers the Hebrews 13 → "Five." case,
a bare-digit case, the embedded-text safety guard (must NOT fire
inside a real sentence), the tightened TTL expiry, and a null-context
guard.

### Follow-up: resolved verse wasn't reflected in the live output (found via live testing)

**Reproduction:** After the fix above, "Hebrews 13" → "Five." correctly
resolved to "Hebrews 13:5" and appeared in the detected-verses list and
as the current verse — but the live output stayed on "Hebrews 13:1"
and never updated.

**Root cause:** `"Hebrews 13"` is a bare chapter mention, which fires a
`go_to_reference` **voice command** — and every voice-command
navigation sets `navigationCooldownUntilRef` for 3 seconds, specifically
to stop a stale, in-flight regex/semantic detection from immediately
hijacking the navigation it just performed. `"Five."` (its own separate
utterance) almost always arrives within that 3-second window, so when
it resolved to "Hebrews 13:5" moments later, the cooldown check
(`useSermonListener.ts`, the `hasRegexVerses` branch) blocked the
auto-lookup/auto-display step — even though this verse was completing
the exact same reference the command had just set, not competing with
a different one.

**Fix:** Before overwriting `activeReferenceContextRef.current`, check
whether the newly-resolved verse's book+chapter matches what it
already was. If so, the cooldown is bypassed for this verse (the
detected-verses list and other state updates were never blocked —
only the live-slide auto-display was). This one code path is shared by
`detectVerses()`, `resolveBareReferences()`, and
`resolveStandaloneNumberContinuation()`, so the fix applies uniformly
to all three.

**Test:** No automated test (no test harness exists for
`useSermonListener.ts`); verified via `tsc --noEmit` and the full
existing sermon-listener/hooks suite with no regressions, plus direct
tracing of the exact interaction against a real transcript.

---

## Bug 19: ~~Audio-features heartbeat went silent during a real delivery gap~~ (FIXED)

### Reproduction
In `src-tauri/src/audio_capture/mod.rs`'s VAD-processing loop:
```rust
if samples.is_empty() {
    std::thread::sleep(...);
    continue;   // <-- heartbeat emit below is skipped entirely
}
// ... emits "audio-features" here, throttled to ~30fps
```
If the OS audio pipeline has a genuine delivery gap (device hiccup,
system-loopback stall) longer than the frontend's 9-second staleness
threshold, this loop never emits a heartbeat during that gap — even
though the capture thread itself is alive and fine.

### Impact
**Medium.** `useSermonListener.ts`'s watchdog (`audioFeatures.isStale(9000)`)
reads a silent heartbeat as "capture died" and force-restarts the whole
session, dropping whatever was mid-transcription — a false positive
caused by the frontend's OWN recovery mechanism reacting to a
mis-instrumented backend signal, not an actual capture failure.
Confirmed via a real session log showing `"Audio signal lost mid-session
— restarting capture"` firing during otherwise-normal operation.

### Fix
Emit the same throttled heartbeat (with zeroed/silent features via
`compute_audio_features(&[])`) even when `samples.is_empty()`, so a
genuine upstream delivery gap no longer silences the "I'm alive" signal
the frontend watchdog depends on.

### Test
No automated test (Rust hardware-capture code, no existing test
harness for this module) — verified by code inspection: the throttled
emit call is identical to the one already used on the non-empty path,
just fed an empty slice, and `compute_audio_features` already has an
explicit `n == 0` branch returning all-zero features.

---

## Bug 20: ~~Nested `<button>` in ScreenPicker~~ (FIXED)

### Reproduction
`src/components/live/ScreenPicker.tsx`: each monitor row was a
`<button>` (line ~237) containing its own "Identify" `<button>`
(line ~299) for the flash-to-identify control. Confirmed via a real
React hydration warning: `"<button> cannot be a descendant of
<button>"`.

### Impact
**Low but real** — invalid HTML that produces a console warning on
every render and can cause unreliable clicks in some browsers/DOM
parsers (nested interactive elements aren't consistently clickable).

### Fix
Converted the outer monitor-row element from `<button>` to a `<div
role="button" tabIndex={0}>` with manual `onKeyDown` handling for
Enter/Space, keeping the inner "Identify" control as a real `<button>`.

### Test
No automated test (no existing test file for this component);
verified by code inspection and a clean `tsc --noEmit`.

---

## Bug 21: ~~Navigation cooldown blocked a same-reference verse continuation~~ (FIXED)

### Reproduction
Found via live testing of Bug 18's fix: "Hebrews 13" → "Five." resolved
correctly to "Hebrews 13:5" (appeared in the detected-verses list and
as the current verse) but the live output silently stayed on
"Hebrews 13:1" and never updated.

### Impact
**Medium.** A bare chapter mention like "Hebrews 13" fires a
`go_to_reference` voice command, which sets a 3-second
`navigationCooldownUntilRef` specifically to stop a stale, in-flight
regex/semantic detection from hijacking the navigation it just
performed. The follow-up "Five." utterance almost always arrives
within that window, so when it resolved to "Hebrews 13:5" moments
later, the same cooldown check blocked the auto-lookup/auto-display
step — even though it was completing the exact reference the command
had just set, not competing with a different one.

### Fix
Bypass the cooldown specifically when the newly-resolved verse's
book+chapter matches the reference context that was already active — a
continuation, not a competing navigation. This is one shared code path
(`useSermonListener.ts`'s `hasRegexVerses` branch), so the fix applies
uniformly whether the verse came from `detectVerses()`,
`resolveBareReferences()`, or `resolveStandaloneNumberContinuation()`.

### Test
No automated test (no test harness exists for `useSermonListener.ts`);
verified via `tsc --noEmit`, the full existing sermon-listener/hooks
suite with no regressions, and direct tracing of the interaction
against a real transcript.

---

## Bug 22: ~~Old, already-shown verses could randomly hijack the live display~~ (FIXED)

### Reproduction
Reported by the user as a recurring real-usage annoyance: "a few [old
verses] hijack after they've already been displayed and new chapters
are currently being displayed." Confirmed directly:
```ts
// detectVerses() re-run on the ever-growing transcript re-matches
// EVERY reference ever mentioned, forever:
detectVerses('In John 3:16 we see the love of God for the world.')
// → ['John 3:16']
detectVerses('John 3:16 ... ' + '(2500+ chars of unrelated later content)')
// → ['John 3:16']   -- still matches, even though it's ancient history

// And even a GENUINE re-mention later is invisible, because
// detectVerses dedupes by reference within a single call:
detectVerses('John 3:16 says ... (lots of filler) ... remember John 3:16 again')
// → only ONE 'John 3:16' entry, at the FIRST (original) position
```

### Impact
**High.** `useSermonListener.ts` calls `detectVerses()`/
`resolveBareReferences()` against `transcriptBufferRef`, which is the
ENTIRE accumulated session transcript and never shrinks mid-session.
A verse mentioned once stays textually present forever, so it
re-matches on every subsequent utterance indefinitely — "silence"
(the 60-second threshold `REACTIVATE_AFTER_SILENCE_MS` uses to decide
whether a re-match is a genuine re-reference worth re-displaying) could
never be legitimately detected this way, since the substring never
actually disappears from what's scanned. Whenever a brand-new verse
was detected in the same tick, the reactivation branch that would
normally refresh an old reference's "last seen" timestamp was skipped
entirely (the two branches are mutually exclusive) — so during any
stretch of the sermon with frequent new quotes, an old reference's
timestamp could go unrefreshed long enough to look "silent," and once
a lull arrived, it would resurface and take over the live display.
Made worse by `detectVerses`' own reference-based dedup: even a truly
fresh, genuine re-mention of that verse couldn't be distinguished from
this stale artifact, since only the original position was ever
reported.

### Fix
Bound the text fed to `detectVerses()`/`resolveBareReferences()` to a
recent window (last `RECENT_VERSE_DETECTION_WINDOW_CHARS` = 1500
characters) instead of the full ever-growing transcript. Sized against
the 60-second silence threshold at typical speaking pace, NOT against
verse/quote length — detection only needs the short
reference-announcing phrase itself, never the quoted verse content.
1500 chars keeps a sensible margin above 60s across the realistic pace
range (~75s for a fast 200wpm speaker up to ~190s for a slow 80wpm
one) without going so large that a reference stays "in the window" —
and so still refreshing its silence timer — for minutes after it was
actually said, which would defeat the point (an initial pass used
2500, which at typical pace is 165-190s — nearly 3x the threshold it
was meant to complement).
Old mentions now genuinely scroll out of what's scanned, so "silent"
and "re-mentioned" become meaningful again — confirmed a verse
correctly disappears once it scrolls out, and a genuine later
re-mention is freshly detected instead of being swallowed by the
dedup. Since the detected verses' `startIndex`/`endIndex` are also fed
to the semantic detector's `excludedRanges` (computed against the
un-windowed `cleanText`), the window's offset is added back onto those
positions immediately after detection so downstream consumers still
see correct absolute positions.

### Test
No automated test (no test harness exists for `useSermonListener.ts`);
verified via `tsc --noEmit`, the full existing suite with no
regressions, and a direct probe against the real `detectVerses()`
confirming both halves of the fix (old references fall silent; genuine
re-mentions are detected).

---

## Bug 23: ~~Reactivation only refreshed ONE still-matching verse's timestamp per tick~~ (FIXED)

### Reproduction
Reported directly by observation of the live app, after Bug 22's fix
was already in place: "it looks like it still switches to some of the
earlier detected verses away from the current verse from time to
time — you can literally see the current verse which is highlighted
changing to other confirmed verses in the list of detected verses
pills in the bible verse panel even." Since this persisted after the
transcript-windowing fix, it has a distinct root cause.

### Impact
**High.** A verse that is still being actively mentioned every tick
can nonetheless be misjudged as "silent for 60+ seconds" and get
force-resurfaced, hijacking both the live display and the highlighted
"current verse" pill away from whatever is actually being preached at
that moment. Affects both the regex reactivation path and the
semantic reactivation path identically.

### Root cause
`processTranscript` has two structurally-identical reactivation
branches — one for regex matches (`reActivatedRefs`) and one for
semantic matches (`semanticReActivatedRefs`) — that run whenever a
previously-detected verse re-matches the transcript. Each branch only
ever inspected and refreshed `lastMatchTimeRef`/`reactivationCooldownRef`
for a single entry, `[0]`, since only `[0]` is ever chosen for actual
re-display (to avoid multiple simultaneous reactivations in one tick).

But every entry in `reActivatedRefs`/`semanticReActivatedRefs` — not
just `[0]` — is a reference that matched the transcript *this tick*,
meaning it's still being actively mentioned. And critically, both
reactivation branches are skipped entirely whenever `hasRegexVerses`
fires in the same tick (a brand-new verse takes priority). So a
reference that never happens to land in the `[0]` slot — e.g. because
an earlier reference in the transcript keeps winning that position —
could go many real ticks without its timestamp ever being touched,
even though it kept matching every single time. Eventually its
`lastMatchTimeRef` entry looks old enough to exceed
`REACTIVATE_AFTER_SILENCE_MS` (60s), and the next time it happens to
land in `[0]`, the code concludes it was "genuinely silent and has now
returned" and force-resurfaces it — even though it was never actually
silent.

### Fix
In both branches, loop over *every* entry in
`reActivatedRefs`/`semanticReActivatedRefs` to refresh
`reactivationCooldownRef` and `lastMatchTimeRef`, not just `[0]`.
Ordering matters: the `hasBeenSilent` check for `[0]` is computed
first (reading the *old* `lastMatchTimeRef` value), and only after
that is the bulk refresh applied across all entries — otherwise the
bulk refresh would corrupt `[0]`'s own silence check by writing `now`
before it's read. The redundant single-entry `.set()` calls that
previously lived inside the `if (hasBeenSilent)`/`else` sub-branches
were removed since the bulk loop now covers them.

### Test
No automated test (no test harness exists for `useSermonListener.ts`);
verified via `tsc --noEmit` (clean) and the full existing suite
(615 tests, no regressions). The underlying pure functions this hook
composes (`detectVerses`, `resolveBareReferences`,
`resolveStandaloneNumberContinuation`) are unchanged, so no new probes
were needed — the bug was purely in the hook's own bookkeeping.

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
| 9 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `"Genesis 50:999" should be rejected (Genesis 50 only has 26 verses)` |
| 10 | `src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts` | `"pause listening" is blocked by the intent filter (known bug)` |
| 11 | `src/services/sermon-listener/__tests__/voiceCommandDetection.test.ts` | `rejects versions not in bibleVersionObjects (e.g. ESV)` |
| 13 | `src/hooks/__tests__/useKeyboardShortcuts.test.ts` | `useVerseNavigationShortcuts` block (8 tests covering N/P, ←/→, modifiers, focus guard, enabled flag, preventDefault) |
| 14 | `voiceCommandDetection.bugs.test.ts` / `verseDetection.bugs.test.ts` / `referenceContext.bugs.test.ts` | "versus" resolves identically to "verse" (per-file tests) |
| 15 | `src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts` | `"Psalm hundred and forty seven"` / `"verse twenty five"` compound-number tests |
| 16 | `src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts` | `"Psalm chapter twenty five"` does not split into chapter 20 verse 5; `"John chapter three sixteen"` still splits |
| 17 | `src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts` | `"verse thirty"` / `"verse forty seven"` resolve correctly (previously unsupported above 20) |
| 18 | `src/services/sermon-listener/__tests__/referenceContext.bugs.test.ts` | `resolveStandaloneNumberContinuation` block (bare-number resolution, embedded-text guard, tightened TTL, null-context guard) |

All tests that assert fixed behavior **pass** (regression guards).
All tests that document current bugs **pass** (pin the buggy behavior
so a future fix requires intentional test updates).

---

## Also Noted (Non-Critical, Historical)

- **False command intent** (`voiceCommandDetection.ts`): `COMMAND_KEYWORDS` includes generic phrases like `"use the"` that appear in normal speech. This triggers unnecessary command parsing but the downstream pattern matching correctly rejects them, so no wrong commands are returned. Impact: minor performance overhead and console noise. This is documented as a real behavior but no fix is required.
- **Bare chapter mention briefly flashes verse 1** (`useSermonListener.ts` / `voiceCommandDetection.ts`): when a book+chapter is announced with the verse number arriving in a separate later utterance (the common case with real-time ASR), the live slide displays the bare chapter's default verse 1 immediately, then self-corrects once the verse-specific utterance is detected. A fix was scoped (hold the display briefly to let a same-book/chapter verse-specific command preempt it) but explicitly **not implemented** — the user chose to keep instant display over adding a delay to every bare chapter-only reference (including deliberate ones, e.g. "Psalm 23" with no verse intended), accepting the occasional wrong-verse flash as the cost. Do not re-propose this fix without re-confirming that trade-off.
