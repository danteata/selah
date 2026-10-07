import { describe, it, expect } from 'vitest'
import { TranscriptLagEstimator, leadDelayMs, LEAD_SAFETY_MS } from '../songLead'
import type { TrackerUpdate } from '../songTracker'

const tracking = (over: Partial<TrackerUpdate> = {}): TrackerUpdate => ({
    phase: 'tracking',
    singer: { stepIndex: 0, lineIndex: 1, sectionId: 'v1' },
    displaySectionId: 'v1',
    displayStepIndex: 0,
    advanced: false,
    confidence: 1,
    reason: 'tracking',
    linesRemaining: 2,
    estimatedLineMs: 4000,
    ...over,
})

describe('TranscriptLagEstimator', () => {
    it('measures how far behind the audio a segment arrived', () => {
        const lag = new TranscriptLagEstimator()
        lag.start(10_000)
        // Ended 5 s into the session, arrived 800 ms later.
        lag.observe(10_000 + 5000 + 800, 5000)
        expect(lag.lagMs).toBe(800)
    })

    it('pulls a late start anchor back rather than reporting negative lag', () => {
        const lag = new TranscriptLagEstimator()
        lag.start(10_000)
        // Arrived "before" its own audio by the anchor: the anchor was late.
        lag.observe(10_000 + 4000, 5000)
        expect(lag.lagMs).toBe(0)
        // Anchor now 9000 (the bound above): a segment ending at 7 s arriving
        // at 19 s is 3 s behind.
        lag.observe(10_000 + 9000, 7000)
        expect(lag.lagMs).toBe(3000)
    })
})

describe('leadDelayMs', () => {
    it('counts down what is left of the section, less the lag and the lead', () => {
        expect(leadDelayMs(tracking(), 800, 3)).toBe(2 * 4000 - 800 - LEAD_SAFETY_MS)
    })

    it('leads now when the transcript is already later than the section has left', () => {
        expect(leadDelayMs(tracking({ linesRemaining: 0 }), 3000, 3)).toBe(0)
    })

    it('schedules nothing it could not act on', () => {
        expect(leadDelayMs(tracking({ phase: 'searching' }), 0, 3)).toBeNull()
        expect(leadDelayMs(tracking({ estimatedLineMs: null }), 0, 3)).toBeNull()
        expect(leadDelayMs(tracking({ displayStepIndex: 1 }), 0, 3)).toBeNull()
        expect(leadDelayMs(tracking(), 0, 1)).toBeNull()
    })
})
