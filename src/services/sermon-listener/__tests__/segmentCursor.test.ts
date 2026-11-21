import { describe, it, expect } from 'vitest'
import { SegmentCursor } from '../segmentCursor'

const seg = (id: string) => ({ id })

describe('segment cursor', () => {
    it('hands each segment over once, in order', () => {
        const c = new SegmentCursor()
        expect(c.take([seg('a')]).fresh.map((s) => s.id)).toEqual(['a'])
        expect(c.take([seg('a'), seg('b'), seg('c')]).fresh.map((s) => s.id)).toEqual(['b', 'c'])
        expect(c.take([seg('a'), seg('b'), seg('c')]).fresh).toEqual([])
    })

    it('segments marked seen are not handed over', () => {
        const c = new SegmentCursor()
        c.markSeen([seg('restored-1'), seg('restored-2')])
        expect(c.take([seg('restored-1'), seg('restored-2'), seg('new')]).fresh.map((s) => s.id)).toEqual(['new'])
    })

    // Counting took a shorter list for a new session. Cleared while stopped,
    // the list grew back past the old count before it was looked at, and its
    // first segments were skipped.
    it('after a clear, everything in the new transcript is new — however long it has grown', () => {
        const c = new SegmentCursor()
        c.take([seg('a'), seg('b'), seg('c')])
        const { fresh, cleared } = c.take([seg('x'), seg('y'), seg('z'), seg('w')])
        expect(cleared).toBe(true)
        expect(fresh.map((s) => s.id)).toEqual(['x', 'y', 'z', 'w'])
    })

    it('an emptied transcript is a clear', () => {
        const c = new SegmentCursor()
        c.take([seg('a')])
        expect(c.take([])).toEqual({ fresh: [], cleared: true })
        expect(c.take([seg('b')])).toEqual({ fresh: [seg('b')], cleared: false })
    })
})
