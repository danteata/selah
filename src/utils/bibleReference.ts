import { bibleBooks } from '../types'

export const bookAbbreviations: Record<string, string> = {
    'gen': 'Genesis', 'ex': 'Exodus', 'exod': 'Exodus', 'lev': 'Leviticus',
    'num': 'Numbers', 'deut': 'Deuteronomy', 'dt': 'Deuteronomy',
    'josh': 'Joshua', 'judg': 'Judges', 'ruth': 'Ruth',
    '1sam': '1 Samuel', '1sa': '1 Samuel', '2sam': '2 Samuel', '2sa': '2 Samuel',
    '1kgs': '1 Kings', '1ki': '1 Kings', '2kgs': '2 Kings', '2ki': '2 Kings',
    '1chr': '1 Chronicles', '1ch': '1 Chronicles', '2chr': '2 Chronicles', '2ch': '2 Chronicles',
    'ezra': 'Ezra', 'neh': 'Nehemiah', 'esth': 'Esther', 'est': 'Esther',
    'job': 'Job', 'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms',
    'prov': 'Proverbs', 'pr': 'Proverbs', 'eccl': 'Ecclesiastes', 'ec': 'Ecclesiastes',
    'song': 'Song of Solomon', 'sos': 'Song of Solomon', 'isa': 'Isaiah',
    'jer': 'Jeremiah', 'lam': 'Lamentations', 'ezek': 'Ezekiel', 'dan': 'Daniel',
    'hos': 'Hosea', 'joel': 'Joel', 'amos': 'Amos', 'obad': 'Obadiah', 'ob': 'Obadiah',
    'jon': 'Jonah', 'mic': 'Micah', 'nah': 'Nahum', 'hab': 'Habakkuk',
    'zeph': 'Zephaniah', 'hag': 'Haggai', 'zech': 'Zechariah', 'zec': 'Zechariah',
    'mal': 'Malachi',
    'mt': 'Matthew', 'matt': 'Matthew', 'mk': 'Mark', 'mrk': 'Mark',
    'lk': 'Luke', 'luk': 'Luke', 'jn': 'John', 'joh': 'John',
    'acts': 'Acts', 'act': 'Acts', 'rom': 'Romans', 'ro': 'Romans',
    '1cor': '1 Corinthians', '1co': '1 Corinthians', '2cor': '2 Corinthians', '2co': '2 Corinthians',
    'gal': 'Galatians', 'ga': 'Galatians', 'eph': 'Ephesians', 'ep': 'Ephesians',
    'phil': 'Philippians', 'php': 'Philippians', 'col': 'Colossians',
    '1thess': '1 Thessalonians', '1th': '1 Thessalonians', '2thess': '2 Thessalonians', '2th': '2 Thessalonians',
    '1tim': '1 Timothy', '1ti': '1 Timothy', '2tim': '2 Timothy', '2ti': '2 Timothy',
    'tit': 'Titus', 'titus': 'Titus', 'phlm': 'Philemon', 'philem': 'Philemon',
    'heb': 'Hebrews', 'jas': 'James', 'jam': 'James', 'james': 'James',
    '1pet': '1 Peter', '1pe': '1 Peter', '1pt': '1 Peter', '2pet': '2 Peter', '2pe': '2 Peter', '2pt': '2 Peter',
    '1jn': '1 John', '1joh': '1 John', '1john': '1 John', '2jn': '2 John', '2joh': '2 John', '2john': '2 John',
    '3jn': '3 John', '3joh': '3 John', '3john': '3 John', 'jude': 'Jude', 'rev': 'Revelation',
    'revelations': 'Revelation', 'revelation': 'Revelation',
}

export interface ParsedBibleQuery {
    bookIndex: number
    bookName: string
    chapter: number
    startVerse: number
    endVerse: number
}

export function resolveBookName(input: string): { bookIndex: number; bookName: string } | null {
    const lower = input.toLowerCase().trim()
    if (!lower) return null
    const noSpace = lower.replace(/\s+/g, '')
    const fromAbbr = bookAbbreviations[noSpace]
    if (fromAbbr) {
        const idx = bibleBooks.indexOf(fromAbbr as typeof bibleBooks[number])
        if (idx >= 0) return { bookIndex: idx + 1, bookName: fromAbbr }
    }
    const found = bibleBooks.find(b => b.toLowerCase() === lower || b.toLowerCase().startsWith(lower))
    if (found) {
        const idx = bibleBooks.indexOf(found as typeof bibleBooks[number])
        if (idx >= 0) return { bookIndex: idx + 1, bookName: found }
    }
    return null
}

export const BOOK_CHAPTER_COUNTS: Record<string, number> = {
    Genesis: 50, Exodus: 40, Leviticus: 27, Numbers: 36, Deuteronomy: 34,
    Joshua: 24, Judges: 21, Ruth: 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, Ezra: 10,
    Nehemiah: 13, Esther: 10, Job: 42, Psalms: 150, Proverbs: 31,
    Ecclesiastes: 12, 'Song of Solomon': 8, Isaiah: 66, Jeremiah: 52, Lamentations: 5,
    Ezekiel: 48, Daniel: 12, Hosea: 14, Joel: 3, Amos: 9,
    Obadiah: 1, Jonah: 4, Micah: 7, Nahum: 3, Habakkuk: 3,
    Zephaniah: 3, Haggai: 2, Zechariah: 14, Malachi: 4,
    Matthew: 28, Mark: 16, Luke: 24, John: 21, Acts: 28,
    Romans: 16, '1 Corinthians': 16, '2 Corinthians': 13, Galatians: 6, Ephesians: 6,
    Philippians: 4, Colossians: 4, '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6,
    '2 Timothy': 4, Titus: 3, Philemon: 1, Hebrews: 13, James: 5,
    '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
    Jude: 1, Revelation: 22,
}

export function getNextChapter(book: string, chapter: number): { book: string; chapter: number } | null {
    const max = BOOK_CHAPTER_COUNTS[book]
    if (!max) return null
    if (chapter < max) {
        return { book, chapter: chapter + 1 }
    }
    const idx = bibleBooks.indexOf(book as typeof bibleBooks[number])
    if (idx >= 0 && idx < bibleBooks.length - 1) {
        return { book: bibleBooks[idx + 1], chapter: 1 }
    }
    return null
}

export function getPreviousChapter(book: string, chapter: number): { book: string; chapter: number } | null {
    if (chapter > 1) {
        return { book, chapter: chapter - 1 }
    }
    const idx = bibleBooks.indexOf(book as typeof bibleBooks[number])
    if (idx > 0) {
        const prevBook = bibleBooks[idx - 1]
        const prevMax = BOOK_CHAPTER_COUNTS[prevBook]
        return prevMax ? { book: prevBook, chapter: prevMax } : null
    }
    return null
}

export function parseBibleQuery(q: string): ParsedBibleQuery | null {
    const trimmed = q.trim()
    if (!trimmed) return null

    const fullPattern = /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/i
    const match = trimmed.match(fullPattern)
    if (match) {
        const bookInput = match[1].toLowerCase()
        const chapter = parseInt(match[2])
        const startVerse = parseInt(match[3])
        const endVerse = match[4] ? parseInt(match[4]) : startVerse
        const resolved = resolveBookName(bookInput)
        if (resolved) {
            return { ...resolved, chapter, startVerse, endVerse }
        }
    }

    const numericPattern = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/
    const numMatch = trimmed.match(numericPattern)
    if (numMatch) {
        const bookIndex = parseInt(numMatch[1])
        const bookName = bibleBooks[bookIndex - 1]
        if (bookName) {
            return {
                bookIndex,
                bookName,
                chapter: parseInt(numMatch[2]),
                startVerse: parseInt(numMatch[3]),
                endVerse: numMatch[4] ? parseInt(numMatch[4]) : parseInt(numMatch[3]),
            }
        }
    }

    return null
}

export function getBookSuggestions(query: string): string[] {
    if (!query || query.includes(':')) return []
    const lq = query.toLowerCase().trim()
    const am = bookAbbreviations[lq]
    if (am) return [am]
    return bibleBooks.filter(b => b.toLowerCase().startsWith(lq) || b.toLowerCase().includes(lq)).slice(0, 5)
}

export interface VerseRow {
    bookIndex: number
    chapter: number
    verse: number
    scripture: string
    reference: string
    displayLabel: string
    isCurrent: boolean
    source: 'reference' | 'semantic' | 'neighbor'
    showChapterHeader: boolean
    chapterHeaderLabel: string
    score?: number
}

export interface BibleVerseLike {
    chapter: number
    verse: number
    scripture: string
}

export interface SemanticResultLike {
    bookNumber: number
    chapter: number
    verse: number
    text: string
    reference: string
    score: number
}

export function buildVerseRows(
    hasSearched: boolean,
    currentBookIndex: number | null,
    currentChapter: number | null,
    currentVerses: BibleVerseLike[],
    neighborVerses: { prev: BibleVerseLike[]; next: BibleVerseLike[] },
    semanticResults: SemanticResultLike[],
): VerseRow[] {
    const rows: VerseRow[] = []
    if (hasSearched && currentBookIndex && currentChapter) {
        let prevChapter: number | null = null
        for (const nv of neighborVerses.prev) {
            const showHeader = prevChapter !== null && nv.chapter !== prevChapter
            const headerLabel = nv.chapter !== currentChapter
                ? `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}`
                : ''
            rows.push({
                bookIndex: currentBookIndex,
                chapter: nv.chapter,
                verse: nv.verse,
                scripture: nv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}:${nv.verse}`,
                displayLabel: `${nv.verse}`,
                isCurrent: false,
                source: 'neighbor',
                showChapterHeader: showHeader,
                chapterHeaderLabel: headerLabel,
            })
            prevChapter = nv.chapter
        }
        for (const cv of currentVerses) {
            const showHeader = prevChapter !== null && cv.chapter !== prevChapter
            rows.push({
                bookIndex: currentBookIndex,
                chapter: currentChapter,
                verse: cv.verse,
                scripture: cv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${currentChapter}:${cv.verse}`,
                displayLabel: `${cv.verse}`,
                isCurrent: true,
                source: 'reference',
                showChapterHeader: showHeader,
                chapterHeaderLabel: '',
            })
            prevChapter = cv.chapter
        }
        for (const nv of neighborVerses.next) {
            const showHeader = nv.chapter !== prevChapter
            const headerLabel = nv.chapter !== currentChapter
                ? `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}`
                : ''
            rows.push({
                bookIndex: currentBookIndex,
                chapter: nv.chapter,
                verse: nv.verse,
                scripture: nv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}:${nv.verse}`,
                displayLabel: `${nv.verse}`,
                isCurrent: false,
                source: 'neighbor',
                showChapterHeader: showHeader,
                chapterHeaderLabel: headerLabel,
            })
            prevChapter = nv.chapter
        }
    }
    if (!hasSearched) {
        for (const sr of semanticResults) {
            rows.push({
                bookIndex: sr.bookNumber,
                chapter: sr.chapter,
                verse: sr.verse,
                scripture: sr.text,
                reference: sr.reference,
                displayLabel: sr.reference,
                isCurrent: false,
                source: 'semantic',
                showChapterHeader: false,
                chapterHeaderLabel: '',
                score: sr.score,
            })
        }
    }
    return rows
}