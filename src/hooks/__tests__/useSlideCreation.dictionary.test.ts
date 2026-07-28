import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
    useSlideCreation,
    chunkDefinitionText,
    buildDictionaryLabel,
    buildDictionaryContents,
    generateSlideName,
    DEFINITION_CHARS_PER_SLIDE,
} from '../useSlideCreation'
import type { Slide, DictionaryEntry, DictionaryPack } from '../../types'

const mockSettings = {
    appVersion: '1.0.0',
    defaultBibleVersion: 'KJV',
    defaultFont: 'Inter',
    defaultBackground: {
        default: { backgroundType: 'image', background: 'test.jpg', backgroundVideoKey: null },
        text: { backgroundType: 'image', background: 'text-bg.jpg', backgroundVideoKey: null },
        bible: { backgroundType: 'image', background: 'bible-bg.jpg', backgroundVideoKey: null },
        hymn: { backgroundType: 'image', background: 'hymn-bg.jpg', backgroundVideoKey: null },
    },
    slideStyles: {
        alignment: 'center',
        fontSizePercent: 100,
        lettercase: '',
        lineSpacing: 'normal',
        textOutlined: false,
    },
    bibleVersions: [],
    songAndHymnLabelsVisibility: true,
    defaultTemplates: {} as Record<string, string | null>,
}

let mockActiveSlides: Slide[] = []

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector?: (state: unknown) => unknown) => {
        const state = {
            activeSlides: mockActiveSlides,
            settings: mockSettings,
            activeSchedule: { _id: 'schedule-1' },
            appendActiveSlide: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../useTemplates', () => ({
    useTemplates: () => ({ templates: [], getTemplate: () => null }),
}))

const EASTON: DictionaryPack = {
    id: 'easton',
    name: "Easton's Bible Dictionary",
    shortName: "Easton's",
    kind: 'bible',
    year: '1897',
    entryCount: 3961,
    shards: ['a'],
    license: 'CC BY 4.0',
    attribution: "Easton's Bible Dictionary (1897), public domain.",
}

const GREEK: DictionaryPack = {
    ...EASTON,
    id: 'strongs-greek',
    name: "Strong's Greek Dictionary",
    shortName: 'Greek',
    kind: 'lexicon',
}

const AARON: DictionaryEntry = {
    key: 'AARON',
    word: 'Aaron',
    packId: 'easton',
    senses: [{ text: 'The eldest son of Amram and Jochebed.' }],
    refs: ['Exodus 4:14', 'Hebrews 12:2'],
}

const AGAPE: DictionaryEntry = {
    key: 'G26',
    word: 'ἀγάπη',
    packId: 'strongs-greek',
    senses: [
        { text: 'love, i.e. affection or benevolence' },
        { text: '(feast of) charity, dear, love', label: 'KJV usage' },
    ],
    transliteration: 'agápē',
    lemma: 'ἀγάπη',
    strongs: 'G26',
}

describe('chunkDefinitionText', () => {
    it('keeps a short definition on one slide', () => {
        expect(chunkDefinitionText('A short definition.')).toEqual(['A short definition.'])
    })

    it('collapses the whitespace that survives XML extraction', () => {
        expect(chunkDefinitionText('  spaced   out\n text ')).toEqual(['spaced out text'])
    })

    it('returns nothing for empty text', () => {
        expect(chunkDefinitionText('')).toEqual([])
        expect(chunkDefinitionText('   ')).toEqual([])
    })

    it('splits a long definition at sentence boundaries', () => {
        const sentence = 'This is a complete sentence about the priesthood of Aaron and his sons. '
        const chunks = chunkDefinitionText(sentence.repeat(6), 200)

        expect(chunks.length).toBeGreaterThan(1)
        // Nothing is dropped and no chunk ends mid-sentence.
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(200)
            expect(chunk.endsWith('.')).toBe(true)
        }
    })

    it('preserves every word when splitting', () => {
        const text = Array.from({ length: 40 }, (_, i) => `word${i} is here.`).join(' ')
        const rejoined = chunkDefinitionText(text, 120).join(' ')
        expect(rejoined.replace(/\s+/g, ' ')).toBe(text)
    })

    it('breaks an over-long single sentence without cutting a word in half', () => {
        const text = `${'alpha beta gamma delta '.repeat(30)}end`
        const chunks = chunkDefinitionText(text, 100)

        expect(chunks.length).toBeGreaterThan(1)
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(100)
        }
        // Every token is still a whole word from the source.
        const words = new Set(text.split(/\s+/))
        for (const word of chunks.join(' ').split(/\s+/)) {
            expect(words.has(word)).toBe(true)
        }
    })

    it('defaults to a projector-readable budget', () => {
        const chunks = chunkDefinitionText('Sentence text here. '.repeat(60))
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(DEFINITION_CHARS_PER_SLIDE)
        }
    })
})

describe('buildDictionaryLabel', () => {
    it('shows the headword and the pack it came from', () => {
        const label = buildDictionaryLabel(AARON, EASTON)
        expect(label).toContain('<b>Aaron</b>')
        expect(label).toContain("Easton's")
    })

    it('adds the transliteration and Strong\'s number for a lexicon entry', () => {
        const label = buildDictionaryLabel(AGAPE, GREEK)
        expect(label).toContain('<b>ἀγάπη</b>')
        expect(label).toContain('agápē')
        expect(label).toContain('G26')
    })

    it('omits the source when no pack is known', () => {
        const label = buildDictionaryLabel(AARON)
        expect(label).toContain('<b>Aaron</b>')
        expect(label).not.toContain('dictionary-source')
    })
})

describe('buildDictionaryContents', () => {
    it('puts the definition in the body and the headword in the caption', () => {
        const [body, caption] = buildDictionaryContents(AARON, 'The eldest son.', EASTON)
        expect(body).toBe('<p class="dictionary-definition">The eldest son.</p>')
        expect(caption).toContain('dictionary-label')
    })
})

describe('generateSlideName', () => {
    it('names a dictionary slide after the word it defines', () => {
        expect(generateSlideName({ type: 'dictionary', title: 'Aaron' } as Slide))
            .toBe('Define: Aaron')
    })

    it('falls back when there is no headword', () => {
        expect(generateSlideName({ type: 'dictionary' } as Slide)).toBe('Definition')
    })
})

describe('useSlideCreation — dictionary slides', () => {
    beforeEach(() => {
        mockActiveSlides = []
        mockSettings.defaultTemplates = {}
    })

    it('creates a dictionary slide that renders through the captioned path', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slide = result.current.createDictionarySlide(AARON, 'The eldest son.', { pack: EASTON })

        expect(slide.type).toBe('dictionary')
        // The bible layout is what gives the caption its own zone on screen.
        expect(slide.layout).toBe('bible')
        expect(slide.title).toBe('Aaron')
        expect(slide.name).toBe('Define: Aaron')
        expect(slide.contents[0]).toContain('The eldest son.')
        expect(slide.contents[1]).toContain('<b>Aaron</b>')
        expect(slide.data).toEqual(AARON)
    })

    it('inherits the scripture background so definitions match verses', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slide = result.current.createDictionarySlide(AARON, 'Text.', { pack: EASTON })

        expect(slide.background).toBe('test.jpg')
    })

    it('creates one slide per sense', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slides = result.current.createDictionarySlides(AGAPE, { pack: GREEK })

        expect(slides).toHaveLength(2)
        expect(slides[0].contents[0]).toContain('affection or benevolence')
        expect(slides[1].contents[0]).toContain('charity')
    })

    it('labels the parts when a definition spans several slides', () => {
        const { result } = renderHook(() => useSlideCreation())
        const long: DictionaryEntry = {
            ...AARON,
            senses: [{ text: 'A long sentence about the high priest. '.repeat(20) }],
        }
        const slides = result.current.createDictionarySlides(long, { pack: EASTON })

        expect(slides.length).toBeGreaterThan(1)
        expect(slides[0].name).toBe(`Define: Aaron (1/${slides.length})`)
        expect(slides[0].verseLabel).toBe(`Part 1 of ${slides.length}`)
        expect(slides[0].totalVerses).toBe(slides.length)
    })

    it('narrows to a single sense when asked', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slides = result.current.createDictionarySlides(AGAPE, { pack: GREEK, senseIndex: 1 })

        expect(slides).toHaveLength(1)
        expect(slides[0].contents[0]).toContain('charity')
    })

    it('gives every slide of a multi-part definition a distinct id', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slides = result.current.createDictionarySlides({
            ...AARON,
            senses: [{ text: 'Sentence one about him. '.repeat(30) }],
        }, { pack: EASTON })

        const ids = new Set(slides.map((slide) => slide.id))
        expect(ids.size).toBe(slides.length)
    })

    it('produces no slides for an entry with empty text', () => {
        const { result } = renderHook(() => useSlideCreation())
        const slides = result.current.createDictionarySlides({ ...AARON, senses: [{ text: '  ' }] })

        expect(slides).toEqual([])
    })
})
