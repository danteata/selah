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
    detectionType?: 'regex' | 'semantic' | 'llm'
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
    'song of solomon': 'Song of Solomon', 'song of songs': 'Song of Solomon',
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
    'acts': 'Acts',
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
    //     fish in, fill up, core in, cor in, gal ation, he bread, song, songs, act).
    // These were causing false positives in everyday speech ("channel 5", "some people",
    // "look at", "current events", "ramon", "jeremy", "danny", "izzy", etc). "song"/"songs"
    // and "act" are especially dangerous in THIS app specifically: it manages a worship
    // song queue/lyrics feature as a first-class concept, so "song 2 verse 1" (about the
    // worship set) is completely ordinary operator speech, not a Song of Solomon
    // reference — and "act 3:16" (drama/script line) collides with "Acts".
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

// Derive "1st"/"2nd"/"3rd" ordinal-digit variants for every numbered-book
// alias already present ("1 samuel" -> "1st samuel", "2 corinthians" -> "2nd
// corinthians", etc.). ASR very commonly outputs the digit+suffix form for
// a spoken "First"/"Second"/"Third" — without this, only the fully
// spelled-out ordinal word ("Second Corinthians") or the bare digit ("2
// Corinthians") was recognized, silently missing "2nd Corinthians".
const ORDINAL_DIGIT_SUFFIXES: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd' }
for (const [alias, canonicalBook] of Object.entries({ ...BOOK_MAPPINGS })) {
    const match = alias.match(/^([123])\s+(.+)$/)
    if (!match) continue
    const [, digit, rest] = match
    const ordinalAlias = `${ORDINAL_DIGIT_SUFFIXES[digit]} ${rest}`
    if (!(ordinalAlias in BOOK_MAPPINGS)) {
        BOOK_MAPPINGS[ordinalAlias] = canonicalBook
    }
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
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
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

// Pattern for chapter and verse (supports : . - x × vs verse as separator)
// U+00D7 = multiplication sign (×) — Whisper sometimes outputs it for "verse"
// Spaces are intentionally NOT in the main separator list because they create
// too many false positives ("Genesis 7 1 was destroyed").  A dedicated
// fallback in detectSpokenVerses handles the "book chapter verse" case.
// Hyphen IS a chapter:verse separator by design in this app — "Genesis 1-3"
// means Genesis 1:3, not a chapter range — but it's still the most ambiguous
// separator (see hasAmbiguousSeparator below), so it's graded medium rather
// than high confidence.
// The separator is named ("sep") so confidence can be graded by how
// ambiguous it is — see the match loop below.
const CHAPTER_VERSE_PATTERN = '(\\d+)\\s*(?<sep>[:.-]|x|×|vs\\.?|versus|verse)\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+))?'

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
// Used to reject impossible verse references like "John 21:1000".
// Array index = chapter number - 1, value = max verse number in that chapter.
// Generated from public/bibles/kjv.json (ground truth) so counts stay accurate
// for every book, not just hand-transcribed ones.
export const BOOK_MAX_VERSES: Record<string, number[]> = {
    'Genesis': [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26],
    'Exodus': [22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
    'Leviticus': [17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
    'Numbers': [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
    'Deuteronomy': [46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12],
    'Joshua': [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
    'Judges': [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
    'Ruth': [22, 23, 18, 22],
    '1 Samuel': [28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22, 44, 25, 12, 25, 11, 31, 13],
    '2 Samuel': [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
    '1 Kings': [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
    '2 Kings': [18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30],
    '1 Chronicles': [54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30],
    '2 Chronicles': [17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23],
    'Ezra': [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
    'Nehemiah': [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
    'Esther': [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
    'Job': [22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17],
    'Psalms': [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6],
    'Proverbs': [33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31],
    'Ecclesiastes': [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
    'Song of Solomon': [17, 17, 11, 16, 16, 13, 13, 14],
    'Isaiah': [31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24],
    'Jeremiah': [19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34],
    'Lamentations': [22, 22, 66, 22, 22],
    'Ezekiel': [28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35],
    'Daniel': [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
    'Hosea': [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
    'Joel': [20, 32, 21],
    'Amos': [15, 16, 15, 13, 27, 14, 17, 14, 15],
    'Obadiah': [21],
    'Jonah': [17, 10, 10, 11],
    'Micah': [16, 13, 12, 13, 15, 16, 20],
    'Nahum': [15, 13, 19],
    'Habakkuk': [17, 20, 19],
    'Zephaniah': [18, 15, 20],
    'Haggai': [15, 23],
    'Zechariah': [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
    'Malachi': [14, 17, 18, 6],
    'Matthew': [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
    'Mark': [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
    'Luke': [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
    'John': [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
    'Acts': [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],
    'Romans': [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
    '1 Corinthians': [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
    '2 Corinthians': [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
    'Galatians': [24, 21, 29, 31, 26, 18],
    'Ephesians': [23, 22, 21, 32, 33, 24],
    'Philippians': [30, 30, 21, 23],
    'Colossians': [29, 23, 25, 18],
    '1 Thessalonians': [10, 20, 13, 18, 28],
    '2 Thessalonians': [12, 17, 18],
    '1 Timothy': [20, 15, 16, 16, 25, 21],
    '2 Timothy': [18, 26, 17, 22],
    'Titus': [16, 15, 15],
    'Philemon': [25],
    'Hebrews': [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
    'James': [27, 26, 18, 17, 20],
    '1 Peter': [25, 25, 22, 19, 14],
    '2 Peter': [21, 22, 18],
    '1 John': [10, 29, 24, 21, 21],
    '2 John': [13],
    '3 John': [14],
    'Jude': [25],
    'Revelation': [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
}

// Full verse detection pattern
const VERSE_PATTERN = new RegExp(
    `\\b(${BOOK_PATTERN})\\s+${CHAPTER_VERSE_PATTERN}\\b`,
    'gi'
)

const ALTERNATIVE_PATTERNS = [
    /chapter\s+(\d+)[,\s]+(?:(?:verse[s]?|versus)\s+)?(\d+)(?:\s+(?:to|through|-|\u2013|\u2014)\s*(\d+))?/gi,
    /(?:(?:verse[s]?|versus)\s+)?(\d+)\s+of\s+chapter\s+(\d+)/gi,
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

/**
 * True if `tokens` starting at `idx` spell out a *multi-token* book alias
 * (e.g. "1 john", "2 corinthians"). Used to stop a bare digit from being
 * consumed as the current book's chapter/verse when it's actually the
 * numbered prefix of the NEXT book mention.
 */
function tokenStartsAnotherBook(tokens: string[], idx: number): boolean {
    return getBookAliases().some(
        (candidate) =>
            candidate.aliasTokens.length > 1 &&
            candidate.aliasTokens.every((token, i) => tokens[idx + i] === token),
    )
}

type NumberScale = 'ones' | 'tens' | 'hundred'

// Only these previous->current scale transitions form a legitimate compound
// English number: "two HUNDRED" (ones->hundred, multiply), "hundred THIRTY"
// / "hundred THREE" (hundred->tens/ones, add), "twenty THREE" (tens->ones,
// add). Anything else — most importantly two bare ones-scale numbers in a
// row ("one three", digit tokens "1 3") — is NOT a compound number. It's two
// SEPARATE numbers (e.g. a spoken "chapter, verse" pair) and must not be
// summed together, or "Genesis one three" silently becomes chapter 4 instead
// of chapter 1 verse 3.
const ALLOWED_SCALE_TRANSITIONS: Record<NumberScale, Set<NumberScale>> = {
    ones: new Set<NumberScale>(['hundred']),
    tens: new Set<NumberScale>(['ones']),
    hundred: new Set<NumberScale>(['tens', 'ones']),
}

function isAllowedScaleTransition(prev: NumberScale, next: NumberScale): boolean {
    return ALLOWED_SCALE_TRANSITIONS[prev].has(next)
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
    let prevScale: NumberScale | null = null

    for (const token of tokens) {
        if (token === 'and') continue

        let tokenValue: number
        let isWordToken = false

        if (/^\d+$/.test(token)) {
            tokenValue = parseInt(token, 10)
        } else if (ORDINAL_WORDS[token] !== undefined) {
            tokenValue = ORDINAL_WORDS[token]
            isWordToken = true
        } else {
            const base = NUMBER_WORDS[token]
            if (base === undefined) return null
            tokenValue = base
            isWordToken = true
        }

        const scale: NumberScale =
            tokenValue === 100 ? 'hundred' :
            (isWordToken && tokenValue >= 20 && tokenValue % 10 === 0) ? 'tens' :
            'ones'

        if (prevScale !== null && !isAllowedScaleTransition(prevScale, scale)) {
            return null
        }

        if (tokenValue === 100) {
            value = value === 0 ? 100 : value * 100
        } else {
            value += tokenValue
        }
        hasNumberToken = true
        prevScale = scale
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
        // Hyphen is split into its own token boundary (not stripped outright)
        // so "Genesis 1-3" tokenizes as ["genesis","1","3"], letting the
        // normal chapter/verse parsing below treat them as two separate
        // numbers rather than one glued-together "1-3" token.
        .replace(/[.,;!?()[\]{}-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    if (!normalizedText) return []

    const bookAliases = getBookAliases()
    // Strip digit-ordinal suffixes ("6th" -> "6", "21st" -> "21") so
    // "the 6th chapter" parses as a plain number. Safe for book-name
    // matching too: e.g. "2nd corinthians" becomes "2 corinthians", which
    // is already a valid alias in its own right.
    const tokens = normalizedText.split(' ').map((token) => token.replace(/^(\d+)(?:st|nd|rd|th)$/, '$1'))
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

        // Skip a filler "the" before the chapter number/keyword, e.g.
        // "Ephesians the 6th chapter" / "Ephesians the sixth chapter".
        if (tokens[pointer] === 'the') {
            pointer += 1
        }

        // Check for "chapter" keyword before the number ("chapter 6")
        if (tokens[pointer] === 'chapter') {
            hasChapterKeyword = true
            pointer += 1
        }

        // Don't let a bare digit that's actually the numbered prefix of the
        // NEXT book mention (e.g. "1 John", "2 Corinthians") get swallowed as
        // THIS book's chapter/verse number. Without this guard, "James 1, 1
        // John 1 7" mis-parses as "James 1:1" + "John 1:7" — the second "1"
        // gets consumed as James's verse, which then causes the outer loop to
        // skip past it (see the `tokenIndex = Math.max(...)` fast-forward
        // below) and only find bare "John" instead of "1 John" afterward.
        if (tokenStartsAnotherBook(tokens, pointer)) continue

        // Parse chapter - spoken forms like "John three sixteen" are supported
        const chapterTokenStart = pointer
        const chapter = hasChapterKeyword
            ? parseNumberFromTokens(tokens, pointer, 4)  // Allow multi-word like "twenty three"
            : parseNumberFromTokens(tokens, pointer, 2)
        if (!chapter) continue
        pointer = chapter.nextIndex

        // "chapter" keyword can also follow the number, e.g. "the 6th
        // chapter" / "the sixth chapter" — as opposed to "chapter 6" above.
        if (!hasChapterKeyword && tokens[pointer] === 'chapter') {
            hasChapterKeyword = true
            pointer += 1
        }

        // Check for "verse" or "verses" keyword
        if (tokens[pointer] === 'verse' || tokens[pointer] === 'verses' || tokens[pointer] === 'versus') {
            hasVerseKeyword = true
            pointer += 1
        }

        if (tokenStartsAnotherBook(tokens, pointer)) continue

        // Parse verse - allow spoken style "John three sixteen" or "John 3 vs 16"
        let verseStart = hasVerseKeyword
            ? parseNumberFromTokens(tokens, pointer, 4)
            : parseNumberFromTokens(tokens, pointer, 2)

        // Sanity-check: reject wildly out-of-bounds chapter numbers (Whisper hallucinations)
        const maxChapter = BOOK_MAX_CHAPTER[alias.book]
        if (maxChapter !== undefined && chapter.value > maxChapter) {
            // A bare 3-digit chapter/verse pair collapsed into one number by
            // fast speech or ASR (e.g. "Matthew 542" meaning "Matthew 5:42")
            // is invalid as a standalone chapter. Try splitting it into
            // chapter+verse — but ONLY here, after treating the whole number
            // as a chapter has ALREADY failed bounds. This is the key fix
            // versus an earlier version of this heuristic: it never touches a
            // number that's already a VALID standalone chapter (e.g. "Psalm
            // 119", chapter 119 <= 150), so it can't mis-split that case into
            // "Psalms 1:19" the way the old heuristic did.
            const isSingleCompactToken =
                !verseStart &&
                chapter.nextIndex - chapterTokenStart === 1 &&
                /^\d{3}$/.test(tokens[chapterTokenStart])
            if (isSingleCompactToken) {
                const compact = parseInt(tokens[chapterTokenStart], 10)
                const splitChapter = Math.floor(compact / 100)
                const splitVerse = compact % 100
                const splitMaxVerses = BOOK_MAX_VERSES[alias.book]?.[splitChapter - 1]
                const splitValid =
                    splitChapter > 0 && splitChapter <= maxChapter &&
                    splitVerse > 0 && (!splitMaxVerses || splitVerse <= splitMaxVerses)
                if (splitValid) {
                    const reference = `${alias.book} ${splitChapter}:${splitVerse}`
                    if (!seen.has(reference)) {
                        seen.add(reference)
                        const raw = tokens.slice(tokenIndex, pointer).join(' ')
                        const startIndex = normalizedText.indexOf(raw, searchFrom)
                        const endIndex = startIndex === -1 ? -1 : startIndex + raw.length
                        if (startIndex !== -1) {
                            searchFrom = endIndex
                        }
                        detected.push({
                            raw,
                            reference,
                            book: alias.book,
                            chapter: splitChapter,
                            verseStart: splitVerse,
                            startIndex: startIndex === -1 ? 0 : startIndex,
                            endIndex: endIndex === -1 ? raw.length : endIndex,
                            confidence: 'medium',
                        })
                    }
                    tokenIndex = Math.max(tokenIndex, pointer - 1)
                }
            }
            continue
        }

        if (!verseStart) {
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
        // The named "sep" group still consumes a positional slot, so
        // verseStartStr/verseEndStr shift one index later than before.
        const [fullMatch, bookText, chapterStr, , verseStartStr, verseEndStr] = match
        const separator = match.groups?.sep ?? ''
        // Colon/period are unambiguous chapter:verse notation. "-"/"x"/"×"/
        // "vs"/the bare word "verse" are more easily produced by ordinary
        // non-scripture speech (e.g. "song 2 verse 1" about a worship song,
        // or a hyphen that could in principle mean a chapter range elsewhere)
        // — trust them less.
        const hasAmbiguousSeparator = /^(-|x|×|vs\.?|versus|verse)$/i.test(separator)

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
            confidence: hasAmbiguousSeparator ? 'medium' : 'high',
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
