import { describe, it, expect } from 'vitest'
import { describeReport, score, simulate } from './songTimingSim'

describe('section timing with real transcription delay', () => {
    const report = score(simulate())

    it('reports when each section reached the screen', () => {
        console.log(describeReport('TIMING', report))
        expect(report.transitions.length).toBeGreaterThan(5)
    })

    it('keeps the right slide up most of the time', () => {
        // Was 68% before predicted leads could be taken back and far jumps
        // needed real evidence; now ~90%.
        expect(report.correct).toBeGreaterThan(0.85)
    })

    it('rarely shows lyrics nobody is singing', () => {
        // Wrong or premature (next section far too early). Was 28% combined.
        expect(report.wrong + report.premature).toBeLessThan(0.1)
        expect(report.flashes).toBeLessThanOrEqual(3)
    })

    it('puts most section changes up before the singers get there', () => {
        // Four of eight land 1-2 s early (two before this pass). Of the rest:
        // the song's first change comes before any line has been timed; one
        // is a jump back to an earlier section, which nothing can predict; two
        // the tracker deliberately declines to predict after the band looped
        // an ending, rather than flicker.
        const early = report.transitions.filter((t) => t.leadS !== null && t.leadS > 0)
        expect(early.length).toBeGreaterThanOrEqual(4)
        expect(report.transitions.every((t) => t.leadS !== null)).toBe(true)
    })
})
