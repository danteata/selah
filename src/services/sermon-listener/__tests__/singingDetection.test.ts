import { describe, it, expect } from 'vitest'
import { looksLikeSinging } from '../singingDetection'

describe('looksLikeSinging', () => {
    it('rejects empty or whitespace-only text', () => {
        expect(looksLikeSinging('')).toBe(false)
        expect(looksLikeSinging('   ')).toBe(false)
    })

    it('accepts plain worship lyrics', () => {
        expect(looksLikeSinging('Amazing grace how sweet the sound that saved a wretch like me')).toBe(true)
        expect(looksLikeSinging('Here I am to worship here I am to bow down')).toBe(true)
        expect(looksLikeSinging('My heart my mind my soul belongs to you')).toBe(true)
        expect(looksLikeSinging('Lift your praises to the Lord and let all sing')).toBe(true)
    })

    it('accepts real hymn/chorus lines that use words easily mistaken for narrative markers', () => {
        // Regression: an earlier version flagged bare "say"/"tell"/"because" as
        // strong narrative markers, which silently blocks well-known lyrics
        // that use those words in non-narrative (declarative/imperative) form.
        expect(looksLikeSinging('Because He lives I can face tomorrow')).toBe(true)
        expect(looksLikeSinging('Go tell it on the mountain that Jesus Christ is born')).toBe(true)
        expect(looksLikeSinging('Here I am to say that you are my God')).toBe(true)
    })

    it('rejects text containing figures (money, ages, dates) — near-unique to spoken narrative', () => {
        expect(looksLikeSinging('watches above 100,000 dollars')).toBe(false)
        expect(looksLikeSinging('I was about 12 13 years old')).toBe(false)
        expect(looksLikeSinging('he was 90 years old when he died peacefully')).toBe(false)
    })

    it('rejects text with reported-speech narrative markers', () => {
        expect(looksLikeSinging('and he said to me I was just joking')).toBe(false)
        expect(looksLikeSinging('so Job said because of that this is their attitude')).toBe(false)
        expect(looksLikeSinging('so I told the guy I want to buy it')).toBe(false)
    })

    it('tolerates a single incidental weak marker in an otherwise clean lyric window', () => {
        expect(looksLikeSinging('we lift our praises to you today oh Lord')).toBe(true)
    })

    it('rejects a cluster of weak markers even without a strong one', () => {
        expect(looksLikeSinging('remember yesterday and today and tomorrow we will praise your name')).toBe(false)
    })

    it('rejects real excerpts from a spoken sermon transcript', () => {
        expect(looksLikeSinging(
            'Everybody in glasses said, miss the educated, he started killing the people in glasses',
        )).toBe(false)
        expect(looksLikeSinging(
            'so I told the guy I want to buy the four hundred and fifty thousand',
        )).toBe(false)
        expect(looksLikeSinging(
            'my pastor went and bought a watch for $50,000',
        )).toBe(false)
    })

    it('is not a full classifier — a narrative window with none of the chosen signals can still pass', () => {
        // Known limitation, not a regression: without digits or a reporting
        // verb, a plain narrative sentence slips through the pre-gate. It's
        // still very unlikely to survive identifySong's separate shared-word/
        // coverage thresholds against any real song in the library.
        expect(looksLikeSinging('Last week I was in London with my wife we went to a place to Harrod')).toBe(true)
        // Likewise, "say" in reported speech (e.g. reading a Bible verse
        // aloud) isn't flagged, since "say" is also common in real lyrics
        // ("the angels did say", "say that you are my God").
        expect(looksLikeSinging('let no man say when he is tempted')).toBe(true)
    })
})
