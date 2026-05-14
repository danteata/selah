/**
 * Text Preparation Web Worker
 *
 * Offloads sentence splitting, deduplication, and sliding-window generation
 * from the main thread so the sermon-listener UI stays responsive during
 * long transcripts.
 */

// ---------------------------------------------------------------------------
// Shared constants (must match semanticVerseDetection.ts)
// ---------------------------------------------------------------------------
const MIN_SENTENCE_LENGTH = 15
const SLIDING_WINDOW_SIZE = 60
const SLIDING_WINDOW_STRIDE = 20

// ---------------------------------------------------------------------------
// Cached regex (compiled once at module load)
// ---------------------------------------------------------------------------
const ABBREVIATIONS = [
    'St', 'Dr', 'Mr', 'Mrs', 'Ms', 'Rev', 'Prof', 'Sr', 'Jr', 'Mister', 'Madam', 'Miss',
    'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', 'Sam', 'Kgs', 'Chron', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Pss', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
    'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', 'Cor', 'Gal', 'Eph', 'Phil', 'Col', 'Thess', 'Tim', 'Tit', 'Phlm', 'Heb', 'Jas', 'Pet', 'Jude', 'Rev',
    'vs', 'etc', 'e', 'i', 'cf', 'v', 'vv', 'ch', 'chs', 'chap', 'chaps', 'Ref', 'Vol', 'Pg', 'p', 'pp',
]

const BOOK_PATTERN =
    'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation'

const ABBREV_PATTERN = ABBREVIATIONS.join('|')
const SENTENCE_REGEX = new RegExp(
    `(?<!\\b(?:${ABBREV_PATTERN}))` +
    `(?<!\\d)` +
    `(?<!\\s[A-Z])` +
    `[.!?]` +
    `(?=\\s+(?:[A-Z]|["'\\(])|\\s*$)`,
    'g',
)

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

interface PrepareRequest {
    id: number
    text: string
    excludedRanges: Array<{ startIndex: number; endIndex: number }>
}

interface PrepareSuccessResponse {
    id: number
    sentences: string[]
    dedupedSentences: string[]
    windows: string[]
}

interface PrepareErrorResponse {
    id: number
    error: string
}

type PrepareResponse = PrepareSuccessResponse | PrepareErrorResponse

// ---------------------------------------------------------------------------
// Text utilities (mirror of semanticVerseDetection.ts)
// ---------------------------------------------------------------------------

function containsExplicitVerseReference(text: string): boolean {
    const bookVersePattern = new RegExp(`\\b(${BOOK_PATTERN})\\s+\\d{1,3}[:\\s]\\d{1,3}`, 'i')
    const chapterVersePattern = /\bchapter\s+\d{1,3}\s+(?:verse\s+)?\d{1,3}/i
    const bookChapterPattern = new RegExp(`\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?\\d{1,3}`, 'i')
    return bookVersePattern.test(text) || chapterVersePattern.test(text) || bookChapterPattern.test(text)
}

function splitIntoSentences(text: string): string[] {
    const sentences: string[] = []
    const doubleSpaceParts = text.split(/\s{2,}/)

    for (const part of doubleSpaceParts) {
        // Use the pre-compiled regex — no recompilation every call
        const sentenceParts = part.split(SENTENCE_REGEX)
        for (const sentence of sentenceParts) {
            if (typeof sentence !== 'string') continue
            const trimmed = sentence.trim()
            if (trimmed.length >= MIN_SENTENCE_LENGTH) {
                sentences.push(trimmed)
            }
        }
    }
    return sentences
}

function generateSlidingWindows(text: string): string[] {
    const windows: string[] = []
    if (text.length <= SLIDING_WINDOW_SIZE) {
        return [text]
    }
    for (let i = 0; i <= text.length - SLIDING_WINDOW_SIZE; i += SLIDING_WINDOW_STRIDE) {
        windows.push(text.slice(i, i + SLIDING_WINDOW_SIZE))
    }
    const lastWindow = text.slice(-SLIDING_WINDOW_SIZE)
    if (!windows.includes(lastWindow)) {
        windows.push(lastWindow)
    }
    return windows
}

function charSimilarity(a: string, b: string): number {
    const la = a.toLowerCase()
    const lb = b.toLowerCase()
    if (la === lb) return 1
    const shorter = la.length < lb.length ? la : lb
    const longer = la.length < lb.length ? lb : la
    if (shorter.length === 0) return 0
    let matches = 0
    let j = 0
    for (let i = 0; i < longer.length && j < shorter.length; i++) {
        if (longer[i] === shorter[j]) {
            matches++
            j++
        }
    }
    return (2 * matches) / (la.length + lb.length)
}

function dedupeASRSentences(sentences: string[], similarityThreshold = 0.55): string[] {
    if (sentences.length <= 1) return sentences
    const kept: string[] = []
    const discarded = new Set<number>()
    for (let i = 0; i < sentences.length; i++) {
        if (discarded.has(i)) continue
        for (let j = i + 1; j < sentences.length; j++) {
            if (discarded.has(j)) continue
            const sim = charSimilarity(sentences[i], sentences[j])
            if (sim >= similarityThreshold) {
                const shorterIdx = sentences[i].length <= sentences[j].length ? i : j
                discarded.add(shorterIdx)
            }
        }
    }
    for (let i = 0; i < sentences.length; i++) {
        if (!discarded.has(i)) kept.push(sentences[i])
    }
    return kept
}

function excludeRangesFromText(text: string, ranges: Array<{ startIndex: number; endIndex: number }>): string {
    if (ranges.length === 0) return text
    const sortedRanges = [...ranges].sort((a, b) => b.startIndex - a.startIndex)
    let result = text
    for (const range of sortedRanges) {
        if (range.startIndex >= 0 && range.endIndex <= text.length && range.startIndex < range.endIndex) {
            const spaces = ' '.repeat(range.endIndex - range.startIndex)
            result = result.slice(0, range.startIndex) + spaces + result.slice(range.endIndex)
        }
    }
    return result
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<PrepareRequest>) => {
    const { id, text, excludedRanges } = event.data
    try {
        const textWithoutReferences = excludeRangesFromText(text, excludedRanges)
        const sentences = splitIntoSentences(textWithoutReferences)
        const dedupedSentences = dedupeASRSentences(
            Array.from(new Set(sentences)).filter(
                (sentence) => sentence.length >= MIN_SENTENCE_LENGTH && !containsExplicitVerseReference(sentence),
            ),
        )
        const windows = generateSlidingWindows(textWithoutReferences).filter(
            (window) => !containsExplicitVerseReference(window),
        )
        const response: PrepareSuccessResponse = { id, sentences, dedupedSentences, windows }
        self.postMessage(response)
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const response: PrepareErrorResponse = { id, error }
        self.postMessage(response)
    }
}
