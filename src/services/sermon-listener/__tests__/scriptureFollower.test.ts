/**
 * The scripture follower through its own interface: utterances in, the
 * snapshot and decisions out. No React, no store, no Bible data — a fake
 * semantic matcher and LLM return scripted results, and fake timers stand in
 * for the clock.
 *
 * Most of these are incidents from live services, kept as scenarios so the
 * policy that fixed them can't quietly regress.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    createScriptureFollower,
    type FollowerDecision,
    type FollowerSettings,
    type ScriptureFollower,
} from '../scriptureFollower'
import type { DetectedVerse } from '../verseDetection'
import type { SemanticVerseMatch } from '../semanticVerseDetection'

const SECOND = 1000

// Phrased so only the detection path sees them, not the voice-command path.
const JOSHUA_24 = 'We see in Joshua chapter 24 that they served the Lord.'
const JUDGES_2 = 'We see in Judges chapter 2 that they forgot the Lord.'
const JOSHUA_24_AGAIN = 'Remember what we saw in Joshua chapter 24 about serving the Lord.'
// Long enough to push an earlier mention out of the 1500-character window.
const FILLER = Array.from({ length: 1700 / 7 }, (_, i) =>
    ['and', 'then', 'they', 'went', 'home', 'quietly', 'again', 'after', 'supper', 'with', 'friends', 'talking'][i % 12] + ['', 'ly', 's', 'ed'][Math.floor(i / 12) % 4],
).join(' ')

function match(reference: string, score: number, text = 'the verse text, as the scripture says'): SemanticVerseMatch {
    const [, book, chapter, verse] = /^(.+) (\d+):(\d+)$/.exec(reference)!
    return { reference, book, chapter: Number(chapter), verse: Number(verse), text, score, detectionType: 'semantic' }
}

function verse(reference: string, confidence: DetectedVerse['confidence'] = 'high'): DetectedVerse {
    const [, book, chapter, start] = /^(.+) (\d+):(\d+)$/.exec(reference)!
    return { raw: reference, reference, book, chapter: Number(chapter), verseStart: Number(start), startIndex: 0, endIndex: 0, confidence }
}

function follow(overrides: Partial<FollowerSettings> = {}) {
    const decisions: FollowerDecision[] = []
    const semanticQueue: Array<SemanticVerseMatch[] | null> = []
    const readingContexts: Array<[string | null, number | undefined, number | undefined]> = []
    const world = { singing: false, liveVerse: null as DetectedVerse | null }
    const llm = { configured: false, delay: 0, result: [] as DetectedVerse[] }
    const settings: FollowerSettings = {
        minConfidence: 'medium', autoLookup: true, autoDisplay: true, enableVoiceCommands: true, language: 'en-US',
        ...overrides,
    }
    let semanticDelay = 0

    const follower: ScriptureFollower = createScriptureFollower({
        settings: () => settings,
        world: {
            isSinging: () => world.singing,
            liveVerse: () => world.liveVerse,
            resolveVersion: (requested) => requested.toUpperCase(),
        },
        semantic: () => ({
            addText: async () => {
                if (semanticDelay) await new Promise((r) => setTimeout(r, semanticDelay))
                return semanticQueue.shift() ?? null
            },
            setReadingContext: (book, chapter, v) => {
                readingContexts.push([book, chapter, v])
            },
        }),
        llm: {
            isConfigured: () => llm.configured,
            extract: async () => {
                if (llm.delay) await new Promise((r) => setTimeout(r, llm.delay))
                return { newVerses: llm.result }
            },
        },
        decide: (d) => {
            decisions.push(d)
            // Settle version changes as the listener would, with the label the lookup gives.
            if (d.type === 'change-version') d.settle({ ok: true, label: d.verse?.reference })
        },
        initialBibleVersion: 'KJV',
    })

    let transcript = ''
    return {
        follower,
        decisions,
        readingContexts,
        world,
        llm,
        settings,
        semanticWillMatch(...matches: SemanticVerseMatch[]) {
            semanticQueue.push(matches)
        },
        set semanticDelay(ms: number) {
            semanticDelay = ms
        },
        get semanticQueue() {
            return semanticQueue
        },
        async say(chunk: string) {
            transcript = `${transcript} ${chunk}`.trim()
            follower.hear(transcript, { latestChunk: chunk, committed: true })
            await vi.advanceTimersByTimeAsync(0)
        },
        async wait(ms: number) {
            await vi.advanceTimersByTimeAsync(ms)
        },
        heard: () => follower.getSnapshot().heardVerses.map((v) => v.reference),
        heardVerse: (reference: string) => follower.getSnapshot().heardVerses.find((v) => v.reference === reference),
        current: () => follower.getSnapshot().currentVerse?.reference ?? null,
        /** What the follower asked to be put up or rewritten live, in order. */
        shown: () => decisions.flatMap((d) => (d.type === 'look-up' && d.then !== 'nothing' ? [d.verse.reference] : [])),
        lookUps: () => decisions.flatMap((d) => (d.type === 'look-up' ? [`${d.verse.reference}→${d.then}`] : [])),
    }
}

beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-22T10:00:00Z') })
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('scripture follower: explicit references', () => {
    it('a heard reference becomes current and is offered for display', async () => {
        const f = follow()
        await f.say(JOSHUA_24)

        expect(f.heard()).toEqual(['Joshua 24:1'])
        expect(f.current()).toBe('Joshua 24:1')
        expect(f.lookUps()).toEqual(['Joshua 24:1→project'])
    })

    it('with auto-display off it is still looked up, but not put up', async () => {
        const f = follow({ autoDisplay: false })
        await f.say(JOSHUA_24)
        expect(f.lookUps()).toEqual(['Joshua 24:1→nothing'])
    })

    it('with auto-lookup off it is listed and current, and nothing more', async () => {
        const f = follow({ autoLookup: false })
        await f.say(JOSHUA_24)
        expect(f.current()).toBe('Joshua 24:1')
        expect(f.lookUps()).toEqual([])
    })

    it('a later reference takes over', async () => {
        const f = follow()
        await f.say(JOSHUA_24)
        await f.say(JUDGES_2)
        expect(f.current()).toBe('Judges 2:1')
        expect(f.shown()).toEqual(['Joshua 24:1', 'Judges 2:1'])
    })

    it('a chapter-only mention does not revert a specific verse (Joshua 24:15 → 24:1)', async () => {
        const f = follow()
        await f.say('Joshua chapter 24 verse 15.')
        await f.wait(10 * SECOND)
        await f.say(JOSHUA_24)

        expect(f.current()).toBe('Joshua 24:15')
        expect(f.shown()).toEqual(['Joshua 24:15'])
    })

    // Pinned, not endorsed: the command path has no specificity guard.
    it('the same mention phrased as a command does revert to verse 1', async () => {
        const f = follow()
        await f.say('Joshua chapter 24 verse 15.')
        await f.wait(10 * SECOND)
        await f.say('As for me and my house, Joshua chapter 24, we will serve the Lord.')
        expect(f.current()).toBe('Joshua 24:1')
    })

    it('a verse that completes the reference a command just set is not held back by the cooldown ("Hebrews 13" … "Five.")', async () => {
        const f = follow()
        await f.say('Hebrews 13.')
        await f.say('Five.')

        expect(f.current()).toBe('Hebrews 13:5')
        expect(f.shown()).toContain('Hebrews 13:5')
    })

    it('a different reference inside the navigation cooldown is listed but not put up', async () => {
        const f = follow()
        await f.say('Hebrews 13.')
        await f.say(JOSHUA_24)

        expect(f.current()).toBe('Joshua 24:1')
        expect(f.shown()).toEqual(['Hebrews 13:1'])
    })
})

describe('scripture follower: voice commands', () => {
    it('"verse 15" after a bare chapter resolves into that chapter', async () => {
        const f = follow()
        await f.say('Joshua 24.')
        await f.say('Verse 15.')
        expect(f.current()).toBe('Joshua 24:15')
        expect(f.lookUps().at(-1)).toBe('Joshua 24:15→refresh-live')
        expect(f.readingContexts.at(-1)).toEqual(['Joshua', 24, 15])
    })

    it('"next verse" and "previous verse" rewrite the live slide in place', async () => {
        const f = follow()
        await f.say('Turn with me to John 3:16.')
        await f.wait(4 * SECOND)
        await f.say('Next verse.')
        expect(f.current()).toBe('John 3:17')
        await f.wait(4 * SECOND)
        await f.say('Previous verse.')
        expect(f.current()).toBe('John 3:16')
        expect(f.lookUps().slice(1)).toEqual(['John 3:17→refresh-live', 'John 3:16→refresh-live'])
    })

    it('"next chapter" from the last chapter of a book moves into the next book', async () => {
        const f = follow()
        await f.say('Genesis 50 verse 26.')
        await f.wait(4 * SECOND)
        await f.say('Next chapter.')
        expect(f.follower.getSnapshot().currentVerse).toMatchObject({ book: 'Exodus', chapter: 1, verseStart: 1 })
    })

    it('"previous chapter" from the first chapter of a book moves into the book before', async () => {
        const f = follow()
        await f.say('Exodus 1 verse 5.')
        await f.wait(4 * SECOND)
        await f.say('Previous chapter.')
        expect(f.follower.getSnapshot().currentVerse).toMatchObject({ book: 'Genesis', chapter: 50, verseStart: 1 })
    })

    it('navigation with nothing heard follows the verse on the live slide', async () => {
        const f = follow()
        f.world.liveVerse = verse('John 3:16')
        await f.say('Verse 5.')
        expect(f.current()).toBe('John 3:5')
    })

    it('a version switch changes the active version and, once it lands, holds detections off the screen', async () => {
        const f = follow()
        await f.say('Turn with me to John 3:16.')
        await f.wait(4 * SECOND)
        await f.say('Read it in the NIV.')

        expect(f.follower.getSnapshot().activeBibleVersion).toBe('NIV')
        expect(f.follower.getSnapshot().lastVoiceCommand?.type).toBe('change_version')
        const change = f.decisions.find((d) => d.type === 'change-version')
        expect(change).toMatchObject({ versionId: 'NIV', verse: { reference: 'John 3:16' } })
    })

    it('"display it", "stop listening" and "start listening" are passed on to the listener', async () => {
        const f = follow({ autoDisplay: false })
        await f.say(JOSHUA_24)
        await f.say('Display it.')
        await f.say('Stop listening.')
        await f.say('Start listening.')
        expect(f.decisions.map((d) => d.type).filter((t) => t !== 'look-up' && t !== 'detected'))
            .toEqual(['display', 'stop-listening', 'start-listening'])
    })

    it('one command is not run twice for the same utterance heard twice', async () => {
        const f = follow()
        await f.say('Turn with me to John 3:16.')
        await f.wait(4 * SECOND)
        await f.say('Next verse.')
        f.follower.hear('Turn with me to John 3:16. Next verse.', { latestChunk: 'Next verse.', committed: true })
        expect(f.current()).toBe('John 3:17')
    })

    // Pinned current bug: the change_version command's matched text runs to the
    // end of the transcript, so speech after it is hidden from detection.
    it('[current bug] speech after "read it in the NIV" is hidden from detection', async () => {
        const f = follow()
        await f.say('Turn with me to John 3:16.')
        await f.wait(4 * SECOND)
        await f.say('Read it in the NIV.')
        await f.say(JOSHUA_24)
        expect(f.heard()).toEqual(['John 3:16'])
    })
})

describe('scripture follower: semantic matches', () => {
    it('a paraphrase with a scripture marker is heard and offered', async () => {
        const f = follow()
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        expect(f.heard()).toEqual(['John 3:16'])
        expect(f.shown()).toEqual(['John 3:16'])
    })

    it('a weak match with no marker word is dropped as an incidental idiom', async () => {
        const f = follow()
        f.semanticWillMatch(match('John 19:30', 0.70, 'it is finished and done'))
        await f.say('The scripture tells us the work is finished and done now.')
        expect(f.heard()).toEqual([])
    })

    it('a low-confidence match is never put up', async () => {
        const f = follow({ minConfidence: 'low' })
        f.semanticWillMatch(match('John 3:16', 0.60))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        expect(f.heard()).toEqual(['John 3:16'])
        expect(f.lookUps()).toEqual(['John 3:16→nothing'])
    })

    it('an already-heard best candidate keeps a novel lower-ranked one off the screen (Deut 6:7 vs 11:19)', async () => {
        const f = follow()
        await f.say('Deuteronomy 6 verse 7.')
        await f.wait(5 * SECOND)
        f.semanticWillMatch(match('Deuteronomy 6:7', 0.80), match('Deuteronomy 11:19', 0.84))
        await f.say('The word says teach them diligently unto thy children and talk of them.')

        expect(f.current()).toBe('Deuteronomy 6:7')
        expect(f.heardVerse('Deuteronomy 11:19')?.isBestMatch).toBe(false)
        expect(f.shown()).toEqual(['Deuteronomy 6:7'])
    })

    it('with no chapter announced, an already-heard best candidate still keeps a novel one off the screen', async () => {
        const f = follow()
        f.semanticWillMatch(match('Deuteronomy 6:7', 0.80))
        await f.say('The word says teach them diligently unto thy children.')
        await f.wait(5 * SECOND)
        f.semanticWillMatch(match('Deuteronomy 6:7', 0.80), match('Deuteronomy 11:19', 0.84))
        await f.say('The word says and talk of them when thou sittest in thine house.')

        expect(f.heard()).toContain('Deuteronomy 11:19')
        expect(f.heardVerse('Deuteronomy 11:19')?.isBestMatch).toBe(false)
        expect(f.current()).toBe('Deuteronomy 6:7')
    })

    it('reading an announced chapter is not dropped by the marker floor (Psalm 27)', async () => {
        const f = follow()
        await f.say('Psalm 27.')
        await f.wait(5 * SECOND)
        f.semanticWillMatch(match('Psalms 27:1', 0.732, 'the lord is my light and my salvation whom shall i fear'))
        await f.say('The Lord is my light and my salvation, whom shall I fear.')
        expect(f.heard()).toContain('Psalms 27:1')
    })

    it('a match cannot collapse a range already current', async () => {
        const f = follow()
        await f.say('We see in Psalm 34 verses 7 through 8 that the angel of the Lord is near.')
        await f.wait(5 * SECOND)
        f.semanticWillMatch(match('Psalms 34:7', 0.70, 'the angel of the lord encampeth round about them'))
        await f.say('The angel of the Lord encamps round about them that fear him.')
        expect(f.current()).toBe('Psalms 34:7-8')
    })

    it('a result that lands after a newer explicit reference is listed but not made current', async () => {
        const f = follow()
        f.semanticDelay = SECOND
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        await f.say(JOSHUA_24)
        await f.wait(2 * SECOND)

        expect(f.heard()).toContain('John 3:16')
        expect(f.current()).toBe('Joshua 24:1')
        expect(f.shown()).toEqual(['Joshua 24:1'])
    })

    it('a weaker match in a chapter already heard is not added', async () => {
        const f = follow()
        f.semanticWillMatch(match('Psalms 23:1', 0.80))
        await f.say('The scripture says the shepherd provides everything his sheep need.')
        await f.wait(5 * SECOND)
        f.semanticWillMatch(match('Psalms 23:4', 0.82))
        await f.say('The scripture says even in the darkest valley he is with us.')
        expect(f.heard()).toEqual(['Psalms 23:1'])
    })

    it('no search runs while the congregation is singing', async () => {
        const f = follow()
        f.world.singing = true
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        expect(f.heard()).toEqual([])
        expect(f.semanticQueue).toHaveLength(1)
    })

    it('a semantic verse heard again after a silence comes back', async () => {
        const f = follow()
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        await f.say('Turn with me to Romans 8:28.')
        await f.say(FILLER)
        await f.wait(61 * SECOND)
        f.semanticWillMatch(match('John 3:16', 0.80))
        await f.say('The scripture says for God so loved the world, remember.')

        expect(f.current()).toBe('John 3:16')
        expect(f.shown().at(-1)).toBe('John 3:16')
        expect(f.heardVerse('John 3:16')!.lastActivatedAt).toBe(Date.now())
    })

    it('the semantic search is reported while it runs', async () => {
        const f = follow()
        f.semanticDelay = SECOND
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        expect(f.follower.getSnapshot().semanticSearching).toBe(true)
        await f.wait(SECOND)
        expect(f.follower.getSnapshot().semanticSearching).toBe(false)
    })
})

describe('scripture follower: the LLM pass', () => {
    it('adds and offers a verse the local detectors missed, once speech settles', async () => {
        const f = follow()
        f.llm.configured = true
        f.llm.result = [verse('Romans 8:28')]
        await f.say('All things work together for good to them that love God.')
        expect(f.heard()).toEqual([])
        await f.wait(4 * SECOND)
        expect(f.heard()).toEqual(['Romans 8:28'])
        expect(f.shown()).toEqual(['Romans 8:28'])
    })

    it('an answer that lands after a newer explicit reference is listed but not made current', async () => {
        const f = follow()
        f.llm.configured = true
        f.llm.delay = 2 * SECOND
        f.llm.result = [verse('Romans 8:28')]
        await f.say('All things work together for good to them that love God.')
        await f.wait(3600)
        await f.say(JOSHUA_24)
        await f.wait(2 * SECOND)
        expect(f.heard()).toContain('Romans 8:28')
        expect(f.current()).toBe('Joshua 24:1')
    })

    it('a pending pass is dropped when listening stops', async () => {
        const f = follow()
        f.llm.configured = true
        f.llm.result = [verse('Romans 8:28')]
        await f.say('All things work together for good to them that love God.')
        f.follower.cancelPending()
        await f.wait(4 * SECOND)
        expect(f.heard()).toEqual([])
    })
})

describe('scripture follower: what the heard verses remember', () => {
    it('a verse merely still in the window is not re-stamped as heard', async () => {
        const f = follow()
        await f.say(JOSHUA_24)
        const stamp = f.heardVerse('Joshua 24:1')!.lastActivatedAt
        await f.wait(10 * SECOND)
        await f.say('And they kept serving him all the days of their lives.')
        expect(f.heardVerse('Joshua 24:1')).toMatchObject({ lastActivatedAt: stamp, retriggerCount: 0 })
        expect(f.lookUps()).toEqual(['Joshua 24:1→project'])
    })

    it('a verse said again after a silence is shown again and re-stamped in the list', async () => {
        const f = follow()
        await f.say(JOSHUA_24)
        await f.say(JUDGES_2)
        await f.say(FILLER)
        await f.wait(61 * SECOND)
        await f.say(JOSHUA_24_AGAIN)

        expect(f.current()).toBe('Joshua 24:1')
        expect(f.heardVerse('Joshua 24:1')).toMatchObject({ lastActivatedAt: Date.now(), retriggerCount: 1 })
        expect(f.shown().at(-1)).toBe('Joshua 24:1')
    })

    it('a verse removed from the list can be heard again', async () => {
        const f = follow()
        await f.say(JOSHUA_24)
        f.follower.remove('Joshua 24:1')
        expect(f.heard()).toEqual([])
        await f.wait(5 * SECOND)
        await f.say(JOSHUA_24_AGAIN)
        expect(f.heard()).toEqual(['Joshua 24:1'])
    })

    it('restored verses count as heard, and a re-mention brings one back', async () => {
        const f = follow()
        f.follower.restore({ heardVerses: [{ ...verse('Joshua 24:1', 'medium'), isBestMatch: true, lastActivatedAt: 0, retriggerCount: 0 }] })
        await f.say(JOSHUA_24)

        expect(f.heardVerse('Joshua 24:1')!.retriggerCount).toBe(1)
        expect(f.current()).toBe('Joshua 24:1')
        expect(f.shown()).toEqual(['Joshua 24:1'])
    })

    it('a disposed follower decides nothing more, and clears the semantic reading context', async () => {
        const f = follow()
        f.semanticDelay = SECOND
        f.semanticWillMatch(match('John 3:16', 0.82))
        await f.say('The scripture says for God so loved the world that he gave his only son.')
        f.follower.dispose()
        await f.wait(2 * SECOND)

        expect(f.heard()).toEqual([])
        expect(f.decisions).toEqual([])
        expect(f.readingContexts.at(-1)).toEqual([null, undefined, undefined])
    })
})
