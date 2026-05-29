# Bugs Exposed by Rigorous Testing

> This document lists **real implementation bugs** found by writing aggressive, edge-case tests designed to break the code — not tests written to conform to the implementation.

## Summary: 8 Confirmed Bugs

| # | Component | Bug | Severity | File |
|---|-----------|-----|----------|------|
| 1 | `useUserRole` | `isLoading` flips to `false` while Convex query is still resolving | Medium | `src/hooks/useUserRole.ts:85` |
| 2 | `useUserRole` | Stale cached session shown when server returns `null` (deleted user) | **High** | `src/hooks/useUserRole.ts:78` |
| 3 | `appStore` | `undo()` pushes full state objects into `futureStates`, causing nested state/memory leak | Medium | `src/store/appStore.ts:809-822` |
| 4 | `appStore` | `liveOutputSlidesId` is not captured in `pastStates`, so undo leaves live output inconsistent | Medium | `src/store/appStore.ts:809-822` |
| 5 | `useSlideCreation` | `duplicateSlide` does shallow copy — mutating duplicate corrupts original | Medium | `src/hooks/useSlideCreation.ts:222` |
| 6 | `voiceCommandDetection` | Written-number parsing uses substring match: "tool" → verse 2, "tone" → verse 1 | Low | `src/services/sermon-listener/voiceCommandDetection.ts:273` |
| 7 | `verseDetection` | Regex matches time expressions as verses: "John 3:16 PM" → John 3:16 | Low | `src/services/sermon-listener/verseDetection.ts:270-273` |
| 8 | `verseDetection` | No verse-number bounds checking: "John 21:1000" accepted | Medium | `src/services/sermon-listener/verseDetection.ts:549-551` |

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

## Bug 3: Undo/redo stores full state snapshots → nested memory leak

### Reproduction
```ts
undo: () => {
    set((state) => {
        ...
        return {
            ...state,
            ...previousState,
            pastStates: newPastStates,
            futureStates: [state, ...state.futureStates]   // ← BUG
        }
    })
}
```

`state` is the **entire** Zustand store object, which includes `pastStates` and `futureStates` arrays. Pushing `state` into `futureStates` nests those arrays inside the snapshot. After several undo/redo cycles, the state tree becomes deeply nested:

```
futureStates[0].pastStates[0].futureStates[0].pastStates[0]...
```

### Impact
Memory leak. Each undo stores an increasingly large object. Over a long editing session, this could consume significant memory.

### Fix
Store minimal diffs instead of full state objects, or at least strip `pastStates`/`futureStates` before pushing:
```ts
futureStates: [{ activeSlides: state.activeSlides }, ...state.futureStates]
```

---

## Bug 4: `liveOutputSlidesId` not restored on undo

### Reproduction
```ts
// pastStates only stores { activeSlides: state.activeSlides }
undo: () => {
    const previousState = state.pastStates[state.pastStates.length - 1]
    return { ...state, ...previousState, ... }
    // liveOutputSlidesId is NOT in previousState → stays at CURRENT value
}
```

1. Add slide A → `activeSlides = [A]`, `liveOutputSlidesId = ['A']`
2. Add slide B → `activeSlides = [A,B]`, `liveOutputSlidesId = ['A','B']`
3. Undo → `activeSlides` reverts to `[A]`, but `liveOutputSlidesId` stays `['A','B']`

### Impact
Live output references a slide (B) that was undone out of `activeSlides`. The output panel may show a ghost slide or throw when trying to render it.

### Fix
Capture `liveOutputSlidesId` in `pastStates` alongside `activeSlides`.

---

## Bug 5: `duplicateSlide` shallow-copies arrays/objects

### Reproduction
```ts
const duplicateSlide = (slideToDuplicate?: Slide): Slide | null => {
    if (!slideToDuplicate) return null
    const tempSlide = { ...slideToDuplicate }   // ← SHALLOW copy
    delete tempSlide._id
    tempSlide.id = generateObjectId()
    return tempSlide
}
```

`{ ...slide }` copies top-level properties by value, but nested arrays (`contents`) and objects (`slideStyle`, `data`) are copied **by reference**.

1. Duplicate slide X
2. Edit duplicate's `contents.push("new line")`
3. Original slide X now also has "new line"

### Impact
Data corruption. Editing a duplicated slide silently modifies the original.

### Fix
Use `structuredClone` or a deep-clone utility:
```ts
const tempSlide = structuredClone(slideToDuplicate)
```

---

## Bug 6: Written-number parsing matches substrings

### Reproduction
```ts
for (const [word, num] of Object.entries(WRITTEN_NUMBERS)) {
    if (lower.includes(word)) return num   // ← substring match!
}
```

- Input: `"verse tool"` → `"tool".includes("too")` is `true` → parsed as **verse 2**
- Input: `"verse tone"` → `"tone".includes("one")` is `true` → parsed as **verse 1**

### Impact
False verse detection when Whisper mishears words that contain written-number substrings.

### Fix
Use word-boundary regex instead of substring `includes`:
```ts
if (new RegExp(`\\b${word}\\b`).test(lower)) return num
```

---

## Bug 7: Regex matches time expressions as Bible verses

### Reproduction
```ts
detectVerses('The meeting is at John 3:16 PM')
// Returns: [{ book: 'John', chapter: 3, verseStart: 16 }]
```

The `VERSE_PATTERN` regex matches "John 3:16" without checking if it's followed by "AM" or "PM", causing legitimate time expressions to be misidentified as Bible references.

### Impact
False verse detection in transcripts containing times (e.g., scheduling announcements, event planning).

### Fix
Add a negative lookahead to reject matches immediately followed by "AM" or "PM":
```ts
const VERSE_PATTERN = new RegExp(
    `\\b(${BOOK_PATTERN})\\s+${CHAPTER_VERSE_PATTERN}\\b(?!\\s*(?:AM|PM|a\.m\.|p\.m\.))`,
    'gi'
)
```

---

## Bug 8: No verse-number bounds checking

### Reproduction
```ts
detectVerses('John 21:1000')
// Returns: [{ book: 'John', chapter: 21, verseStart: 1000 }]
```

The code sanity-checks chapter numbers against `BOOK_MAX_CHAPTER` but never checks if the verse number is within the valid range for that chapter. John 21 only has 25 verses.

### Impact
Impossible verse references can be stored and displayed, causing lookup failures when the app tries to fetch the actual scripture text.

### Fix
Add a per-chapter verse count map or a reasonable upper bound (e.g., 176, the maximum verses in any single chapter — Psalm 119):
```ts
if (verseStart > 176) continue
```

---

## Test Files That Exposed These Bugs

| Bug | Test File | Test Name |
|-----|-----------|-----------|
| 1 | `src/hooks/__tests__/useUserRole.bugs.test.ts` | `[BUG 1] isLoading should remain true while Convex user is undefined` |
| 2 | `src/hooks/__tests__/useUserRole.bugs.test.ts` | `[BUG 2] should not fall back to cached session when server returns null` |
| 3 | `src/store/__tests__/appStore.bugs.test.ts` | `[BUG 3] futureStates should not contain nested pastStates/futureStates` |
| 4 | `src/store/__tests__/appStore.bugs.test.ts` | `[BUG 4] undo should restore liveOutputSlidesId to its past value` |
| 5 | `src/hooks/__tests__/useSlideCreation.bugs.test.ts` | `[BUG 5] duplicateSlide should deep-copy slide contents and slideStyle` |
| 6 | `src/services/sermon-listener/__tests__/voiceCommandDetection.bugs.test.ts` | `[BUG 7] "verse tool" should NOT parse as verse 2` |
| 7 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `[BUG 11] "John 3:16 PM" should NOT match John 3:16 (time, not verse)` |
| 8 | `src/services/sermon-listener/__tests__/verseDetection.bugs.test.ts` | `[BUG 14] "John 21:1000" should be rejected (John only has 25 verses in ch 21)` |

All 8 tests **fail** against the current implementation, confirming each bug is real.

---

## Also Noted (Non-Critical)

- **False command intent** (`voiceCommandDetection.ts`): `COMMAND_KEYWORDS` includes generic phrases like `"use the"` that appear in normal speech. This triggers unnecessary command parsing but the downstream pattern matching correctly rejects them, so no wrong commands are returned. Impact: minor performance overhead and console noise.
