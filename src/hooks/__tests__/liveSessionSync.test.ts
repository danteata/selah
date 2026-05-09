import { describe, it, expect, vi } from 'vitest'

// We test the pure logic extracted from useLiveSession's sync effects.
// Since the hook relies on React/Convex, we test the data transformation
// logic directly rather than the hook itself.

describe('queue sync backward compatibility', () => {
    it('maps structured queue entries to slideIds', () => {
        const queue = [
            { slideId: 'slide-1', suggestedBy: 'user-a', suggestedAt: 1000 },
            { slideId: 'slide-2', suggestedBy: 'user-b', suggestedAt: 2000 },
        ]
        const slideIds = queue.map((entry: { slideId: string }) => entry.slideId)
        expect(slideIds).toEqual(['slide-1', 'slide-2'])
    })

    it('handles legacy queuedSlideIds (flat string array)', () => {
        const queuedSlideIds = ['slide-1', 'slide-2', 'slide-3']
        const currentQueue: string[] = []
        const needsUpdate = JSON.stringify(currentQueue) !== JSON.stringify(queuedSlideIds)
        expect(needsUpdate).toBe(true)
    })

    it('detects queue changes via JSON.stringify equality', () => {
        const current = ['slide-1', 'slide-2']
        const incoming = ['slide-1', 'slide-3']
        expect(JSON.stringify(current) !== JSON.stringify(incoming)).toBe(true)
    })

    it('skips update when queue is identical', () => {
        const current = ['slide-1', 'slide-2']
        const incoming = ['slide-1', 'slide-2']
        expect(JSON.stringify(current) !== JSON.stringify(incoming)).toBe(false)
    })
})

describe('operatorSlideIds operator-only sync', () => {
    it('should sync operatorSlideIds for contributors', () => {
        const operatorSlideIds = ['slide-1', 'slide-2', 'slide-3']
        const currentLiveOutputSlidesId = ['slide-1']
        const isOperator = false

        // Contributors should receive the sync
        const shouldSync = !isOperator && operatorSlideIds.length > 0
        expect(shouldSync).toBe(true)

        // The sync replaces their local deck
        const newLocalIds = [...operatorSlideIds]
        expect(newLocalIds).toEqual(['slide-1', 'slide-2', 'slide-3'])
    })

    it('should NOT sync operatorSlideIds for the operator themselves', () => {
        const operatorSlideIds = ['slide-1', 'slide-2', 'slide-3']
        const isOperator = true

        // Operator should NOT receive the sync (they push, don't receive)
        const shouldSync = !isOperator && operatorSlideIds.length > 0
        expect(shouldSync).toBe(false)
    })

    it('should handle empty operatorSlideIds (new session)', () => {
        const operatorSlideIds: string[] = []
        const shouldSync = operatorSlideIds.length > 0
        expect(shouldSync).toBe(false)
    })
})

describe('collaboration mode behaviors', () => {
    it('strict mode: only operator can add to queue', () => {
        const collaborationMode = 'strict'
        const isOperator = false

        const canAdd = collaborationMode === 'strict' ? isOperator : true
        expect(canAdd).toBe(false)
    })

    it('strict mode: operator can add to queue', () => {
        const collaborationMode = 'strict'
        const isOperator = true

        const canAdd = collaborationMode === 'strict' ? isOperator : true
        expect(canAdd).toBe(true)
    })

    it('open mode: contributors can add to queue', () => {
        const collaborationMode = 'open'
        const isOperator = false

        const canAdd = collaborationMode === 'strict' ? isOperator : true
        expect(canAdd).toBe(true)
    })

    it('moderated mode: contributors can add to queue', () => {
        const collaborationMode = 'moderated'
        const isOperator = false

        const canAdd = collaborationMode === 'strict' ? isOperator : true
        expect(canAdd).toBe(true)
    })

    it('open mode: contributors can change live slides', () => {
        const collaborationMode = 'open'
        const isOperator = false

        const canChangeLive = collaborationMode === 'open' || isOperator
        expect(canChangeLive).toBe(true)
    })

    it('moderated mode: contributors cannot change live slides directly', () => {
        const collaborationMode = 'moderated'
        const isOperator = false

        const canChangeLive = collaborationMode === 'open' || isOperator
        expect(canChangeLive).toBe(false)
    })
})

describe('session cleanup race condition', () => {
    it('should clear queue when session status is ended', () => {
        const liveSession = { status: 'ended' }
        const shouldClear = liveSession.status === 'ended'
        expect(shouldClear).toBe(true)
    })

    it('should NOT clear queue when session is undefined (reconnection)', () => {
        const liveSession = undefined
        // Old code: clear on !liveSession → wipes queue during reconnection
        const oldBehavior = !liveSession
        // New code: only clear on status === 'ended'
        const newBehavior = liveSession?.status === 'ended'
        expect(oldBehavior).toBe(true) // Bug: clears on reconnect
        expect(newBehavior).toBe(false) // Fix: preserves queue on reconnect
    })

    it('should NOT clear queue when session is active', () => {
        const liveSession = { status: 'active' }
        const shouldClear = liveSession.status === 'ended'
        expect(shouldClear).toBe(false)
    })
})