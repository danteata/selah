/**
 * The transcript assembler through its own interface: engine results in, the
 * transcript and what the follower should hear out. Pure, so no fakes beyond
 * the clock value passed in.
 */
import { describe, it, expect } from 'vitest'
import { TranscriptAssembler, cleanRepeatedPhrases, stripOverlap } from '../transcriptAssembler'

const T0 = 1_800_000_000_000
const web = { provider: 'web-speech' as const, worshipMode: false }

function assembler() {
    const a = new TranscriptAssembler()
    a.startRun(T0)
    return a
}

describe('transcript assembler', () => {
    it('commits a final utterance, timed from when the run began', () => {
        const a = assembler()
        const out = a.take({ text: 'Turn with me to John 3:16.', isFinal: true }, { now: T0 + 4000, ...web })

        expect(out).toEqual({ kind: 'final', chunk: 'Turn with me to John 3:16.', hear: 'Turn with me to John 3:16.', committed: true })
        expect(a.getSnapshot().text).toBe('Turn with me to John 3:16.')
        expect(a.getSnapshot().segments).toMatchObject([{ text: 'Turn with me to John 3:16.', startMs: 4000, endMs: 4000, source: 'web-speech' }])
    })

    it('times an utterance from its first interim', () => {
        const a = assembler()
        a.take({ text: 'Turn with', isFinal: false }, { now: T0 + 1000, ...web })
        a.take({ text: 'Turn with me to', isFinal: false }, { now: T0 + 2000, ...web })
        a.take({ text: 'Turn with me to John 3:16.', isFinal: true }, { now: T0 + 3000, ...web })
        expect(a.getSnapshot().segments[0]).toMatchObject({ startMs: 1000, endMs: 3000 })
        expect(a.getSnapshot().interim).toBe('')
    })

    it('an interim is shown and heard against the committed text, but not committed', () => {
        const a = assembler()
        a.take({ text: 'In the beginning.', isFinal: true }, { now: T0 + 1000, ...web })
        const out = a.take({ text: 'God created', isFinal: false }, { now: T0 + 2000, ...web })

        expect(out).toEqual({ kind: 'interim', chunk: 'God created', hear: 'In the beginning. God created', committed: false })
        expect(a.getSnapshot().interim).toBe('God created')
        expect(a.getSnapshot().text).toBe('In the beginning.')
    })

    it('keeps the native engine\'s own segment timing', () => {
        const a = assembler()
        a.take({
            text: 'For God so loved the world. That he gave.',
            isFinal: true,
            segments: [
                { startMs: 1200, endMs: 2500, text: ' For God so loved the world.' },
                { startMs: 2500, endMs: 3100, text: 'That he gave.' },
                { startMs: 3100, endMs: 3200, text: '  ' },
            ],
        }, { now: T0 + 9000, provider: 'native', worshipMode: false })

        expect(a.getSnapshot().segments.map((s) => [s.text, s.startMs, s.endMs, s.source])).toEqual([
            ['For God so loved the world.', 1200, 2500, 'whisper'],
            ['That he gave.', 2500, 3100, 'whisper'],
        ])
        expect(a.getSnapshot().text).toBe('For God so loved the world. That he gave.')
    })

    it('an utterance delivered twice is not kept, but is still heard (it may carry a command)', () => {
        const a = assembler()
        a.take({ text: 'Next verse please.', isFinal: true }, { now: T0 + 1000, ...web })
        const out = a.take({ text: 'Next verse please.', isFinal: true }, { now: T0 + 2000, ...web })

        expect(out).toEqual({ kind: 'duplicate', chunk: 'Next verse please.', hear: 'Next verse please.', committed: true })
        expect(a.getSnapshot().segments).toHaveLength(1)
        expect(a.getSnapshot().rawUtterances).toHaveLength(1)
    })

    it('drops the start of an utterance that repeats the end of the last one', () => {
        const a = assembler()
        a.take({ text: 'For God so loved the world', isFinal: true }, { now: T0 + 1000, ...web })
        a.take({ text: 'so loved the world that he gave his only son', isFinal: true }, { now: T0 + 2000, ...web })
        expect(a.getSnapshot().text).toBe('For God so loved the world that he gave his only son')
    })

    it('keeps the last 200 utterances for review', () => {
        const a = assembler()
        for (let i = 0; i < 205; i++) a.take({ text: `utterance number ${i} here`, isFinal: true }, { now: T0 + i, ...web })
        const raw = a.getSnapshot().rawUtterances
        expect(raw).toHaveLength(200)
        expect(raw[0].text).toBe('utterance number 5 here')
    })

    it('restores a transcript after a reload and builds on it', () => {
        const a = assembler()
        a.restore({ text: 'Earlier words.', segments: [{ id: 'x', text: 'Earlier words.', startMs: 0, endMs: 1000, source: 'web-speech' }] })
        a.take({ text: 'Later words.', isFinal: true }, { now: T0 + 1000, ...web })
        expect(a.getSnapshot().text).toBe('Earlier words. Later words.')
        expect(a.getSnapshot().segments).toHaveLength(2)
    })

    it('notifies subscribers when the transcript changes', () => {
        const a = assembler()
        let calls = 0
        const unsubscribe = a.subscribe(() => { calls++ })
        a.take({ text: 'One.', isFinal: true }, { now: T0, ...web })
        a.clearInterim()
        unsubscribe()
        a.take({ text: 'Two words.', isFinal: true }, { now: T0, ...web })
        expect(calls).toBe(1)
    })
})

describe('cleaning', () => {
    it('collapses a short phrase said three or more times', () => {
        expect(cleanRepeatedPhrases('Okay. Okay. Okay. Let us pray.')).toBe('Okay. Let us pray.')
    })

    it('strips only an overlap of at least three words', () => {
        expect(stripOverlap('God so loved the world', 'For God so loved')).toBe('the world')
        expect(stripOverlap('God so loved the world', 'For God so')).toBe('God so loved the world')
    })
})
