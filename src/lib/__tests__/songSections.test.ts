import { describe, expect, it } from 'vitest'
import {
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
    })

    describe('buildDefaultArrangement', () => {
        it('lists each section id once in order', () => {
            const sections = parseLyricsIntoSections('Verse 1\na\n\nChorus\nb\n\nVerse 2\nc')
            expect(buildDefaultArrangement(sections)).toEqual(['v1', 'c1', 'v2'])
        })
    })
})
