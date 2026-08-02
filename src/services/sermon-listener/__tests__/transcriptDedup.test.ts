import { describe, it, expect } from 'vitest'
import { isDuplicateUtterance } from '../transcriptDedup'

describe('isDuplicateUtterance', () => {
    it('drops an exact repeat of the previous chunk (ASR stutter)', () => {
        expect(isDuplicateUtterance('and we cry holy', ['and we cry holy'])).toBe(true)
    })

    it('drops a chunk almost entirely contained in the previous one', () => {
        expect(
            isDuplicateUtterance('for a saint is just a sinner', ['for a saint is just a sinner who']),
        ).toBe(true)
    })

    it('keeps a chunk that extends the previous one', () => {
        expect(
            isDuplicateUtterance('for a saint is just a sinner who fell down and got up', [
                'for a saint',
            ]),
        ).toBe(false)
    })

    it('keeps very short text rather than risk dropping real filler', () => {
        expect(isDuplicateUtterance('oh', ['oh'])).toBe(false)
    })

    it('is case- and whitespace-insensitive', () => {
        expect(isDuplicateUtterance('  We Fall Down  ', ['we fall down'])).toBe(true)
    })

    describe('worship mode', () => {
        // The bug this guards: a chorus repeats by design, so a hook that
        // landed in the recent-chunk history on its first pass was discarded
        // on every later pass — the transcript stopped mid-song while the
        // audio kept arriving, and the song tracker froze with it.
        const chorus = 'we fall down but we get up'
        const history = [chorus, 'for a saint is just a sinner', 'who fell down and got up', 'and we cry holy']

        it('lets a chorus return after intervening lines', () => {
            expect(isDuplicateUtterance(chorus, history, { worshipMode: true })).toBe(false)
        })

        it('still catches the recognizer repeating itself back to back', () => {
            expect(
                isDuplicateUtterance(chorus, [...history, chorus], { worshipMode: true }),
            ).toBe(true)
        })

        it('survives a whole song of repeats without the transcript drying up', () => {
            // Two verses' worth of a hook-heavy song, fed through the filter
            // the way the listener does: kept chunks join the history.
            const song = [
                'we fall down but we get up',
                'for a saint is just a sinner who fell down',
                'and got up',
                'we fall down but we get up',
                'for a saint is just a sinner who fell down',
                'and got up',
                'we fall down but we get up',
            ]
            const kept: string[] = []
            for (const line of song) {
                if (!isDuplicateUtterance(line, kept, { worshipMode: true })) kept.push(line)
            }
            expect(kept).toEqual(song)
        })

        it('sermon mode still suppresses the wider window', () => {
            expect(isDuplicateUtterance(chorus, history)).toBe(true)
        })
    })
})
