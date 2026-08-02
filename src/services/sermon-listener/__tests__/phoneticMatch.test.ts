import { describe, it, expect } from 'vitest'
import { phoneticCode, codeSimilarity, phoneticSimilarity } from '../phoneticMatch'
import { lineSimilarity, lyricSimilarity } from '../songTracker'
import { RECOVERABLE, UNRECOVERABLE, DECOYS } from './lyricMatchFixtures'

/** DEFAULT_TRACKER_CONFIG.trackThreshold — the bar for accepting a position. */
const TRACK_THRESHOLD = 0.4

describe('phoneticCode', () => {
    it('collapses spelling variants that sound identical', () => {
        expect(phoneticCode('splendour')).toBe(phoneticCode('splendor'))
        expect(phoneticCode('majesty')).toBe(phoneticCode('majestie'))
    })

    it('neutralizes voicing pairs, which singing rarely preserves', () => {
        expect(phoneticCode('tried')).toBe(phoneticCode('tryt'))
        expect(phoneticCode('grace')).toBe(phoneticCode('krace'))
    })

    it('keeps a leading vowel so unrelated words do not merge', () => {
        expect(phoneticCode('all')).not.toBe(phoneticCode('la'))
    })

    it('keeps genuinely different words apart', () => {
        expect(codeSimilarity(phoneticCode('great'), phoneticCode('mercy'))).toBeLessThan(0.4)
        expect(codeSimilarity(phoneticCode('worship'), phoneticCode('lamb'))).toBeLessThan(0.4)
    })

    it('is empty for input with no letters', () => {
        expect(phoneticCode('...')).toBe('')
        expect(phoneticCode('')).toBe('')
    })
})

describe('lyric matching against real mis-transcriptions', () => {
    // Fixtures are verbatim engine output from live runs, not invented
    // examples — see lyricMatchFixtures.ts.

    it.each(RECOVERABLE.map((f) => [f.sung, f.heard, f.note] as const))(
        'recovers %s (%s)',
        (sung, heard) => {
            expect(lyricSimilarity(heard, sung)).toBeGreaterThanOrEqual(TRACK_THRESHOLD)
        },
    )

    it('recovers at least one line the lexical scorer alone misses', () => {
        const rescued = RECOVERABLE.filter(
            (f) =>
                lineSimilarity(f.heard, f.sung) < TRACK_THRESHOLD &&
                lyricSimilarity(f.heard, f.sung) >= TRACK_THRESHOLD,
        )
        // "Clothed in Majesty" -> "cloth and majesty" is the canonical case:
        // the word boundary moved, so as words it shares almost nothing.
        expect(rescued.length).toBeGreaterThan(0)
    })

    it('lifts scores at the near-exact threshold that identifies a song alone', () => {
        const STRONG = 0.82
        const lex = RECOVERABLE.filter((f) => lineSimilarity(f.heard, f.sung) >= STRONG).length
        const both = RECOVERABLE.filter((f) => lyricSimilarity(f.heard, f.sung) >= STRONG).length
        expect(both).toBeGreaterThan(lex)
    })

    it('does not rescue lines the engine genuinely destroyed', () => {
        // Kept as a ceiling check: no scorer recovers "how great is our God"
        // from "how crazy". That is the position prior's job, not matching's,
        // and pretending otherwise would mean tuning until decoys match too.
        for (const f of UNRECOVERABLE) {
            expect(lyricSimilarity(f.heard, f.sung)).toBeLessThan(TRACK_THRESHOLD)
        }
    })
})

describe('precision: unrelated songs must not match', () => {
    const heards = [...RECOVERABLE, ...UNRECOVERABLE].map((f) => f.heard)

    it('keeps every decoy line below the tracking threshold', () => {
        for (const decoy of DECOYS) {
            for (const heard of heards) {
                expect(
                    lyricSimilarity(heard, decoy),
                    `decoy "${decoy}" matched transcript "${heard}"`,
                ).toBeLessThan(TRACK_THRESHOLD)
            }
        }
    })

    it('never scores a decoy above the true line for the same transcript', () => {
        for (const f of RECOVERABLE) {
            const truth = lyricSimilarity(f.heard, f.sung)
            for (const decoy of DECOYS) {
                expect(
                    lyricSimilarity(f.heard, decoy),
                    `decoy "${decoy}" beat the true line for "${f.heard}"`,
                ).toBeLessThan(truth)
            }
        }
    })
})

describe('phoneticSimilarity edges', () => {
    it('returns 0 for empty input rather than a false match', () => {
        expect(phoneticSimilarity('', 'How great is our God')).toBe(0)
        expect(phoneticSimilarity('how great is our God', '')).toBe(0)
    })

    it('scores an exact line at the top of the range', () => {
        expect(phoneticSimilarity('how great is our God', 'How great is our God')).toBe(1)
    })
})
