import { describe, it, expect } from 'vitest'
import { SongPositionTracker, type TrackerUpdate } from '../songTracker'
import { parseLyricsIntoSections } from '../../../lib/songSections'
import { HEARD, PRAYER_ANSWERING_GOD_LYRICS } from './realSongTranscript'
import { GROUND_TRUTH } from './realSongGroundTruth'
import type { Song } from '../../../types'

/**
 * Does the listener know when the congregation is singing?
 *
 * It decides two things the operator sees: scripture detection is muted while
 * a song is sung, and auto-detect only looks for the next song once the
 * current one isn't. Both went wrong the same way — the tracker held on to a
 * song through the sermon after it, so a paraphrased verse was never searched
 * for and the next song wasn't looked for either.
 *
 * The service here is the real recorded song, then preaching, then the song
 * again. The preaching is written to be hard: it borrows the song's own
 * words — prayer, hands, "God has heard you" — the way a leader's
 * exhortation does, because that is what kept the tracker holding on.
 */

const SONG: Song = {
    id: 'prayer-answering-god',
    title: 'Prayer Answering God',
    artist: 'Recorded live',
    lyrics: PRAYER_ANSWERING_GOD_LYRICS,
    sections: parseLyricsIntoSections(PRAYER_ANSWERING_GOD_LYRICS),
} as unknown as Song

const PREACHING = [
    'Church, I want you to turn with me to the book of Philippians this morning.',
    'Paul is writing from a prison cell, and he says rejoice in the Lord always.',
    'Think about that. He is in chains and he is telling the church to rejoice.',
    'Some of you came in today carrying something heavy, and you are tired.',
    'You have prayed about it, and you are wondering whether God has heard you.',
    'I want to tell you that the God we serve is a God who answers prayer.',
    'But sometimes the answer does not look like what we expected it to look like.',
    'Paul says do not be anxious about anything, but in every situation by prayer.',
    'Not in some situations. Every situation. The big ones and the small ones.',
    'And he says with thanksgiving. Before the answer comes, you give thanks.',
    'That is faith. Thanking him for what your eyes have not seen yet.',
    'Lift your hands if you have been waiting on the Lord for something this year.',
    'Look at your neighbour and tell them, God has not forgotten you.',
    'Now the peace of God, which transcends all understanding, will guard your hearts.',
    'Guard. That is a military word. The peace of God stands at the door of your heart.',
    'So when worry knocks, peace answers the door. Can somebody say amen?',
    'Let me read verse eight. Whatever is true, whatever is noble, whatever is right.',
    'Paul is telling us that what we think about shapes how we pray.',
    'If all you think about is the problem, your prayers become complaints.',
    'But if you think about his faithfulness, your prayers become worship.',
]

const SECOND_SINGING_FROM_MS = 294_000
const SECOND_SINGING_TO_MS = 395_000

interface Window {
    atMs: number
    text: string
    /** What was really happening: singing (labelled), preaching, or unknown. */
    truth: 'singing' | 'preaching' | 'unknown'
}

function service(): Window[] {
    const out: Window[] = []
    const songTruth = (atMs: number): Window['truth'] => {
        const span = GROUND_TRUTH.find((s) => atMs >= s.fromMs && atMs < s.toMs)
        return span?.sectionId ? 'singing' : 'unknown'
    }
    for (const w of HEARD) out.push({ atMs: w.atMs, text: w.text, truth: songTruth(w.atMs) })
    const sermonStart = HEARD[HEARD.length - 1].atMs + 8000
    PREACHING.forEach((text, i) => out.push({ atMs: sermonStart + i * 7000, text, truth: 'preaching' }))
    // The song again after the sermon: the recording's "you have heard me" vamp.
    const againStart = sermonStart + PREACHING.length * 7000 + 8000
    for (const w of HEARD.filter((h) => h.atMs >= SECOND_SINGING_FROM_MS && h.atMs < SECOND_SINGING_TO_MS)) {
        out.push({ atMs: againStart + (w.atMs - SECOND_SINGING_FROM_MS), text: w.text, truth: 'singing' })
    }
    return out
}

function replay(isSinging: (u: TrackerUpdate) => boolean) {
    const tracker = new SongPositionTracker(SONG)
    tracker.start()
    return service().map((w) => ({ ...w, singing: isSinging(tracker.ingest({ text: w.text, timeMs: w.atMs })) }))
}

function report(rows: ReturnType<typeof replay>) {
    const share = (truth: Window['truth'], singing: boolean) => {
        const of = rows.filter((r) => r.truth === truth)
        return of.filter((r) => r.singing === singing).length / of.length
    }
    const sermon = rows.filter((r) => r.truth === 'preaching')
    const firstQuiet = sermon.findIndex((r) => !r.singing)
    const again = rows.slice(rows.findIndex((r, i) => i > 0 && rows[i - 1].truth === 'preaching' && r.truth === 'singing'))
    return {
        singingHeard: share('singing', true),
        preachingHeardAsSinging: share('preaching', true),
        sermonWindowsBeforeQuiet: firstQuiet === -1 ? sermon.length : firstQuiet,
        windowsUntilSingingAgain: again.findIndex((r) => r.singing),
    }
}

describe('knowing when the congregation is singing', () => {
    const now = report(replay((u) => u.singing))
    // What "singing" used to mean: the tracker still Tracking.
    const before = report(replay((u) => u.phase === 'tracking'))

    it('reports both measures', () => {
        const pct = (n: number) => `${Math.round(n * 100)}%`
        console.log(
            'SINGING now:    ' +
                `singing heard ${pct(now.singingHeard)}, preaching taken for singing ${pct(now.preachingHeardAsSinging)}, ` +
                `quiet after ${now.sermonWindowsBeforeQuiet} sermon windows, singing again after ${now.windowsUntilSingingAgain}\n` +
                'SINGING before: ' +
                `singing heard ${pct(before.singingHeard)}, preaching taken for singing ${pct(before.preachingHeardAsSinging)}, ` +
                `quiet after ${before.sermonWindowsBeforeQuiet} sermon windows`,
        )
        expect(now.singingHeard).toBeGreaterThan(0)
    })

    it('hears most of the singing as singing', () => {
        expect(now.singingHeard).toBeGreaterThan(0.85)
    })

    it('stops calling it singing within a couple of sermon windows', () => {
        expect(now.sermonWindowsBeforeQuiet).toBeLessThanOrEqual(2)
        // Not zero, and not expected to be: this sermon quotes the song
        // ("God has heard you"), and a quoted line reads as sung for one
        // singing gap. Was 85% when tracking stood for singing.
        expect(now.preachingHeardAsSinging).toBeLessThanOrEqual(0.3)
    })

    it('hears the song again as soon as it comes back', () => {
        expect(now.windowsUntilSingingAgain).toBeLessThanOrEqual(1)
    })
})
