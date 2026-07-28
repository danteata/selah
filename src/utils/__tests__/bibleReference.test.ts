import { describe, it, expect } from 'vitest'
import {
    parseBibleQuery,
    parseFullBibleReference,
    resolveEnterAction,
    resolveBookName,
    getBookSuggestions,
    getRankedBookSuggestions,
    stepChapter,
    stepBook,
    clampVerse,
    formatReferenceQuery,
    bookAbbreviations,
    buildVerseRows,
    normalizeBibleReference,
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

        it('tolerates trailing punctuation from voice dictation', () => {
            // Speech recognition often appends "." — must still parse.
            expect(parseBibleQuery('John 3:16.')).toEqual({
                bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 16,
            })
            expect(parseBibleQuery('John 3:16-18.')).toEqual({
                bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 18,
            })
            expect(parseBibleQuery('Gen 1:1?')?.bookName).toBe('Genesis')
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

describe('getRankedBookSuggestions', () => {
    it('returns [] for empty or colon-bearing input', () => {
        expect(getRankedBookSuggestions('')).toEqual([])
        expect(getRankedBookSuggestions('John 3:')).toEqual([])
    })

    it('ranks an exact abbreviation first', () => {
        const r = getRankedBookSuggestions('jn')
        expect(r[0].book).toBe('John')
        expect(r[0].matchType).toBe('abbrev')
        expect(r[0].bookIndex).toBe(43)
    })

    it('returns prefix matches in canonical order before fuzzier hits', () => {
        const books = getRankedBookSuggestions('jo').map(s => s.book)
        // Job (18), Joel (29), John (43), Jonah (32), Joshua (6) all start
        // with "jo"; canonical order is Joshua, Job, Joel, Jonah, John.
        expect(books).toContain('Joshua')
        expect(books).toContain('Job')
        expect(books).toContain('John')
        const prefixMatches = getRankedBookSuggestions('jo').filter(s => s.matchType === 'prefix')
        const indexes = prefixMatches.map(s => s.bookIndex)
        expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    })

    it('falls back to fuzzy matching for non-prefix queries', () => {
        const books = getRankedBookSuggestions('corin').map(s => s.book)
        expect(books.some(b => b.includes('Corinthians'))).toBe(true)
    })

    it('respects the limit', () => {
        expect(getRankedBookSuggestions('a', 3).length).toBeLessThanOrEqual(3)
    })

    it('never returns duplicate books', () => {
        const r = getRankedBookSuggestions('jo')
        const ids = r.map(s => s.bookIndex)
        expect(new Set(ids).size).toBe(ids.length)
    })
})

describe('stepChapter', () => {
    it('steps within a book', () => {
        expect(stepChapter(43, 3, 1)).toEqual({ bookIndex: 43, chapter: 4 })
        expect(stepChapter(43, 3, -1)).toEqual({ bookIndex: 43, chapter: 2 })
        expect(stepChapter(43, 3, 2)).toEqual({ bookIndex: 43, chapter: 5 })
    })

    it('rolls forward into the next book past the last chapter', () => {
        // John has 21 chapters → +1 lands on Acts 1.
        expect(stepChapter(43, 21, 1)).toEqual({ bookIndex: 44, chapter: 1 })
    })

    it('rolls backward into the previous book before chapter 1', () => {
        // John 1 → prev is Luke 24 (Luke has 24 chapters).
        expect(stepChapter(43, 1, -1)).toEqual({ bookIndex: 42, chapter: 24 })
    })

    it('stops at the very start and end of the canon', () => {
        expect(stepChapter(1, 1, -1)).toEqual({ bookIndex: 1, chapter: 1 })
        expect(stepChapter(66, 22, 1)).toEqual({ bookIndex: 66, chapter: 22 })
    })
})

describe('stepBook', () => {
    it('steps and clamps to the 66-book canon', () => {
        expect(stepBook(43, 1)).toBe(44)
        expect(stepBook(1, -1)).toBe(1)
        expect(stepBook(66, 1)).toBe(66)
    })
})

describe('clampVerse', () => {
    it('never goes below 1', () => {
        expect(clampVerse(0)).toBe(1)
        expect(clampVerse(-5)).toBe(1)
    })

    it('caps at the highest loaded verse when provided', () => {
        expect(clampVerse(10, [1, 2, 3, 5])).toBe(5)
        expect(clampVerse(3, [1, 2, 3, 5])).toBe(3)
    })

    it('leaves the verse alone with no bound', () => {
        expect(clampVerse(42)).toBe(42)
    })
})

describe('formatReferenceQuery', () => {
    it('formats a single verse', () => {
        expect(formatReferenceQuery(43, 3, 16)).toBe('John 3:16')
    })

    it('formats a verse range', () => {
        expect(formatReferenceQuery(43, 3, 16, 18)).toBe('John 3:16-18')
    })

    it('omits the range when end equals start', () => {
        expect(formatReferenceQuery(19, 23, 1, 1)).toBe('Psalms 23:1')
    })
})

describe('bookAbbreviations', () => {
    it('maps every value to a valid bibleBooks entry', () => {
        for (const [, bookName] of Object.entries(bookAbbreviations)) {
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

describe('normalizeBibleReference', () => {
    // This helper exists to clean up voice transcripts and mistyped
    // references before they reach the parser. The goal is "do no
    // harm" to non-reference input while normalizing obvious refs.
    it('returns the input unchanged for non-reference text', () => {
        const samples = [
            'God so loved the world',
            'how great thou art',
            'Amazing grace how sweet the sound',
            '',
            'love',
        ]
        for (const s of samples) {
            expect(normalizeBibleReference(s)).toBe(s)
        }
    })

    it('normalizes digit-space-digit to colon', () => {
        expect(normalizeBibleReference('John 3 16')).toBe('John 3:16')
        expect(normalizeBibleReference('Romans 8 28')).toBe('Romans 8:28')
        expect(normalizeBibleReference('1 corinthians 13 4')).toBe('1 corinthians 13:4')
    })

    it('collapses spaces around colons', () => {
        expect(normalizeBibleReference('John 3 : 16')).toBe('John 3:16')
        expect(normalizeBibleReference('John  3:16')).toBe('John 3:16')
    })

    it('accepts comma as a separator', () => {
        expect(normalizeBibleReference('John 3, 16')).toBe('John 3:16')
    })

    it('normalizes ranges to colon-dash format', () => {
        expect(normalizeBibleReference('John 3 16 20')).toBe('John 3:16-20')
        expect(normalizeBibleReference('John 3:16-20')).toBe('John 3:16-20')
    })

    it('handles numbered book abbreviations', () => {
        expect(normalizeBibleReference('1 John 4 8')).toBe('1 John 4:8')
        expect(normalizeBibleReference('2 Kings 5 1')).toBe('2 Kings 5:1')
    })

    it('preserves case of the book name', () => {
        expect(normalizeBibleReference('JOHN 3 16')).toBe('JOHN 3:16')
    })

    // Regression: STT hands us "John 316" (no space) when the user says
    // "John three sixteen". The previous regex matched ch=31, v=6 and
    // emitted the bogus "John 31:6". We now validate ch against the
    // book's max-chapter and reject impossible splits.
    it('does NOT split "John 316" into the bogus "John 31:6"', () => {
        expect(normalizeBibleReference('John 316')).toBe('John 316')
    })

    it('does NOT split "John 31 6" into "John 31:6"', () => {
        expect(normalizeBibleReference('John 31 6')).toBe('John 31 6')
    })

    it('DOES split "Psalms 316" into "Psalms 31:6" (ch=31 is valid for Psalms)', () => {
        expect(normalizeBibleReference('Psalms 316')).toBe('Psalms 31:6')
    })

    it('handles voice transcript: "John three sixteen" stays as text', () => {
        // "three sixteen" is parsed by parseSpokenNumber upstream, not here.
        expect(normalizeBibleReference('John three sixteen')).toBe('John three sixteen')
    })
})
// Dictionary entries cite references in full prose form ("Song of Solomon 2:1"),
// which the search-box parser cannot handle — its book pattern is one word.
describe('parseFullBibleReference', () => {
    it('parses a plain reference the same way parseBibleQuery does', () => {
        expect(parseFullBibleReference('Exodus 4:14')).toEqual({
            bookIndex: 2,
            bookName: 'Exodus',
            chapter: 4,
            startVerse: 14,
            endVerse: 14,
        })
    })

    it('parses a numbered book', () => {
        expect(parseFullBibleReference('1 Samuel 2:3')?.bookName).toBe('1 Samuel')
    })

    it('parses a multi-word book name', () => {
        expect(parseFullBibleReference('Song of Solomon 2:1')).toEqual({
            bookIndex: 22,
            bookName: 'Song of Solomon',
            chapter: 2,
            startVerse: 1,
            endVerse: 1,
        })
    })

    it('parses a verse range', () => {
        const parsed = parseFullBibleReference('Hebrews 12:1-2')
        expect(parsed?.startVerse).toBe(1)
        expect(parsed?.endVerse).toBe(2)
    })

    it('tolerates trailing punctuation and spaced ranges', () => {
        expect(parseFullBibleReference('Revelation 1:8.')?.chapter).toBe(1)
        expect(parseFullBibleReference('Isaiah 41:4 - 6')?.endVerse).toBe(6)
    })

    it('resolves a whole-chapter citation to its first verse', () => {
        // Easton's cites ~1,100 references as a bare chapter ("Leviticus 8").
        expect(parseFullBibleReference('Leviticus 8')).toEqual({
            bookIndex: 3,
            bookName: 'Leviticus',
            chapter: 8,
            startVerse: 1,
            endVerse: 1,
        })
        expect(parseFullBibleReference('1 Samuel 17')?.chapter).toBe(17)
    })

    it('resolves a span crossing a chapter boundary to its opening verse', () => {
        // One chapter is all a Scripture can hold; the alternative is wrong
        // text under a correct-looking label.
        expect(parseFullBibleReference('Judges 8:33-9:6')).toEqual({
            bookIndex: 7,
            bookName: 'Judges',
            chapter: 8,
            startVerse: 33,
            endVerse: 33,
        })
        expect(parseFullBibleReference('1 Corinthians 12:31-13:13')?.startVerse).toBe(31)
    })

    it('rejects text that is not a reference', () => {
        expect(parseFullBibleReference('')).toBeNull()
        expect(parseFullBibleReference('the eldest son of Amram')).toBeNull()
        expect(parseFullBibleReference('Nowhere 3:16')).toBeNull()
        expect(parseFullBibleReference('Nowhere 3')).toBeNull()
    })
})

// The panel keeps its rows while you type and debounces its lookup by 500ms, so
// Enter could land on rows belonging to an earlier prefix: entering "John 11:35"
// quickly presented whatever "John 1" had loaded.
describe('resolveEnterAction', () => {
    const johnOneOne = { bookIndex: 43, chapter: 1, startVerse: 1 }
    const base = { rowCount: 6, focusedIndex: 5, hasSearched: true }

    it('acts on what was typed when the rows belong to an earlier prefix', () => {
        // The reported case: rows are John 1:1 + neighbours, focus has landed on
        // the sixth row (John 1:6), and the operator has typed John 11:35.
        const action = resolveEnterAction({ ...base, query: 'John 11:35', loadedAnchor: johnOneOne })

        expect(action).toEqual({
            kind: 'typed',
            reference: { bookIndex: 43, bookName: 'John', chapter: 11, startVerse: 35, endVerse: 35 },
        })
    })

    it('acts on what was typed when only the verse has moved on', () => {
        const action = resolveEnterAction({
            ...base, query: 'John 11:35', loadedAnchor: { bookIndex: 43, chapter: 11, startVerse: 3 },
        })
        expect(action.kind === 'typed' && action.reference.startVerse).toBe(35)
    })

    it('acts on what was typed when the book has moved on', () => {
        const action = resolveEnterAction({ ...base, query: 'Mark 11:35', loadedAnchor: johnOneOne })
        expect(action.kind === 'typed' && action.reference.bookIndex).toBe(41)
    })

    it('uses the highlighted row when the rows match the query', () => {
        // This is what keeps arrow-key selection working: the operator arrowed
        // down to a neighbour of the verse they typed, and Enter must present
        // that neighbour rather than snapping back.
        const action = resolveEnterAction({
            ...base, focusedIndex: 3, query: 'John 11:35',
            loadedAnchor: { bookIndex: 43, chapter: 11, startVerse: 35 },
        })
        expect(action).toEqual({ kind: 'row', index: 3 })
    })

    it('defaults to the first row when none is highlighted', () => {
        const action = resolveEnterAction({
            ...base, focusedIndex: -1, query: 'John 11:35',
            loadedAnchor: { bookIndex: 43, chapter: 11, startVerse: 35 },
        })
        expect(action).toEqual({ kind: 'row', index: 0 })
    })

    it('uses the highlighted row for a semantic query, which names no reference', () => {
        const action = resolveEnterAction({ ...base, focusedIndex: 2, query: 'jesus wept', loadedAnchor: johnOneOne })
        expect(action).toEqual({ kind: 'row', index: 2 })
    })

    it('acts on the typed reference on a fresh panel, without a throwaway search first', () => {
        const action = resolveEnterAction({
            query: 'John 11:35', loadedAnchor: null, rowCount: 0, focusedIndex: -1, hasSearched: false,
        })
        expect(action.kind === 'typed' && action.reference.chapter).toBe(11)
    })

    it('ignores semantic matches when a reference has been typed', () => {
        // The reported case. Semantic (meaning) results for a partial query stay
        // on screen while a reference is typed — deliberately, so both can be
        // shown — and no reference has been fetched, so there is no anchor. The
        // rows are verses the operator never typed or opened, and presenting one
        // also rewrote the search box to it.
        const action = resolveEnterAction({
            query: 'John 11:35', loadedAnchor: null, rowCount: 8, focusedIndex: 0, hasSearched: false,
        })
        expect(action).toEqual({
            kind: 'typed',
            reference: { bookIndex: 43, bookName: 'John', chapter: 11, startVerse: 35, endVerse: 35 },
        })
    })

    it('still lets a semantic result be chosen when the query is not a reference', () => {
        // Typing meaning text and picking a match must keep working.
        const action = resolveEnterAction({
            query: 'jesus wept', loadedAnchor: null, rowCount: 8, focusedIndex: 3, hasSearched: false,
        })
        expect(action).toEqual({ kind: 'row', index: 3 })
    })

    it('searches when the query is not a reference and nothing is on screen', () => {
        const action = resolveEnterAction({
            query: 'love one another', loadedAnchor: null, rowCount: 0, focusedIndex: -1, hasSearched: false,
        })
        expect(action).toEqual({ kind: 'search' })
    })

    it('does nothing when a search has already run and found nothing', () => {
        const action = resolveEnterAction({
            query: 'zzzz', loadedAnchor: null, rowCount: 0, focusedIndex: -1, hasSearched: true,
        })
        expect(action).toEqual({ kind: 'none' })
    })

    it('normalises the query the same way the search does', () => {
        const spaced = resolveEnterAction({ ...base, query: 'John 11 35', loadedAnchor: johnOneOne })
        expect(spaced.kind === 'typed' && spaced.reference.startVerse).toBe(35)

        const abbreviated = resolveEnterAction({ ...base, query: 'jn 11:35', loadedAnchor: johnOneOne })
        expect(abbreviated.kind === 'typed' && abbreviated.reference.chapter).toBe(11)
    })

    it('carries a verse range through', () => {
        const action = resolveEnterAction({ ...base, query: 'John 11:35-36', loadedAnchor: johnOneOne })
        expect(action.kind === 'typed' && action.reference.endVerse).toBe(36)
    })
})
