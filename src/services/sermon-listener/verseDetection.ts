/**
 * Bible Verse Detection Service
 * Parses text to detect Bible verse references in both typed and spoken formats.
 */

export interface DetectedVerse {
    /** Original matched text (e.g., "John 3:16") */
    raw: string
    /** Standardized reference (e.g., "John 3:16") */
    reference: string
    /** Book name (e.g., "John") */
    book: string
    /** Chapter number */
    chapter: number
    /** Verse number(s) - can be single or range */
    verseStart: number
    verseEnd?: number
    /** Position in the original text */
    startIndex: number
    endIndex: number
    /** Confidence level of detection */
    confidence: 'high' | 'medium' | 'low'
    /** Whether this was the best match from its query (primary vs probable) */
    isBestMatch?: boolean
    /** Detection type - how this verse was detected */
    detectionType?: 'regex' | 'semantic'
    /** How many times this verse has been re-activated after initial detection */
    retriggerCount?: number
    /** Timestamp of the last activation (initial or re-trigger), used for cooldown */
    lastActivatedAt?: number
}

// Book name mappings (common variations to standard names)
const BOOK_MAPPINGS: Record<string, string> = {
    // Old Testament
    'gen': 'Genesis', 'genesis': 'Genesis',
    'ex': 'Exodus', 'exod': 'Exodus', 'exodus': 'Exodus',
    'lev': 'Leviticus', 'leviticus': 'Leviticus',
    'num': 'Numbers', 'numbers': 'Numbers',
    'deut': 'Deuteronomy', 'deuteronomy': 'Deuteronomy',
    'josh': 'Joshua', 'joshua': 'Joshua',
    'judg': 'Judges', 'judges': 'Judges',
    'ruth': 'Ruth',
    '1 sam': '1 Samuel', '1 samuel': '1 Samuel', 'first samuel': '1 Samuel',
    '2 sam': '2 Samuel', '2 samuel': '2 Samuel', 'second samuel': '2 Samuel',
    '1 kgs': '1 Kings', '1 kings': '1 Kings', 'first kings': '1 Kings',
    '2 kgs': '2 Kings', '2 kings': '2 Kings', 'second kings': '2 Kings',
    '1 chr': '1 Chronicles', '1 chron': '1 Chronicles', '1 chronicles': '1 Chronicles', 'first chronicles': '1 Chronicles',
    '2 chr': '2 Chronicles', '2 chron': '2 Chronicles', '2 chronicles': '2 Chronicles', 'second chronicles': '2 Chronicles',
    'ezra': 'Ezra',
    'neh': 'Nehemiah', 'nehemiah': 'Nehemiah',
    'esth': 'Esther', 'esther': 'Esther',
    'job': 'Job',
    'ps': 'Psalms', 'psalm': 'Psalms', 'psalms': 'Psalms', 'pslm': 'Psalms',
    'prov': 'Proverbs', 'proverbs': 'Proverbs',
    'eccl': 'Ecclesiastes', 'eccles': 'Ecclesiastes', 'ecclesiastes': 'Ecclesiastes',
    'song': 'Song of Solomon', 'songs': 'Song of Solomon', 'song of solomon': 'Song of Solomon', 'song of songs': 'Song of Solomon',
    'isa': 'Isaiah', 'isaiah': 'Isaiah',
    'jer': 'Jeremiah', 'jeremiah': 'Jeremiah',
    'lam': 'Lamentations', 'lamentations': 'Lamentations',
    'ezek': 'Ezekiel', 'eze': 'Ezekiel', 'ezekiel': 'Ezekiel',
    'dan': 'Daniel', 'daniel': 'Daniel',
    'hos': 'Hosea', 'hosea': 'Hosea',
    'joel': 'Joel',
    'amos': 'Amos',
    'obad': 'Obadiah', 'obadiah': 'Obadiah',
    'jon': 'Jonah', 'jonah': 'Jonah',
    'mic': 'Micah', 'micah': 'Micah',
    'nah': 'Nahum', 'nahum': 'Nahum',
    'hab': 'Habakkuk', 'habakkuk': 'Habakkuk',
    'zeph': 'Zephaniah', 'zephaniah': 'Zephaniah',
    'hag': 'Haggai', 'haggai': 'Haggai',
    'zech': 'Zechariah', 'zec': 'Zechariah', 'zechariah': 'Zechariah',
    'mal': 'Malachi', 'malachi': 'Malachi',
    // New Testament
    'matt': 'Matthew', 'mat': 'Matthew', 'matthew': 'Matthew', 'mathu': 'Matthew', 'machu': 'Matthew', 'math you': 'Matthew',
    'mk': 'Mark', 'mar': 'Mark', 'mark': 'Mark',
    'lk': 'Luke', 'luk': 'Luke', 'luke': 'Luke',
    'jn': 'John', 'joh': 'John', 'john': 'John',
    'acts': 'Acts', 'act': 'Acts',
    'rom': 'Romans', 'romans': 'Romans',
    '1 cor': '1 Corinthians', '1 corinthians': '1 Corinthians', 'first corinthians': '1 Corinthians',
    '2 cor': '2 Corinthians', '2 corinthians': '2 Corinthians', 'second corinthians': '2 Corinthians',
    'gal': 'Galatians', 'galatians': 'Galatians',
    'eph': 'Ephesians', 'ephesians': 'Ephesians',
    'phil': 'Philippians', 'philippians': 'Philippians',
    'col': 'Colossians', 'colossians': 'Colossians',
    '1 thess': '1 Thessalonians', '1 thessalonians': '1 Thessalonians', 'first thessalonians': '1 Thessalonians',
    '2 thess': '2 Thessalonians', '2 thessalonians': '2 Thessalonians', 'second thessalonians': '2 Thessalonians',
    '1 tim': '1 Timothy', '1 timothy': '1 Timothy', 'first timothy': '1 Timothy',
    '2 tim': '2 Timothy', '2 timothy': '2 Timothy', 'second timothy': '2 Timothy',
    'titus': 'Titus',
    'phlm': 'Philemon', 'philemon': 'Philemon',
    'heb': 'Hebrews', 'hebr': 'Hebrews', 'hebrews': 'Hebrews',
    'jas': 'James', 'jam': 'James', 'james': 'James',
    '1 pet': '1 Peter', '1 peter': '1 Peter', 'first peter': '1 Peter',
    '2 pet': '2 Peter', '2 peter': '2 Peter', 'second peter': '2 Peter',
    '1 jn': '1 John', '1 john': '1 John', 'first john': '1 John',
    '2 jn': '2 John', '2 john': '2 John', 'second john': '2 John',
    '3 jn': '3 John', '3 john': '3 John', 'third john': '3 John',
    'jude': 'Jude',
    'rev': 'Revelation', 'revelation': 'Revelation', 'revelations': 'Revelation',

    // ASR (Automatic Speech Recognition) common errors and phonetic variations
    // --- REMOVED dangerous standalone-word aliases (join, joan, jean, june, channel,
    //     some, sum, sanct, sans, saint, current, courant, ramon, look, izzy,
    //     jeremy, danny, genes is, jenny is, exo dus, ex doubt, easy kill, easy keel,
    //     fish in, fill up, core in, cor in, gal ation, he bread).
    // These were causing false positives in everyday speech ("channel 5", "some people",
    // "look at", "current events", "ramon", "jeremy", "danny", "izzy", etc).
    // Context-guarded corrections for these are still applied upstream by
    // correctAccentMishearings() in hallucinationFilter.ts (only when followed by a
    // chapter/verse pattern).
    //
    // Kept: safe phonetic variants that only trigger on clear book-name misspellings.
    'johnny': 'John',
    'salm': 'Psalms',
    'mathew': 'Matthew', 'mathieu': 'Matthew', 'matty': 'Matthew',
    'marc': 'Mark', 'marke': 'Mark',
    'luc': 'Luke',
    'roman': 'Romans',
    'corinthian': 'Corinthians',
    'galatian': 'Galatians',
    'ephesian': 'Ephesians',
    'philippian': 'Philippians',
    'colossian': 'Colossians',
    'thessalonian': 'Thessalonians',
    'timmothy': 'Timothy', 'timothee': 'Timothy',
    'peters': 'Peter', 'pedro': 'Peter', 'peet': 'Peter',
    'jams': 'James', 'jame': 'James',
    'hebrew': 'Hebrews',
}

// Book names with their corresponding book numbers (for internal use)
export const BOOK_TO_NUMBER: Record<string, number> = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14, 'Ezra': 15,
    'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19, 'Proverbs': 20,
    'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25,
    'Ezekiel': 26, 'Daniel': 27, 'Hosea': 28, 'Joel': 29, 'Amos': 30,
    'Obadiah': 31, 'Jonah': 32, 'Micah': 33, 'Nahum': 34, 'Habakkuk': 35,
    'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38, 'Malachi': 39,
    'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
    'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47, 'Galatians': 48, 'Ephesians': 49,
    'Philippians': 50, 'Colossians': 51, '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54,
    '2 Timothy': 55, 'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59,
    '1 Peter': 60, '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64,
    'Jude': 65, 'Revelation': 66,
}

// Book numbers with their corresponding names (inverse of BOOK_TO_NUMBER)
export const NUMBER_TO_BOOK: Record<number, string> = {
    1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
    6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
    11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles', 15: 'Ezra',
    16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms', 20: 'Proverbs',
    21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah', 24: 'Jeremiah', 25: 'Lamentations',
    26: 'Ezekiel', 27: 'Daniel', 28: 'Hosea', 29: 'Joel', 30: 'Amos',
    31: 'Obadiah', 32: 'Jonah', 33: 'Micah', 34: 'Nahum', 35: 'Habakkuk',
    36: 'Zephaniah', 37: 'Haggai', 38: 'Zechariah', 39: 'Malachi',
    40: 'Matthew', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
    45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians', 48: 'Galatians', 49: 'Ephesians',
    50: 'Philippians', 51: 'Colossians', 52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy',
    55: '2 Timothy', 56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James',
    60: '1 Peter', 61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John',
    65: 'Jude', 66: 'Revelation',
}

const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
}

const ORDINAL_WORDS: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
}

interface BookAlias {
    aliasTokens: string[]
    book: string
}

let cachedBookAliases: BookAlias[] | null = null

// Build regex pattern for book names
function buildBookPattern(): string {
    const bookPatterns: string[] = []

    // Add numbered books (1 John, 2 Peter, etc.)
    const numberedBooks = ['1', '2', '3', 'I', 'II', 'III', 'first', 'second', 'third']
    const numberedBookNames = [
        'Samuel', 'Kings', 'Chronicles', 'Thessalonians', 'Timothy', 'Peter', 'John', 'Corinthians',
        'sam', 'kgs', 'chr', 'thess', 'tim', 'pet', 'jn', 'cor'
    ]

    for (const num of numberedBooks) {
        for (const name of numberedBookNames) {
            bookPatterns.push(`${num}\\s+${name}`)
        }
    }

    // Add all book names and abbreviations
    for (const abbrev of Object.keys(BOOK_MAPPINGS)) {
        const escaped = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        bookPatterns.push(escaped)
    }

    return bookPatterns.sort((a, b) => b.length - a.length).join('|')
}

export const BOOK_PATTERN = buildBookPattern()

// Pattern for chapter and verse (supports : . - x × vs verse and spaces as separator)
// U+00D7 = multiplication sign (×) — Whisper sometimes outputs it for "verse"
// Spaces are intentionally NOT in the main separator list because they create
// too many false positives ("Genesis 7 1 was destroyed").  A dedicated
// fallback in detectSpokenVerses handles the "book chapter verse" case.
const CHAPTER_VERSE_PATTERN = '(\\d+)\\s*(?:[:\\.\\-]|x|×|vs\\.?|verse)\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+))?'

// Sanity-check map: canonical book → max chapter count.
// Used to reject hallucinated references like "Ephesians 600 verse 1".
export const BOOK_MAX_CHAPTER: Record<string, number> = {
    'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
    'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, 'Ezra': 10,
    'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalms': 150, 'Proverbs': 31,
    'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66, 'Jeremiah': 52, 'Lamentations': 5,
    'Ezekiel': 48, 'Daniel': 12, 'Hosea': 14, 'Joel': 3, 'Amos': 9,
    'Obadiah': 1, 'Jonah': 4, 'Micah': 7, 'Nahum': 3, 'Habakkuk': 3,
    'Zephaniah': 3, 'Haggai': 2, 'Zechariah': 14, 'Malachi': 4,
    'Matthew': 28, 'Mark': 16, 'Luke': 24, 'John': 21, 'Acts': 28,
    'Romans': 16, '1 Corinthians': 16, '2 Corinthians': 13, 'Galatians': 6, 'Ephesians': 6,
    'Philippians': 4, 'Colossians': 4, '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6,
    '2 Timothy': 4, 'Titus': 3, 'Philemon': 1, 'Hebrews': 13, 'James': 5,
    '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
    'Jude': 1, 'Revelation': 22,
}

// Verse count map: canonical book → array of max verses per chapter (1-indexed)
// Used to reject impossible verse references like "John 21:1000"
// Array index = chapter number - 1, value = max verse number in that chapter
const BOOK_MAX_VERSES: Record<string, number[]> = {
    'John': [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 21, 27, 33, 26, 26, 40, 31, 25],
    'Psalm': [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 5, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 12, 11, 22, 22, 28, 12, 40, 22, 39, 43, 13, 17, 26, 12, 11, 17, 13, 14, 11, 20, 23, 19, 9, 7, 23, 13, 6, 11, 8, 12, 7, 9, 13, 19, 11, 20, 24, 17, 20, 28, 8, 14, 10, 9, 24, 13, 16, 5, 18, 8, 12, 11, 10, 9, 18, 19, 15, 13, 17, 11, 16, 17, 15, 20, 21, 10, 16, 8, 18, 12, 13, 15, 12, 9, 9, 5, 8, 13, 12, 10, 10, 9, 8, 18, 14, 10, 11, 14, 16, 19, 8, 11, 7, 10, 10, 12, 9, 6, 11, 8, 8, 10, 10, 12, 11, 7, 7, 13, 17, 13, 16, 10, 12, 15, 7, 7, 10, 8, 18, 10, 11, 9, 11, 13, 10, 10, 12, 11, 10, 10, 12, 15, 13, 11, 16, 18, 12, 12, 14, 13, 11, 12, 15, 14, 9, 9, 7, 9, 10, 6, 7, 9, 9, 9, 5, 8, 12, 12, 10, 10, 8, 12, 11, 11, 9, 13, 13, 9, 14, 13, 10, 11, 11, 12, 15, 10, 11, 11, 11, 14, 14, 12, 13, 13, 11, 15, 13, 12, 13, 13, 14, 14, 13, 11, 12, 17, 12, 12, 14, 9, 13, 11, 13, 12, 10, 15, 13, 11, 16, 15, 11, 11, 13, 12, 11, 8, 8, 8, 12, 13, 7, 13, 12, 12, 13, 16, 13, 13, 12, 11, 11, 12, 11, 9, 14, 11, 11, 11, 12, 11, 13, 13, 10, 10, 11, 11, 10, 11, 9, 10, 11, 11, 11, 10, 12, 12, 10, 9, 10, 11, 11, 11, 11, 12, 11, 9, 10, 11, 11, 11, 10, 10, 10, 11, 11, 11, 10, 11, 11, 11, 10, 12, 11, 10, 10, 176],
}

// Full verse detection pattern
const VERSE_PATTERN = new RegExp(
    `\\b(${BOOK_PATTERN})\\s+${CHAPTER_VERSE_PATTERN}\\b`,
    'gi'
)

const ALTERNATIVE_PATTERNS = [
    /chapter\s+(\d+)[,\s]+(?:verse[s]?\s+)?(\d+)(?:\s+(?:to|through|-|\u2013|\u2014)\s*(\d+))?/gi,
    /(?:verse[s]?\s+)?(\d+)\s+of\s+chapter\s+(\d+)/gi,
]

export function normalizeBookName(bookText: string): string | null {
    const normalized = bookText.toLowerCase().trim()

    if (BOOK_MAPPINGS[normalized]) {
        return BOOK_MAPPINGS[normalized]
    }

    const romanToArabic: Record<string, string> = {
        'i': '1', 'ii': '2', 'iii': '3',
        'I': '1', 'II': '2', 'III': '3',
    }

    for (const [roman, arabic] of Object.entries(romanToArabic)) {
        if (normalized.startsWith(roman.toLowerCase() + ' ')) {
            const rest = normalized.slice(roman.length + 1)
            const combined = `${arabic} ${rest}`
            if (BOOK_MAPPINGS[combined]) {
                return BOOK_MAPPINGS[combined]
            }
        }
    }

    return null
}

function normalizeAlias(alias: string): string[] {
    return alias
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
}

function getBookAliases(): BookAlias[] {
    if (cachedBookAliases) return cachedBookAliases

    const aliases: BookAlias[] = []
    const seen = new Set<string>()

    const addAlias = (alias: string, canonicalBook: string) => {
        const aliasTokens = normalizeAlias(alias)
        if (aliasTokens.length === 0) return

        const key = `${aliasTokens.join(' ')}=>${canonicalBook}`
        if (seen.has(key)) return
        seen.add(key)
        aliases.push({ aliasTokens, book: canonicalBook })
    }

    for (const [alias, canonicalBook] of Object.entries(BOOK_MAPPINGS)) {
        addAlias(alias, canonicalBook)
    }
    for (const canonicalBook of Object.keys(BOOK_TO_NUMBER)) {
        addAlias(canonicalBook, canonicalBook)
    }

    cachedBookAliases = aliases.sort((a, b) => b.aliasTokens.length - a.aliasTokens.length)
    return cachedBookAliases
}

export function parseSpokenNumber(input: string): number | null {
    const normalized = input
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .trim()

    if (!normalized) return null
    if (/^\d+$/.test(normalized)) {
        return parseInt(normalized, 10)
    }

    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return null

    let value = 0
    let hasNumberToken = false

    for (const token of tokens) {
        if (token === 'and') continue

        if (/^\d+$/.test(token)) {
            value += parseInt(token, 10)
            hasNumberToken = true
            continue
        }

        if (ORDINAL_WORDS[token] !== undefined) {
            value += ORDINAL_WORDS[token]
            hasNumberToken = true
            continue
        }

        const base = NUMBER_WORDS[token]
        if (base === undefined) return null

        hasNumberToken = true
        if (base === 100) {
            value = value === 0 ? 100 : value * 100
        } else {
            value += base
        }
    }

    if (!hasNumberToken || value <= 0) return null
    return value
}

function parseNumberFromTokens(tokens: string[], startIndex: number, maxTokens: number = 4): { value: number; nextIndex: number } | null {
    const remaining = tokens.length - startIndex
    const tokenWindow = Math.min(maxTokens, remaining)

    for (let length = tokenWindow; length >= 1; length -= 1) {
        const phrase = tokens.slice(startIndex, startIndex + length).join(' ')
        const value = parseSpokenNumber(phrase)
        if (value !== null) {
            return {
                value,
                nextIndex: startIndex + length,
            }
        }
    }

    return null
}

const NAME_PREFIXES = new Set([
    'pope', 'dr', 'father', 'saint', 'st', 'mr', 'mrs', 'ms', 'professor',
    'prof', 'pastor', 'reverend', 'rev', 'elder', 'bishop', 'cardinal',
])

function detectSpokenVerses(text: string): DetectedVerse[] {
    const normalizedText = text
        .toLowerCase()
        .replace(/[.,;!?()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    if (!normalizedText) return []

    const bookAliases = getBookAliases()
    const tokens = normalizedText.split(' ')
    const seen = new Set<string>()
    const detected: DetectedVerse[] = []
    let searchFrom = 0

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
        const alias = bookAliases.find((candidate) =>
            candidate.aliasTokens.every((token, aliasIndex) => tokens[tokenIndex + aliasIndex] === token)
        )
        if (!alias) continue

        const precedingToken = tokenIndex > 0 ? tokens[tokenIndex - 1] : ''
        if (NAME_PREFIXES.has(precedingToken)) continue

        let pointer = tokenIndex + alias.aliasTokens.length

        // Track if we found "chapter" keyword (affects confidence and parsing)
        let hasChapterKeyword = false
        let hasVerseKeyword = false

        // Check for "chapter" keyword
        if (tokens[pointer] === 'chapter') {
            hasChapterKeyword = true
            pointer += 1
        }

        // Parse chapter - spoken forms like "John three sixteen" are supported
        const chapterStartPointer = pointer
        const chapter = hasChapterKeyword
            ? parseNumberFromTokens(tokens, pointer, 4)  // Allow multi-word like "twenty three"
            : parseNumberFromTokens(tokens, pointer, 2)
        if (!chapter) continue
        pointer = chapter.nextIndex

        // Check for "verse" or "verses" keyword
        if (tokens[pointer] === 'verse' || tokens[pointer] === 'verses') {
            hasVerseKeyword = true
            pointer += 1
        }

        // Parse verse - allow spoken style "John three sixteen" or "John 3 vs 16"
        let verseStart = hasVerseKeyword
            ? parseNumberFromTokens(tokens, pointer, 4)
            : parseNumberFromTokens(tokens, pointer, 2)

        // Sanity-check: reject wildly out-of-bounds chapter numbers (Whisper hallucinations)
        const maxChapter = BOOK_MAX_CHAPTER[alias.book]
        if (maxChapter !== undefined && chapter.value > maxChapter) {
            continue
        }

        // Handle compact spoken refs like "John 316" => John 3:16
        // but only when verse token is missing and the chapter token was a single compact number.
        if (!verseStart) {
            const rawChapterToken = tokens[chapterStartPointer] || ''
            if (/^\d{3}$/.test(rawChapterToken)) {
                const compact = parseInt(rawChapterToken, 10)
                const inferredChapter = Math.floor(compact / 100)
                const inferredVerse = compact % 100
                if (inferredChapter > 0 && inferredVerse > 0) {
                    detected.push({
                        raw: tokens.slice(tokenIndex, pointer).join(' '),
                        reference: `${alias.book} ${inferredChapter}:${inferredVerse}`,
                        book: alias.book,
                        chapter: inferredChapter,
                        verseStart: inferredVerse,
                        startIndex: 0,
                        endIndex: 0,
                        confidence: hasChapterKeyword ? 'high' : 'medium',
                    })
                    continue
                }
            }

            // CHAPTER-ONLY FALLBACK: e.g. "Ephesians chapter 6" → Eph 6:1
            // Only emit when "chapter" keyword was explicitly spoken.
            // Medium confidence so it respects the user's min-confidence threshold.
            if (hasChapterKeyword) {
                const chapterOnlyRef = `${alias.book} ${chapter.value}:1`
                if (!seen.has(chapterOnlyRef)) {
                    seen.add(chapterOnlyRef)
                    const raw = tokens.slice(tokenIndex, pointer).join(' ')
                    const startIndex = normalizedText.indexOf(raw, searchFrom)
                    const endIndex = startIndex === -1 ? -1 : startIndex + raw.length
                    if (startIndex !== -1) {
                        searchFrom = endIndex
                    }
                    detected.push({
                        raw,
                        reference: chapterOnlyRef,
                        book: alias.book,
                        chapter: chapter.value,
                        verseStart: 1,
                        startIndex: startIndex === -1 ? 0 : startIndex,
                        endIndex: endIndex === -1 ? raw.length : endIndex,
                        confidence: 'medium',
                    })
                }
            }
            continue
        }
        pointer = verseStart.nextIndex

        let verseEnd: number | undefined
        if (tokens[pointer] === 'to' || tokens[pointer] === 'through' || tokens[pointer] === '-') {
            const rangeEnd = parseNumberFromTokens(tokens, pointer + 1)
            if (rangeEnd) {
                verseEnd = rangeEnd.value
                pointer = rangeEnd.nextIndex
            }
        }

        const reference = verseEnd
            ? `${alias.book} ${chapter.value}:${verseStart.value}-${verseEnd}`
            : `${alias.book} ${chapter.value}:${verseStart.value}`

        if (seen.has(reference)) continue
        seen.add(reference)

        const raw = tokens.slice(tokenIndex, pointer).join(' ')
        const startIndex = normalizedText.indexOf(raw, searchFrom)
        const endIndex = startIndex === -1 ? -1 : startIndex + raw.length
        if (startIndex !== -1) {
            searchFrom = endIndex
        }

        // Sanity-check: reject out-of-bounds verse numbers
        if (verseStart.value < 1 || verseStart.value > 176) {
            continue
        }

        // Sanity-check: reject impossible verse numbers for the specific book/chapter
        const maxVerses = BOOK_MAX_VERSES[alias.book]?.[chapter.value - 1]
        if (maxVerses && verseStart.value > maxVerses) {
            continue
        }
        if (verseEnd && maxVerses && verseEnd > maxVerses) {
            continue
        }

        // Higher confidence if both chapter and verse keywords are present
        const confidence = (hasChapterKeyword && hasVerseKeyword) ? 'high' : 'medium'

        detected.push({
            raw,
            reference,
            book: alias.book,
            chapter: chapter.value,
            verseStart: verseStart.value,
            verseEnd,
            startIndex: startIndex === -1 ? 0 : startIndex,
            endIndex: endIndex === -1 ? raw.length : endIndex,
            confidence,
        })

        tokenIndex = Math.max(tokenIndex, pointer - 1)
    }

    return detected
}

export function detectVerses(text: string): DetectedVerse[] {
    const detected: DetectedVerse[] = []
    const seen = new Set<string>()

    VERSE_PATTERN.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = VERSE_PATTERN.exec(text)) !== null) {
        const [fullMatch, bookText, chapterStr, verseStartStr, verseEndStr] = match

        const normalizedBook = normalizeBookName(bookText)
        if (!normalizedBook) continue

        const chapter = parseInt(chapterStr, 10)
        const verseStart = parseInt(verseStartStr, 10)

        // Sanity-check chapter bounds
        const maxChapter = BOOK_MAX_CHAPTER[normalizedBook]
        if (maxChapter !== undefined && chapter > maxChapter) {
            continue
        }

        // Check if this is followed by a time indicator (AM/PM) - not a verse
        const matchEnd = match.index + fullMatch.length
        const nextChars = text.slice(matchEnd, matchEnd + 3).toLowerCase()
        if (nextChars.includes('am') || nextChars.includes('pm')) {
            continue
        }

        // Sanity-check: reject impossible verse numbers for the specific book/chapter
        const maxVerses = BOOK_MAX_VERSES[normalizedBook]?.[chapter - 1]
        if (maxVerses && verseStart > maxVerses) {
            continue
        }
        if (verseEndStr && maxVerses && parseInt(verseEndStr, 10) > maxVerses) {
            continue
        }

        const reference = verseEndStr
            ? `${normalizedBook} ${chapter}:${verseStart}-${verseEndStr}`
            : `${normalizedBook} ${chapter}:${verseStart}`

        if (seen.has(reference)) continue
        seen.add(reference)

        detected.push({
            raw: fullMatch,
            reference,
            book: normalizedBook,
            chapter,
            verseStart,
            verseEnd: verseEndStr ? parseInt(verseEndStr, 10) : undefined,
            startIndex: match.index,
            endIndex: match.index + fullMatch.length,
            confidence: 'high',
        })
    }

    for (const pattern of ALTERNATIVE_PATTERNS) {
        pattern.lastIndex = 0
        while ((match = pattern.exec(text)) !== null) {
            // Reserved for future context-based extraction.
        }
    }

    for (const spokenVerse of detectSpokenVerses(text)) {
        if (seen.has(spokenVerse.reference)) continue
        seen.add(spokenVerse.reference)
        detected.push(spokenVerse)
    }

    // -----------------------------------------------------------------------
    // Heuristic fallback for common quoted verse fragments that ASR can mangle.
    // Data-driven so new patterns can be added without touching control flow.
    // Each entry: required substrings → DetectedVerse when matched.
    // -----------------------------------------------------------------------
    const normalized = text.toLowerCase()

    interface HeuristicVerse {
        reference: string
        book: string
        chapter: number
        verseStart: number
        raw: string
        anchor: string
        required: string[]
        optional: string[]
        // optional count of how many optionals must match (default: 1)
        minOptionalMatches?: number
    }

    const HEURISTIC_VERSES: HeuristicVerse[] = [
        {
            reference: 'Proverbs 18:10',
            book: 'Proverbs',
            chapter: 18,
            verseStart: 10,
            raw: 'name of the Lord is a strong tower',
            anchor: 'name of the lord',
            required: ['name of the lord'],
            optional: ['strong tower', 'strong tell', 'strong fort'],
        },
        {
            reference: 'Psalm 23:1',
            book: 'Psalm',
            chapter: 23,
            verseStart: 1,
            raw: 'The Lord is my shepherd',
            anchor: 'lord is my',
            required: ['lord is my'],
            optional: ['shepherd', 'ship', 'shipper'],
        },
        {
            reference: 'Psalm 84:10',
            book: 'Psalm',
            chapter: 84,
            verseStart: 10,
            raw: 'Better is one day in your courts',
            anchor: 'better is one day',
            required: ['better is one day', 'better is one'],
            optional: ['your house', 'your courts', 'your coat'],
            minOptionalMatches: 1,
        },
    ]

    for (const h of HEURISTIC_VERSES) {
        const already = detected.some(v => v.reference === h.reference)
        if (already) continue

        const requiredHit = h.required.some(r => normalized.includes(r))
        if (!requiredHit) continue

        const optionalHits = h.optional.filter(o => normalized.includes(o)).length
        const minOpt = h.minOptionalMatches ?? 1
        if (optionalHits < minOpt) continue

        const idx = Math.max(0, normalized.indexOf(h.anchor))
        detected.push({
            raw: h.raw,
            reference: h.reference,
            book: h.book,
            chapter: h.chapter,
            verseStart: h.verseStart,
            startIndex: idx,
            endIndex: idx + h.anchor.length,
            confidence: 'medium',
            detectionType: 'regex',
        })
    }

    return detected
}

export function verseToLabel(verse: DetectedVerse): string {
    const bookNum = BOOK_TO_NUMBER[verse.book]
    if (!bookNum) return ''

    if (verse.verseEnd) {
        return `${bookNum}:${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
    }
    return `${bookNum}:${verse.chapter}:${verse.verseStart}`
}

export function hasVerseReference(text: string): boolean {
    return detectVerses(text).length > 0
}

export function extractVerseFromContext(
    recentText: string,
    maxLength: number = 200
): DetectedVerse | null {
    const lastChars = recentText.slice(-maxLength)
    const verses = detectVerses(lastChars)

    if (verses.length === 0) return null
    return verses[verses.length - 1]
}

export function formatVerseForDisplay(verse: DetectedVerse): string {
    if (verse.verseEnd) {
        return `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
    }
    return `${verse.book} ${verse.chapter}:${verse.verseStart}`
}

export default {
    detectVerses,
    verseToLabel,
    hasVerseReference,
    extractVerseFromContext,
    formatVerseForDisplay,
    BOOK_TO_NUMBER,
}
