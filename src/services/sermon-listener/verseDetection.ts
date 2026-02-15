/**
 * Bible Verse Detection Service
 * Parses text to detect Bible verse references in various formats
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
    'ps': 'Psalms', 'psalm': 'Psalms', 'psalms': 'Psalms',
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
    'matt': 'Matthew', 'mat': 'Matthew', 'matthew': 'Matthew',
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
        // Escape special regex characters
        const escaped = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        bookPatterns.push(escaped)
    }

    // Sort by length (longest first) to match more specific patterns first
    return bookPatterns.sort((a, b) => b.length - a.length).join('|')
}

// Main regex pattern for detecting Bible verses
const BOOK_PATTERN = buildBookPattern()

// Pattern for chapter and verse
const CHAPTER_VERSE_PATTERN = '(\\d+)\\s*[:\\.]\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+))?'

// Full verse detection pattern
const VERSE_PATTERN = new RegExp(
    `\\b(${BOOK_PATTERN})\\s+${CHAPTER_VERSE_PATTERN}\\b`,
    'gi'
)

// Alternative patterns for different formats
const ALTERNATIVE_PATTERNS = [
    // "chapter 3 verse 16" or "chapter 3 verses 16 to 20"
    /chapter\s+(\d+)[,\s]+(?:verse[s]?\s+)?(\d+)(?:\s+(?:to|through|-|\u2013|\u2014)\s*(\d+))?/gi,
    // "verse 16 of chapter 3"
    /(?:verse[s]?\s+)?(\d+)\s+of\s+chapter\s+(\d+)/gi,
]

/**
 * Normalize book name to standard form
 */
function normalizeBookName(bookText: string): string | null {
    const normalized = bookText.toLowerCase().trim()

    // Direct mapping
    if (BOOK_MAPPINGS[normalized]) {
        return BOOK_MAPPINGS[normalized]
    }

    // Handle Roman numerals
    const romanToArabic: Record<string, string> = {
        'i': '1', 'ii': '2', 'iii': '3',
        'I': '1', 'II': '2', 'III': '3',
    }

    // Try to match with Roman numeral conversion
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

/**
 * Detect Bible verse references in text
 */
export function detectVerses(text: string): DetectedVerse[] {
    const detected: DetectedVerse[] = []
    const seen = new Set<string>()

    // Reset regex state
    VERSE_PATTERN.lastIndex = 0

    // Main pattern matching
    let match: RegExpExecArray | null
    while ((match = VERSE_PATTERN.exec(text)) !== null) {
        const [fullMatch, bookText, chapter, verseStart, verseEnd] = match

        const normalizedBook = normalizeBookName(bookText)
        if (!normalizedBook) continue

        const reference = verseEnd
            ? `${normalizedBook} ${chapter}:${verseStart}-${verseEnd}`
            : `${normalizedBook} ${chapter}:${verseStart}`

        // Avoid duplicates
        if (seen.has(reference)) continue
        seen.add(reference)

        detected.push({
            raw: fullMatch,
            reference,
            book: normalizedBook,
            chapter: parseInt(chapter, 10),
            verseStart: parseInt(verseStart, 10),
            verseEnd: verseEnd ? parseInt(verseEnd, 10) : undefined,
            startIndex: match.index,
            endIndex: match.index + fullMatch.length,
            confidence: 'high',
        })
    }

    // Alternative pattern matching (lower confidence)
    for (const pattern of ALTERNATIVE_PATTERNS) {
        pattern.lastIndex = 0
        while ((match = pattern.exec(text)) !== null) {
            // These patterns need context to determine the book
            // For now, we'll skip these as they require more context analysis
            // This could be enhanced with NLP or context-aware parsing
        }
    }

    return detected
}

/**
 * Convert detected verse to internal label format (book:chapter:verse)
 */
export function verseToLabel(verse: DetectedVerse): string {
    const bookNum = BOOK_TO_NUMBER[verse.book]
    if (!bookNum) return ''

    if (verse.verseEnd) {
        return `${bookNum}:${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
    }
    return `${bookNum}:${verse.chapter}:${verse.verseStart}`
}

/**
 * Check if a string contains potential verse references
 */
export function hasVerseReference(text: string): boolean {
    VERSE_PATTERN.lastIndex = 0
    return VERSE_PATTERN.test(text)
}

/**
 * Extract the most likely verse from recent transcription context
 * This helps when a verse reference is split across multiple transcription segments
 */
export function extractVerseFromContext(
    recentText: string,
    maxLength: number = 200
): DetectedVerse | null {
    const lastChars = recentText.slice(-maxLength)
    const verses = detectVerses(lastChars)

    if (verses.length === 0) return null

    // Return the last detected verse (most recent)
    return verses[verses.length - 1]
}

/**
 * Format verse for display
 */
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