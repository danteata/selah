import { describe, it, expect } from 'vitest'
import { SongConfirmationTracker } from '../songConfirmation'

describe('SongConfirmationTracker', () => {
    it('does not confirm a single near-exact hit alone', () => {
        const t = new SongConfirmationTracker()
        const result = t.update(0, { songId: 'a', confidence: 0.95 })
        expect(result).toBeNull()
        expect(t.scoreFor('a')).toBeCloseTo(0.95)
    })

    it('confirms after two strong hits close together', () => {
        const t = new SongConfirmationTracker()
        expect(t.update(0, { songId: 'a', confidence: 0.9 })).toBeNull()
        // 1.5s later, half-life 3000ms → decay factor sqrt(0.5) ≈ 0.707
        const result = t.update(1500, { songId: 'a', confidence: 0.9 })
        expect(result).toBe('a')
    })

    it('requires a third hit when evidence is only moderate (corroboration-level)', () => {
        const t = new SongConfirmationTracker()
        expect(t.update(0, { songId: 'a', confidence: 0.65 })).toBeNull()
        expect(t.update(1500, { songId: 'a', confidence: 0.65 })).toBeNull() // ~1.11, below 1.3
        const third = t.update(3000, { songId: 'a', confidence: 0.65 })
        expect(third).toBe('a')
    })

    it('decays through a no-match window instead of resetting to zero', () => {
        const t = new SongConfirmationTracker()
        t.update(0, { songId: 'a', confidence: 0.9 })
        // A window with no evidence at all (no match, or skipped by the
        // singing pre-gate) — must NOT wipe the hypothesis.
        t.update(1000, null)
        expect(t.scoreFor('a')).toBeGreaterThan(0)
        expect(t.scoreFor('a')).toBeLessThan(0.9) // decayed, not reset
        // The lingering partial credit plus a second real hit still confirms.
        const result = t.update(1500, { songId: 'a', confidence: 0.9 })
        expect(result).toBe('a')
    })

    it('tracks multiple candidate songs independently — a one-off rival match does not discard progress', () => {
        const t = new SongConfirmationTracker()
        t.update(0, { songId: 'a', confidence: 0.7 })
        // A different song matches once in between — should not erase A's progress
        // (a flat "last songId wins" counter would have discarded it entirely).
        t.update(1000, { songId: 'b', confidence: 0.6 })
        expect(t.scoreFor('a')).toBeGreaterThan(0)
        expect(t.update(2000, { songId: 'a', confidence: 0.7 })).toBeNull() // still accumulating
        const result = t.update(2500, { songId: 'a', confidence: 0.7 })
        expect(result).toBe('a') // the lingering credit from the first hit still counted
    })

    it('eventually forgets a hypothesis that never gets corroborated', () => {
        const t = new SongConfirmationTracker()
        t.update(0, { songId: 'a', confidence: 0.6 })
        // Many half-lives later, with no further evidence.
        t.update(60_000, null)
        expect(t.scoreFor('a')).toBe(0)
    })

    it('resets all hypotheses on demand', () => {
        const t = new SongConfirmationTracker()
        t.update(0, { songId: 'a', confidence: 0.7 })
        t.reset()
        expect(t.scoreFor('a')).toBe(0)
    })

    it('clears the winning hypothesis once confirmed, starting the next cycle fresh', () => {
        const t = new SongConfirmationTracker()
        t.update(0, { songId: 'a', confidence: 0.9 })
        const confirmed = t.update(500, { songId: 'a', confidence: 0.9 })
        expect(confirmed).toBe('a')
        expect(t.scoreFor('a')).toBe(0)
    })

    it('respects a custom config', () => {
        const t = new SongConfirmationTracker({ emitThreshold: 0.5 })
        const result = t.update(0, { songId: 'a', confidence: 0.6 })
        expect(result).toBe('a')
    })
})
