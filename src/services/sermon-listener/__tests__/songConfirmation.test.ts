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

    describe('window cadence', () => {
        // Desktop Whisper finalizes a segment every several seconds, and each
        // finalized segment is one window here. A fixed 3s half-life put the
        // accumulation ceiling (c / (1 - decay)) below the emit threshold at
        // that cadence, so a song sung near-verbatim for minutes on end never
        // confirmed — the failure that left the wrong song on the projector
        // through a whole worship set.
        it('confirms a strong match at desktop-Whisper segment cadence', () => {
            const t = new SongConfirmationTracker()
            let confirmed: string | null = null
            let words = 100
            for (let i = 0; i < 6 && !confirmed; i++) {
                words += 12
                confirmed = t.update(i * 8000, { songId: 'a', confidence: 0.95, windowId: words })
            }
            expect(confirmed).toBe('a')
        })

        it('confirms a corroboration-level match at that cadence too, just slower', () => {
            const t = new SongConfirmationTracker()
            let confirmed: string | null = null
            let windows = 0
            let words = 100
            for (let i = 0; i < 10 && !confirmed; i++) {
                words += 12
                windows++
                confirmed = t.update(i * 8000, { songId: 'a', confidence: 0.65, windowId: words })
            }
            expect(confirmed).toBe('a')
            expect(windows).toBeGreaterThan(2)
        })

        it('still forgets a lone match when the singing moves on', () => {
            const t = new SongConfirmationTracker()
            // Establish an 8s cadence with a few no-match windows.
            for (let i = 0; i < 4; i++) t.update(i * 8000, null)
            t.update(32_000, { songId: 'a', confidence: 0.9, windowId: 100 })
            // Nothing corroborates it over the next couple of minutes of
            // windows. The adapted half-life makes this take longer than the
            // old fixed 3s one did, but a hypothesis nothing supports still has
            // to end at zero — and well before then it is too small to combine
            // with a later coincidental match into a confirmation.
            for (let i = 1; i <= 6; i++) t.update(32_000 + i * 8000, null)
            expect(t.scoreFor('a')).toBeLessThan(0.25)
            for (let i = 7; i <= 14; i++) t.update(32_000 + i * 8000, null)
            expect(t.scoreFor('a')).toBe(0)
        })
    })

    describe('window independence (defeats the sliding-buffer false positive)', () => {
        it('ignores a second hit from an overlapping (barely-advanced) window', () => {
            const t = new SongConfirmationTracker()
            expect(t.update(0, { songId: 'a', confidence: 0.9, windowId: 100 })).toBeNull()
            // Same coincidental phrase re-scored on the next transcript segment:
            // the 14-word window moved only 2 words → NOT independent evidence.
            const r = t.update(500, { songId: 'a', confidence: 0.9, windowId: 102 })
            expect(r).toBeNull()
            // The non-independent hit was not accumulated (only decay applied).
            expect(t.scoreFor('a')).toBeLessThan(0.9)
        })

        it('confirms when the window has genuinely advanced between hits', () => {
            const t = new SongConfirmationTracker()
            expect(t.update(0, { songId: 'a', confidence: 0.9, windowId: 100 })).toBeNull()
            // 10 new words later — a genuinely different window that also matches.
            expect(t.update(1000, { songId: 'a', confidence: 0.9, windowId: 110 })).toBe('a')
        })

        it('never confirms from a phrase stuck in the window across many ticks', () => {
            const t = new SongConfirmationTracker()
            let res: string | null = null
            // Window advances by <minWindowAdvance total (Whisper re-emitting the
            // same segment) — the classic false positive; must never confirm.
            for (let i = 0; i < 6; i++) {
                res = t.update(i * 300, { songId: 'a', confidence: 0.95, windowId: 100 + i })
            }
            expect(res).toBeNull()
        })
    })
})
