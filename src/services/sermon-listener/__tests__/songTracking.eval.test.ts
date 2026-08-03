import { describe, it, expect } from 'vitest'
import { SongPositionTracker } from '../songTracker'
import { buildSongIndex, identifySong, type IdentifyOptions } from '../songIdentification'
import { SongConfirmationTracker } from '../songConfirmation'
import { parseLyricsIntoSections } from '../../../lib/songSections'
import { HEARD, PRAYER_ANSWERING_GOD_LYRICS } from './realSongTranscript'
import { DECOYS } from './lyricMatchFixtures'
import type { Song } from '../../../types'

/**
 * End-to-end evaluation of song tracking against a real recording.
 *
 * Unit tests here check that a scorer returns the right number for a phrase.
 * They cannot answer the question the operator actually cares about — with
 * this song playing and this engine transcribing it, does the projector follow
 * — because that depends on the whole loop: identification, the position
 * cursor, the miss counter, and how they behave over a hundred consecutive
 * windows, most of them wrong in some way.
 *
 * So this replays the genuine transcript (see realSongTranscript.ts) through
 * the real tracker and asserts on the outcome. The thresholds below are
 * deliberately set just under what the pipeline currently achieves: they are a
 * ratchet against regression, not a target. Tightening them is how an
 * improvement gets recorded.
 */

const SONG: Song = {
    id: 'prayer-answering-god',
    _id: 'prayer-answering-god',
    title: 'Prayer Answering God',
    lyrics: PRAYER_ANSWERING_GOD_LYRICS,
    sections: parseLyricsIntoSections(PRAYER_ANSWERING_GOD_LYRICS),
} as unknown as Song

interface Outcome {
    /** Windows where the tracker held or advanced a position. */
    tracked: number
    /** Windows the tracker could not place at all. */
    missed: number
    /** How often it gave up on the song and fell back to searching. */
    lostEvents: number
    /** Distinct sections it put on screen, in order of first appearance. */
    displayed: string[]
}

function replay(): Outcome {
    const tracker = new SongPositionTracker(SONG)
    tracker.start()

    const outcome: Outcome = { tracked: 0, missed: 0, lostEvents: 0, displayed: [] }
    let wasLost = false

    for (const { atMs, text } of HEARD) {
        const update = tracker.ingest({ text, timeMs: atMs })
        if (update.phase === 'tracking') outcome.tracked++
        if (update.reason === 'miss' || update.reason === 'searching') outcome.missed++

        const nowLost = update.phase === 'lost'
        if (nowLost && !wasLost) outcome.lostEvents++
        wasLost = nowLost

        const shown = update.displaySectionId
        if (shown && outcome.displayed[outcome.displayed.length - 1] !== shown) {
            outcome.displayed.push(shown)
        }
    }
    return outcome
}

describe('tracking a real song from real transcription', () => {
    const outcome = replay()

    it('locks onto the song and stays with it for most of the recording', () => {
        // Reported so a regression run shows the numbers, not just a failure.
        // eslint-disable-next-line no-console
        console.log(
            `tracked ${outcome.tracked}/${HEARD.length} windows, ` +
                `${outcome.missed} unplaceable, lost ${outcome.lostEvents}x, ` +
                `${outcome.displayed.length} slide changes`,
        )
        expect(outcome.tracked).toBeGreaterThan(HEARD.length * 0.5)
    })

    it('does not thrash between sections', () => {
        // The song has ~6 sections. Far more slide changes than that means the
        // cursor is jumping around on garbled input, which on a projector reads
        // as the slides flickering.
        expect(outcome.displayed.length).toBeLessThan(HEARD.length / 2)
    })

    it('reaches the later sections rather than stalling on the first', () => {
        expect(new Set(outcome.displayed).size).toBeGreaterThan(1)
    })
})

describe('identifying a real song from real transcription', () => {
    const index = buildSongIndex([SONG])

    it('identifies it from a fair share of the windows', () => {
        const hits = HEARD.filter((h) => identifySong(h.text, index)?.songId === SONG.id).length
        // eslint-disable-next-line no-console
        console.log(`identified from ${hits}/${HEARD.length} windows`)
        expect(hits).toBeGreaterThan(0)
    })

    it('never identifies it from a window belonging to nothing', () => {
        // Decoys stand in for other songs in the library: a window of this
        // song's audio must not name one of them.
        const decoySong: Song = {
            id: 'decoy',
            _id: 'decoy',
            title: 'Decoy',
            lyrics: DECOYS.join('\n\n'),
            sections: parseLyricsIntoSections(DECOYS.join('\n\n')),
        } as unknown as Song
        const both = buildSongIndex([SONG, decoySong])
        const wrong = HEARD.filter((h) => identifySong(h.text, both)?.songId === 'decoy')
        expect(wrong.map((w) => w.text)).toEqual([])
    })
})

/**
 * How long the congregation sings before the right song reaches the screen.
 *
 * Recall per window is the wrong number to optimise: auto-detect does not act
 * on one window, it accumulates evidence (see songConfirmation.ts). What the
 * operator experiences is the delay, so that is what this measures — by
 * running the same loop useSongAutoDetect runs, over the real transcript.
 */
function timeToConfirm(opts?: IdentifyOptions): number | null {
    const index = buildSongIndex([SONG])
    const confirmation = new SongConfirmationTracker()
    let wordsSeen = 0

    for (const { atMs, text } of HEARD) {
        wordsSeen += text.split(/\s+/).filter(Boolean).length
        const match = identifySong(text, index, opts)
        const confirmed = confirmation.update(
            atMs,
            match
                ? { songId: match.songId, confidence: match.confidence, windowId: wordsSeen }
                : null,
        )
        if (confirmed) return atMs
    }
    return null
}

describe('how long until the right song is on screen', () => {
    it('confirms the song, and does so early enough to be useful', () => {
        const at = timeToConfirm()
        // eslint-disable-next-line no-console
        console.log(
            `confirmed at ${at === null ? 'never' : `${(at / 1000).toFixed(0)}s`} ` +
                `(recording is ${(HEARD[HEARD.length - 1].atMs / 1000).toFixed(0)}s long)`,
        )
        expect(at).not.toBeNull()
        // A minute of singing before the lyrics appear is already poor; this
        // guards the regression rather than endorsing the number.
        expect(at!).toBeLessThan(120_000)
    })
})
