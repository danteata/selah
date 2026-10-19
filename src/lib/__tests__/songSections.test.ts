import { describe, expect, it } from 'vitest'
import {
    songSlideBlocks,
    parseLyricsIntoSections,
    parseSectionLabel,
    buildDefaultArrangement,
    deriveSongStructure,
} from '../songSections'

describe('songSections', () => {
    describe('parseSectionLabel', () => {
        it('recognizes plain labels', () => {
            expect(parseSectionLabel('Chorus')).toEqual({ type: 'chorus', number: undefined })
            expect(parseSectionLabel('Bridge')).toEqual({ type: 'bridge', number: undefined })
        })

        it('recognizes numbered verses', () => {
            expect(parseSectionLabel('Verse 1')).toEqual({ type: 'verse', number: 1 })
            expect(parseSectionLabel('Verse 2')).toEqual({ type: 'verse', number: 2 })
        })

        it('recognizes shorthand and brackets', () => {
            expect(parseSectionLabel('V2')).toEqual({ type: 'verse', number: 2 })
            expect(parseSectionLabel('[Chorus]')).toEqual({ type: 'chorus', number: undefined })
            expect(parseSectionLabel('Verse 1:')).toEqual({ type: 'verse', number: 1 })
        })

        it('maps aliases', () => {
            expect(parseSectionLabel('Refrain')?.type).toBe('chorus')
            expect(parseSectionLabel('Pre-Chorus')?.type).toBe('prechorus')
            expect(parseSectionLabel('Outro')?.type).toBe('ending')
        })

        it('returns null for lyric lines', () => {
            expect(parseSectionLabel('Amazing grace how sweet the sound')).toBeNull()
            expect(parseSectionLabel('')).toBeNull()
        })
    })

    describe('parseLyricsIntoSections', () => {
        it('returns empty for empty input', () => {
            expect(parseLyricsIntoSections('')).toEqual([])
            expect(parseLyricsIntoSections('   \n  \n ')).toEqual([])
        })

        it('splits blank-line blocks into verses when unlabelled and unique', () => {
            const lyrics = [
                'Amazing grace how sweet the sound',
                'That saved a wretch like me',
                '',
                'I once was lost but now am found',
                'Was blind but now I see',
            ].join('\n')

            const sections = parseLyricsIntoSections(lyrics)
            expect(sections).toHaveLength(2)
            expect(sections[0]).toMatchObject({ id: 'v1', type: 'verse', number: 1 })
            expect(sections[0].lines).toEqual([
                'Amazing grace how sweet the sound',
                'That saved a wretch like me',
            ])
            expect(sections[1]).toMatchObject({ id: 'v2', type: 'verse', number: 2 })
        })

        it('honours explicit labels and numbering', () => {
            const lyrics = [
                'Verse 1',
                'line a',
                'line b',
                '',
                'Chorus',
                'hook a',
                'hook b',
                '',
                'Verse 2',
                'line c',
            ].join('\n')

            const sections = parseLyricsIntoSections(lyrics)
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1', 'v2'])
            expect(sections[1]).toMatchObject({ type: 'chorus', label: 'Chorus' })
            expect(sections[1].lines).toEqual(['hook a', 'hook b'])
        })

        it('collapses repeated identical blocks and reuses the section id', () => {
            const chorus = ['My chains are gone', 'I have been set free'].join('\n')
            const lyrics = [
                'Verse one line one\nVerse one line two',
                chorus,
                'Verse two line one\nVerse two line two',
                chorus,
            ].join('\n\n')

            const sections = parseLyricsIntoSections(lyrics)
            // v1, c1, v2 — the second chorus is collapsed into c1.
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1', 'v2'])
            expect(sections.find((s) => s.id === 'c1')?.type).toBe('chorus')
        })

        it('detects unlabelled repeated block as chorus', () => {
            const hook = 'hallelujah hallelujah'
            const lyrics = [hook, 'a verse line here', hook].join('\n\n')
            const sections = parseLyricsIntoSections(lyrics)
            expect(sections.find((s) => s.lines.join(' ') === hook)?.type).toBe('chorus')
        })

        it('is resilient to CRLF and extra blank lines', () => {
            const lyrics = 'Verse 1\r\nline a\r\n\r\n\r\nChorus\r\nhook'
            const sections = parseLyricsIntoSections(lyrics)
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1'])
        })
    })

    describe('deriveSongStructure', () => {
        it('uses labelled blocks from the migration parser when present', () => {
            const blocks = [
                { label: 'Verse 1', content: 'line a\nline b' },
                { label: 'Chorus', content: 'hook a\nhook b' },
                { label: 'Verse 2', content: 'line c\nline d' },
            ]
            const { sections, defaultArrangement } = deriveSongStructure('ignored freeform', blocks)
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1', 'v2'])
            expect(sections[1].type).toBe('chorus')
            expect(defaultArrangement).toEqual(['v1', 'c1', 'v2'])
        })

        it('falls back to freeform lyrics when blocks are empty/blank', () => {
            const { sections } = deriveSongStructure('Verse 1\nla la\n\nChorus\nna na', [
                { label: '', content: '  ' },
            ])
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1'])
        })

        it('collapses a chorus repeated across labelled blocks', () => {
            const blocks = [
                { label: 'Verse 1', content: 'v1 a\nv1 b' },
                { label: 'Chorus', content: 'same hook\nsame line' },
                { label: 'Verse 2', content: 'v2 a\nv2 b' },
                { label: 'Chorus', content: 'same hook\nsame line' },
            ]
            const { sections } = deriveSongStructure('', blocks)
            expect(sections.map((s) => s.id)).toEqual(['v1', 'c1', 'v2'])
        })

        it('keeps a labelled block whole across its slide breaks', () => {
            // EasyWorship leaves a blank line at each slide break inside a
            // verse. Splitting on it broke verses apart, mislabelled the
            // pieces and gave two sections the same id; a piece repeating a
            // line from elsewhere (a closing "declaring the word") vanished.
            const blocks = [
                { label: 'Verse 1', content: 'These are the days\n\nDeclaring the word' },
                { label: 'Verse 2', content: 'And these are the days\nof your servant\n\nBeing restored' },
                { label: 'Verse 3', content: 'Still we are the labourers\n\ndeclaring the word' },
            ]
            const { sections, defaultArrangement } = deriveSongStructure('', blocks)
            expect(sections.map((s) => s.id)).toEqual(['v1', 'v2', 'v3'])
            expect(sections[0].lines).toEqual(['These are the days', 'Declaring the word'])
            expect(sections[2].lines).toEqual(['Still we are the labourers', 'declaring the word'])
            expect(defaultArrangement).toEqual(['v1', 'v2', 'v3'])
        })

        it('splits a song that came as one block at its slide breaks', () => {
            // No "Slide N" grouping in the source, only a break after each
            // slide: those breaks are the structure. Keeping the block whole
            // made 1,577 of 2,791 imported songs a single slide.
            const { sections } = deriveSongStructure('', [
                { label: '', content: 'First slide line\n\nSecond slide line\n\nThird slide line' },
            ])
            expect(sections.map((s) => s.lines)).toEqual([['First slide line'], ['Second slide line'], ['Third slide line']])
        })

        it('never gives two sections the same id', () => {
            const blocks = [
                { label: 'Verse 1', content: 'one' },
                { label: 'Verse 1', content: 'two' },
                { label: '', content: 'three' },
            ]
            const ids = deriveSongStructure('', blocks).sections.map((s) => s.id)
            expect(new Set(ids).size).toBe(ids.length)
        })
    })

    describe('buildDefaultArrangement', () => {
        it('lists each section id once in order', () => {
            const sections = parseLyricsIntoSections('Verse 1\na\n\nChorus\nb\n\nVerse 2\nc')
            expect(buildDefaultArrangement(sections)).toEqual(['v1', 'c1', 'v2'])
        })
    })
})

describe('songSlideBlocks', () => {
    const V1 = 'Amazing grace how sweet the sound\nThat saved a wretch like me'
    const C = 'My chains are gone\nI have been set free'
    const V2 = 'Twas grace that taught my heart to fear\nAnd grace my fears relieved'

    it('names each block for its section, a repeated chorus included', () => {
        const verses = [V1, C, V2, C]
        const blocks = songSlideBlocks({ lyrics: verses.join('\n\n'), verses })
        expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus'])
        expect(blocks.map((b) => b.sectionId)).toEqual(['v1', 'c1', 'v2', 'c1'])
        expect(blocks[1].text).toBe(C)
    })

    it('takes a heading line out of the words', () => {
        const blocks = songSlideBlocks({ lyrics: `Verse 1\n${V1}\n\nChorus\n${C}` })
        expect(blocks).toEqual([
            // One verse: the parser names it plainly, as it does a lone chorus.
            { text: V1, label: 'Verse', sectionId: 'v1' },
            { text: C, label: 'Chorus', sectionId: 'c1' },
        ])
    })

    it('makes a heading on its own the section it names, and drops one naming nothing', () => {
        const lyrics = `Verse 1\n${V1}\n\nChorus\n${C}\n\nVerse 2\n${V2}\n\nChorus\n\nBridge`
        const blocks = songSlideBlocks({ lyrics, verses: lyrics.split('\n\n') })
        expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus'])
        expect(blocks[3]).toEqual({ text: C, label: 'Chorus', sectionId: 'c1' })
    })

    it('reads the blocks a song was already split into', () => {
        const blocks = songSlideBlocks({ lyrics: '', verses: [`Chorus\n${C}`, V1] })
        expect(blocks.map((b) => [b.label, b.text])).toEqual([['Chorus', C], ['Verse', V1]])
    })
})
