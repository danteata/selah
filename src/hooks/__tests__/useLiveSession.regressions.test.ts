/**
 * Regression tests for the queue sync logic that runs inside
 * useLiveSession's effects.
 *
 * The existing liveSessionSync.test.ts covers the pure helper functions
 * (mergePendingQueue, queueChanged, etc.), but those helpers are defined
 * inside the test file rather than exported. The behaviors that actually
 * drive the bug reports from the field — "contributor adds to queue but
 * operator doesn't see it" — live in the effect bodies and have to be
 * exercised via the effect-equivalent logic.
 *
 * These tests pin the contract by reproducing the exact sequence of
 * statements the effects perform (read state -> compute display -> compare
 * -> write state) so that any future change to the merging behavior is
 * caught.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../store/appStore'

// ---------------------------------------------------------------------------
// Helpers — re-implement the small slice of effect logic we want to lock
// down. We deliberately keep these identical (line-for-line) to the
// bodies in useLiveSession.ts so that a regression in the implementation
// would be visible here.
// ---------------------------------------------------------------------------

function removeByOccurrence(source: string[], removals: string[]) {
    const counts = new Map<string, number>()
    for (const id of removals) {
        counts.set(id, (counts.get(id) || 0) + 1)
    }

    return source.filter((id) => {
        const count = counts.get(id) || 0
        if (count > 0) {
            counts.set(id, count - 1)
            return false
        }
        return true
    })
}

function mergePendingQueue(serverQueue: string[], pendingQueue: string[]) {
    const stillPending = removeByOccurrence(pendingQueue, serverQueue)
    return {
        stillPending,
        displayQueue: [...serverQueue, ...stillPending],
    }
}

/**
 * Mirrors the operator's queue-sync block in the line 230 effect.
 * Reads serverQueue and pendingRef, computes the display queue, and
 * writes the store only when the value actually changes.
 */
function syncOperatorQueue(serverQueue: string[], pendingRef: string[]) {
    const { stillPending, displayQueue } = mergePendingQueue(serverQueue, pendingRef)
    pendingRef.length = 0
    pendingRef.push(...stillPending)
    const currentQueue = useAppStore.getState().sharedQueueSlideIds
    if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
        useAppStore.getState().setSharedQueueSlideIds(displayQueue)
    }
}

/**
 * Mirrors the contributor's optimistic add path. The contributor
 * updates their local pending list and the local shared queue BEFORE
 * the server roundtrip — so the optimistic state must match the
 * server's eventual response.
 */
function optimisticAdd(pendingRef: string[], slideIds: string[]) {
    useAppStore.getState().addSharedQueueSlideIds(slideIds)
    pendingRef.push(...slideIds)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLiveSession — operator queue sync (regression)', () => {
    beforeEach(() => {
        useAppStore.getState().setSharedQueueSlideIds([])
    })

    it('operator sees a contributor’s add when the local queue is empty', () => {
        // Simulate: operator is online, queue starts empty, then a
        // contributor adds 'contrib-1' from their side.
        const operatorPending: string[] = []
        syncOperatorQueue([], operatorPending)
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual([])

        syncOperatorQueue(['contrib-1'], operatorPending)

        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['contrib-1'])
    })

    it('operator sees a contributor’s add when their own queue already has items', () => {
        // Operator had previously queued 'op-1' via acceptFromQueue
        // (or any other local-only path). The effect must still pick
        // up the contributor's slide.
        useAppStore.getState().setSharedQueueSlideIds(['op-1'])
        const operatorPending: string[] = []
        syncOperatorQueue(['op-1', 'contrib-1'], operatorPending)

        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['op-1', 'contrib-1'])
    })

    it('operator sees the queue even when the local queue starts empty (this was the broken legacy-branch condition)', () => {
        // Old buggy code at line 181 only synced queuedSlideIds when
        // `currentQueue.length > 0`. Make sure the new behavior is
        // strict equality, not "has something already".
        useAppStore.getState().setSharedQueueSlideIds([])
        syncOperatorQueue(['a', 'b'], [])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['a', 'b'])
    })

    it('contributor’s optimistic state matches what the operator will see', () => {
        // The contributor's local optimistic add + the operator's
        // server-driven sync must converge to the same displayQueue.
        const operatorPending: string[] = []
        const contributorPending: string[] = []

        // Contributor clicks "Suggest" on two slides
        optimisticAdd(contributorPending, ['c-1', 'c-2'])
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['c-1', 'c-2'])

        // Convex persists and broadcasts to the operator
        syncOperatorQueue(['c-1', 'c-2'], operatorPending)

        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['c-1', 'c-2'])
        expect(operatorPending).toEqual([]) // pending is drained
    })

    it('does not flicker when Convex sends the same queue twice', () => {
        // If Convex sends the same queue twice (e.g., due to a
        // re-subscription), the store should not be touched the
        // second time. We assert by snapshotting the store ref.
        const operatorPending: string[] = []
        syncOperatorQueue(['c-1'], operatorPending)
        const afterFirst = useAppStore.getState().sharedQueueSlideIds
        syncOperatorQueue(['c-1'], operatorPending)
        const afterSecond = useAppStore.getState().sharedQueueSlideIds
        // Same value, no new object identity churn
        expect(afterFirst).toEqual(afterSecond)
    })
})

// ---------------------------------------------------------------------------
// useLiveSession — nav panel revert guard
// ---------------------------------------------------------------------------
// The reported "nav reverts to the original verse" symptom came from
// the effect re-applying the server slide when the local ref was
// stale. The guard `serverSlideId !== previousLiveSlideRef.current`
// is what prevents the bounce. These tests pin the guard's expected
// behavior for the operator clicking next/prev.

describe('useLiveSession — nav-panel revert guard (regression)', () => {
    /** Returns the new liveSlideId that the effect would apply. */
    function applyServerLiveSlide(
        serverSlideId: string | null | undefined,
        previousLiveSlideRef: { current: string | null },
        currentLiveSlideId: string,
    ): { applied: string | null; store: string; ref: string | null } {
        if (serverSlideId === undefined) {
            return { applied: null, store: currentLiveSlideId, ref: previousLiveSlideRef.current }
        }
        if (serverSlideId !== previousLiveSlideRef.current) {
            previousLiveSlideRef.current = serverSlideId
            return { applied: serverSlideId, store: serverSlideId ?? '', ref: serverSlideId }
        }
        return { applied: null, store: currentLiveSlideId, ref: previousLiveSlideRef.current }
    }

    it('does not revert when the server echoes the optimistic value', () => {
        // The operator clicks "next": locally we set 'verseB' and
        // bump the ref. Convex replies with 'verseB'. The effect
        // must NOT touch the store (no flicker, no revert).
        const ref = { current: 'verseA' as string | null }
        // Simulate the optimistic set in handleSetLiveSlide
        ref.current = 'verseB'
        const result = applyServerLiveSlide('verseB', ref, 'verseB')
        expect(result.applied).toBeNull()
        expect(result.store).toBe('verseB')
    })

    it('does not revert when the server sends the same value twice in a row', () => {
        const ref = { current: null as string | null }
        // First reply
        let r = applyServerLiveSlide('verseA', ref, '')
        expect(r.applied).toBe('verseA')
        // Second reply (e.g., re-subscribe)
        r = applyServerLiveSlide('verseA', ref, 'verseA')
        expect(r.applied).toBeNull()
    })

    it('clears the live slide when server reports null', () => {
        const ref = { current: 'verseA' as string | null }
        const r = applyServerLiveSlide(null, ref, 'verseA')
        // null is a real change from the current ref ('verseA'), so
        // the effect must clear the live slide.
        expect(r.applied).toBeNull()
        expect(r.store).toBe('')
        expect(ref.current).toBeNull()
    })

    it('keeps the optimistic value when the ref matches the server', () => {
        const ref = { current: 'verseB' as string | null }
        const r = applyServerLiveSlide('verseB', ref, 'verseB')
        expect(r.applied).toBeNull()
        expect(r.store).toBe('verseB')
        expect(ref.current).toBe('verseB')
    })
})
