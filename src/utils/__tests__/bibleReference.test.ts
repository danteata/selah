import { describe, it, expect } from 'vitest'
import {
    parseBibleQuery,
    resolveBookName,
    getBookSuggestions,
    bookAbbreviations,
    buildVerseRows,
} from '../bibleReference'
import { bibleBooks } from '../../types'

describe('resolveBookName', () => {
    it('resolves full book names', () => {
        expect(resolveBookName('Genesis')).toEqual({ bookIndex: 1, bookName: 'Genesis' })
        expect(resolveBookName('John')).toEqual({ bookIndex: 43, bookName: 'John' })
        expect(resolveBookName('Revelation')).toEqual({ bookIndex: 66, bookName: 'Revelation' })
    })

    it('resolves common abbreviations', () => {
        expect(resolveBookName('gen')).toEqual({ bookIndex: 1, bookName: 'Genesis' })
        expect(resolveBookName('jn')).toEqual({ bookIndex: 43, bookName: 'John' })
        expect(resolveBookName('ps')).toEqual({ bookIndex: 19, bookName: 'Psalms' })
        expect(resolveBookName('rev')).toEqual({ bookIndex: 66, bookName: 'Revelation' })
        expect(resolveBookName('mt')).toEqual({ bookIndex: 40, bookName: 'Matthew' })
    })

    it('resolves numbered book abbreviations', () => {
        expect(resolveBookName('1sam')).toEqual({ bookIndex: 9, bookName: '1 Samuel' })
        expect(resolveBookName('2cor')).toEqual({ bookIndex: 47, bookName: '2 Corinthians' })
        expect(resolveBookName('3jn')).toEqual({ bookIndex: 64, bookName: '3 John' })
        expect(resolveBookName('1ki')).toEqual({ bookIndex: 11, bookName: '1 Kings' })
        expect(resolveBookName('2tim')).toEqual({ bookIndex: 55, bookName: '2 Timothy' })
    })

    it('resolves partial book names (startsWith)', () => {
        expect(resolveBookName('Gen')).toEqual({ bookIndex: 1, bookName: 'Genesis' })
        expect(resolveBookName('Exo')).toEqual({ bookIndex: 2, bookName: 'Exodus' })
        expect(resolveBookName('Mat')).toEqual({ bookIndex: 40, bookName: 'Matthew' })
    })

    it('is case insensitive', () => {
        expect(resolveBookName('GENESIS')).toEqual({ bookIndex: 1, bookName: 'Genesis' })
        expect(resolveBookName('john')).toEqual({ bookIndex: 43, bookName: 'John' })
        expect(resolveBookName('1SAM')).toEqual({ bookIndex: 9, bookName: '1 Samuel' })
    })

    it('returns null for unknown input', () => {
        expect(resolveBookName('xyz')).toBeNull()
        expect(resolveBookName('')).toBeNull()
        expect(resolveBookName('99')).toBeNull()
    })

    it('handles alternative abbreviations for same book', () => {
        const johnVariants = ['jn', 'joh']
        for (const v of johnVariants) {
            expect(resolveBookName(v)?.bookName).toBe('John')
        }
        const mattVariants = ['mt', 'matt']
        for (const v of mattVariants) {
            expect(resolveBookName(v)?.bookName).toBe('Matthew')
        }
    })

    it('resolves all 66 books by their full name', () => {
        for (let i = 0; i < bibleBooks.length; i++) {
            const result = resolveBookName(bibleBooks[i])
            expect(result).not.toBeNull()
            expect(result!.bookIndex).toBe(i + 1)
            expect(result!.bookName).toBe(bibleBooks[i])
        }
    })
})

describe('parseBibleQuery', () => {
    describe('full pattern: "BookName Chapter:Verse"', () => {
        it('parses standard single verse reference', () => {
            const result = parseBibleQuery('John 3:16')
            expect(result).toEqual({
                bookIndex: 43,
                bookName: 'John',
                chapter: 3,
                startVerse: 16,
                endVerse: 16,
            })
        })

        it('parses verse range', () => {
            const result = parseBibleQuery('John 3:16-18')
            expect(result).toEqual({
                bookIndex: 43,
                bookName: 'John',
                chapter: 3,
                startVerse: 16,
                endVerse: 18,
            })
        })

        it('parses Psalms references', () => {
            expect(parseBibleQuery('Psalm 23:1')).toEqual({
                bookIndex: 19, bookName: 'Psalms', chapter: 23, startVerse: 1, endVerse: 1,
            })
            expect(parseBibleQuery('Ps 119:105')).toEqual({
                bookIndex: 19, bookName: 'Psalms', chapter: 119, startVerse: 105, endVerse: 105,
            })
        })

        it('parses abbreviated book names', () => {
            expect(parseBibleQuery('Gen 1:1')).toEqual({
                bookIndex: 1, bookName: 'Genesis', chapter: 1, startVerse: 1, endVerse: 1,
            })
            expect(parseBibleQuery('Jn 3:16')).toEqual({
                bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 16,
            })
            expect(parseBibleQuery('Rev 22:21')).toEqual({
                bookIndex: 66, bookName: 'Revelation', chapter: 22, startVerse: 21, endVerse: 21,
            })
        })

        it('parses numbered books with abbreviations', () => {
            expect(parseBibleQuery('1 John 2:3')).toEqual({
                bookIndex: 62, bookName: '1 John', chapter: 2, startVerse: 3, endVerse: 3,
            })
            expect(parseBibleQuery('2 Cor 5:17')).toEqual({
                bookIndex: 47, bookName: '2 Corinthians', chapter: 5, startVerse: 17, endVerse: 17,
            })
            expect(parseBibleQuery('3 Jn 1:4')).toEqual({
                bookIndex: 64, bookName: '3 John', chapter: 1, startVerse: 4, endVerse: 4,
            })
        })

        it('parses numbered books with full names', () => {
            expect(parseBibleQuery('1 Samuel 16:7')).toEqual({
                bookIndex: 9, bookName: '1 Samuel', chapter: 16, startVerse: 7, endVerse: 7,
            })
            expect(parseBibleQuery('2 Kings 5:1')).toEqual({
                bookIndex: 12, bookName: '2 Kings', chapter: 5, startVerse: 1, endVerse: 1,
            })
        })
    })

    describe('numeric pattern: "BookIndex:Chapter:Verse"', () => {
        it('parses numeric reference', () => {
            expect(parseBibleQuery('43:3:16')).toEqual({
                bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 16,
            })
        })

        it('parses numeric reference with range', () => {
            expect(parseBibleQuery('43:3:16-18')).toEqual({
                bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 18,
            })
        })

        it('parses Genesis numeric reference', () => {
            expect(parseBibleQuery('1:1:1')).toEqual({
                bookIndex: 1, bookName: 'Genesis', chapter: 1, startVerse: 1, endVerse: 1,
            })
        })

        it('returns null for out-of-range book index', () => {
            expect(parseBibleQuery('99:1:1')).toBeNull()
            expect(parseBibleQuery('0:1:1')).toBeNull()
        })
    })

    describe('edge cases', () => {
        it('returns null for empty input', () => {
            expect(parseBibleQuery('')).toBeNull()
            expect(parseBibleQuery('   ')).toBeNull()
        })

        it('returns null for partial input', () => {
            expect(parseBibleQuery('John')).toBeNull()
            expect(parseBibleQuery('John 3')).toBeNull()
        })

        it('returns null for unknown book', () => {
            expect(parseBibleQuery('XYZ 1:1')).toBeNull()
        })

        it('handles case insensitivity', () => {
            const lower = parseBibleQuery('john 3:16')
            const upper = parseBibleQuery('JOHN 3:16')
            expect(lower).toEqual(upper)
        })

        it('handles whitespace trimming', () => {
            expect(parseBibleQuery('  John 3:16  ')).toEqual(parseBibleQuery('John 3:16'))
        })

        it('sets endVerse equal to startVerse when no range', () => {
            const result = parseBibleQuery('Romans 8:28')
            expect(result?.startVerse).toBe(28)
            expect(result?.endVerse).toBe(28)
        })

        it('handles large verse numbers', () => {
            expect(parseBibleQuery('Psalm 119:176')).toEqual({
                bookIndex: 19, bookName: 'Psalms', chapter: 119, startVerse: 176, endVerse: 176,
            })
        })
    })

    describe('all abbreviation variants produce correct bookIndex', () => {
        const criticalBooks: [string, number, string][] = [
            ['gen', 1, 'Genesis'],
            ['ex', 2, 'Exodus'],
            ['ps', 19, 'Psalms'],
            ['pr', 20, 'Proverbs'],
            ['mt', 40, 'Matthew'],
            ['mk', 41, 'Mark'],
            ['lk', 42, 'Luke'],
            ['jn', 43, 'John'],
            ['act', 44, 'Acts'],
            ['rom', 45, 'Romans'],
            ['rev', 66, 'Revelation'],
        ]

        for (const [abbr, expectedIdx, expectedName] of criticalBooks) {
            it(`resolves "${abbr}" to ${expectedName} (${expectedIdx})`, () => {
                const result = parseBibleQuery(`${abbr} 1:1`)
                expect(result?.bookIndex).toBe(expectedIdx)
                expect(result?.bookName).toBe(expectedName)
            })
        }
    })
})

describe('getBookSuggestions', () => {
    it('returns exact abbreviation match as single entry', () => {
        expect(getBookSuggestions('jn')).toEqual(['John'])
        expect(getBookSuggestions('gen')).toEqual(['Genesis'])
    })

    it('returns books starting with query', () => {
        const result = getBookSuggestions('Jo')
        expect(result).toContain('Joshua')
        expect(result).toContain('Joel')
        expect(result).toContain('Job')
        expect(result).toContain('John')
    })

    it('returns empty for empty query', () => {
        expect(getBookSuggestions('')).toEqual([])
    })

    it('returns empty when query contains colon', () => {
        expect(getBookSuggestions('John 3:')).toEqual([])
        expect(getBookSuggestions('3:16')).toEqual([])
    })

    it('matches partial book names', () => {
        const result = getBookSuggestions('Rom')
        expect(result).toContain('Romans')
    })

    it('limits to 5 suggestions', () => {
        const result = getBookSuggestions('1')
        expect(result.length).toBeLessThanOrEqual(5)
    })

    it('is case insensitive', () => {
        expect(getBookSuggestions('GEN')).toEqual(getBookSuggestions('gen'))
    })

    it('finds books containing the query, not just starting with it', () => {
        const result = getBookSuggestions('chron')
        expect(result.some(b => b.includes('Chronicles'))).toBe(true)
    })
})

describe('bookAbbreviations', () => {
    it('maps every value to a valid bibleBooks entry', () => {
        for (const [abbr, bookName] of Object.entries(bookAbbreviations)) {
            expect(bibleBooks).toContain(bookName)
        }
    })

    it('has no empty string keys or values', () => {
        for (const [key, val] of Object.entries(bookAbbreviations)) {
            expect(key.length).toBeGreaterThan(0)
            expect(val.length).toBeGreaterThan(0)
        }
    })

    it('has all keys in lowercase', () => {
        for (const key of Object.keys(bookAbbreviations)) {
            expect(key).toBe(key.toLowerCase())
        }
    })

    it('covers all 66 books as values', () => {
        const uniqueBooks = new Set(Object.values(bookAbbreviations))
        expect(uniqueBooks.size).toBe(66)
    })
})

describe('buildVerseRows', () => {
    it('returns empty rows when no search and no semantic results', () => {
        expect(buildVerseRows(false, null, null, [], { prev: [], next: [] }, [])).toEqual([])
    })

    it('returns semantic results when hasSearched is false', () => {
        const semanticResults = [
            { bookNumber: 44, chapter: 3, verse: 16, text: 'For God so loved...', reference: 'John 3:16', score: 0.95 },
        ]
        const rows = buildVerseRows(false, null, null, [], { prev: [], next: [] }, semanticResults)
        expect(rows).toHaveLength(1)
        expect(rows[0].source).toBe('semantic')
        expect(rows[0].isCurrent).toBe(false)
        expect(rows[0].score).toBe(0.95)
        expect(rows[0].scripture).toBe('For God so loved...')
    })

    it('returns reference results when hasSearched is true', () => {
        const currentVerses = [
            { chapter: 3, verse: 16, scripture: 'For God so loved the world...' },
        ]
        const rows = buildVerseRows(true, 43, 3, currentVerses, { prev: [], next: [] }, [])
        expect(rows).toHaveLength(1)
        expect(rows[0].source).toBe('reference')
        expect(rows[0].isCurrent).toBe(true)
        expect(rows[0].reference).toBe('John 3:16')
    })

    it('combines neighbors and current verses in order: prev, current, next', () => {
        const prev = [
            { chapter: 3, verse: 14, scripture: 'Prev 14' },
            { chapter: 3, verse: 15, scripture: 'Prev 15' },
        ]
        const current = [
            { chapter: 3, verse: 16, scripture: 'Current 16' },
        ]
        const next = [
            { chapter: 3, verse: 17, scripture: 'Next 17' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev, next }, [])
        expect(rows).toHaveLength(4)
        expect(rows[0].verse).toBe(14)
        expect(rows[0].isCurrent).toBe(false)
        expect(rows[0].source).toBe('neighbor')
        expect(rows[1].verse).toBe(15)
        expect(rows[1].isCurrent).toBe(false)
        expect(rows[2].verse).toBe(16)
        expect(rows[2].isCurrent).toBe(true)
        expect(rows[2].source).toBe('reference')
        expect(rows[3].verse).toBe(17)
        expect(rows[3].isCurrent).toBe(false)
        expect(rows[3].source).toBe('neighbor')
    })

    it('shows chapter header when neighbor crosses into different chapter', () => {
        const prev = [
            { chapter: 2, verse: 25, scripture: 'End of chapter 2' },
        ]
        const current = [
            { chapter: 3, verse: 1, scripture: 'Start of chapter 3' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev, next: [] }, [])
        expect(rows).toHaveLength(2)
        expect(rows[0].showChapterHeader).toBe(false)
        expect(rows[0].chapterHeaderLabel).toBe('John 2')
        expect(rows[1].showChapterHeader).toBe(true)
        expect(rows[1].chapterHeaderLabel).toBe('')
    })

    it('does not show chapter header when all verses are same chapter', () => {
        const prev = [
            { chapter: 3, verse: 14, scripture: 'same chapter' },
        ]
        const current = [
            { chapter: 3, verse: 16, scripture: 'same chapter' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev, next: [] }, [])
        expect(rows[0].showChapterHeader).toBe(false)
        expect(rows[0].chapterHeaderLabel).toBe('')
    })

    it('ignores semantic results when hasSearched is true', () => {
        const semanticResults = [
            { bookNumber: 43, chapter: 3, verse: 16, text: 'semantic result', reference: 'John 3:16', score: 0.9 },
        ]
        const current = [
            { chapter: 3, verse: 16, scripture: 'reference result' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev: [], next: [] }, semanticResults)
        expect(rows).toHaveLength(1)
        expect(rows[0].source).toBe('reference')
        expect(rows[0].scripture).toBe('reference result')
    })

    it('handles multiple current verses', () => {
        const current = [
            { chapter: 3, verse: 16, scripture: 'Verse 16' },
            { chapter: 3, verse: 17, scripture: 'Verse 17' },
            { chapter: 3, verse: 18, scripture: 'Verse 18' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev: [], next: [] }, [])
        expect(rows).toHaveLength(3)
        expect(rows.every(r => r.isCurrent)).toBe(true)
        expect(rows[0].verse).toBe(16)
        expect(rows[1].verse).toBe(17)
        expect(rows[2].verse).toBe(18)
    })

    it('handles next verses crossing into next chapter', () => {
        const current = [
            { chapter: 3, verse: 36, scripture: 'Last verse' },
        ]
        const next = [
            { chapter: 4, verse: 1, scripture: 'First of next chapter' },
            { chapter: 4, verse: 2, scripture: 'Second of next chapter' },
        ]
        const rows = buildVerseRows(true, 43, 3, current, { prev: [], next }, [])
        expect(rows).toHaveLength(3)
        expect(rows[0].verse).toBe(36)
        expect(rows[0].chapter).toBe(3)
        expect(rows[1].chapter).toBe(4)
        expect(rows[1].showChapterHeader).toBe(true)
        expect(rows[1].chapterHeaderLabel).toBe('John 4')
    })

    it('builds correct reference strings', () => {
        const current = [
            { chapter: 23, verse: 1, scripture: 'The Lord is my shepherd' },
        ]
        const rows = buildVerseRows(true, 19, 23, current, { prev: [], next: [] }, [])
        expect(rows[0].reference).toBe('Psalms 23:1')
    })
})