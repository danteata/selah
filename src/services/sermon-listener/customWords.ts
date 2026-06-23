/**
 * Fuzzy custom-word correction.
 *
 * Ported from Handy's `audio_toolkit/text.rs` (`apply_custom_words`). Whisper
 * frequently mangles proper nouns and domain vocabulary — for a sermon that
 * means church names, staff/partner names, and theological terms ("Sermon on
 * the Mount" → "certain on the mount"). This corrects them using a combination
 * of:
 *   - Levenshtein distance (string similarity)
 *   - Soundex phonetic matching (pronunciation similarity)
 *   - n-gram matching over 1..3 words (so "Charge B" → "ChargeBee")
 *
 * It preserves the original case pattern (ALL CAPS / Title / lower) and any
 * surrounding punctuation. A 25%-length pre-filter prevents over-matching.
 *
 * Strictly better than exact-match: it tolerates the phonetic drift Whisper
 * routinely introduces. Intended to run LAST in the post-processing pipeline:
 *   raw → hallucination → filler → custom-words
 */

const MAX_CANDIDATE_LEN = 50

/** Classic Soundex code for a word (American Soundex, 4 chars). */
function soundex(word: string): string {
    const s = word.toUpperCase().replace(/[^A-Z]/g, '')
    if (s.length === 0) return ''

    const codeOf = (c: string): string => {
        if ('BFPV'.includes(c)) return '1'
        if ('CGJKQSXZ'.includes(c)) return '2'
        if ('DT'.includes(c)) return '3'
        if (c === 'L') return '4'
        if ('MN'.includes(c)) return '5'
        if (c === 'R') return '6'
        return '' // A, E, I, O, U, H, W, Y
    }

    const first = s[0]
    let result = first
    let prevCode = codeOf(first)

    for (let i = 1; i < s.length && result.length < 4; i++) {
        const c = s[i]
        const code = codeOf(c)
        if (code !== '' && code !== prevCode) {
            result += code
        }
        // H and W do not reset the "previous code" gate; vowels do.
        if (c !== 'H' && c !== 'W') {
            prevCode = code
        }
    }

    return (result + '000').slice(0, 4)
}

/** Standard iterative Levenshtein distance. */
function levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    let prev = new Array<number>(b.length + 1)
    let curr = new Array<number>(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        }
        ;[prev, curr] = [curr, prev]
    }

    return prev[b.length]
}

/**
 * Builds an n-gram key by stripping leading/trailing non-alphanumerics from
 * each word, lowercasing, and concatenating without spaces. This lets
 * "Charge B" match "ChargeBee".
 */
function buildNgram(words: string[]): string {
    return words
        .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase())
        .join('')
}

/**
 * Finds the best matching custom word for a candidate string, or null.
 * Lower score is better (0 = exact match).
 */
function findBestMatch(
    candidate: string,
    customWords: string[],
    customWordsNoSpace: string[],
    threshold: number,
    usePhonetic: boolean,
): { replacement: string; score: number } | null {
    if (candidate.length === 0 || candidate.length > MAX_CANDIDATE_LEN) return null

    let bestMatch: string | null = null
    let bestScore = Number.MAX_VALUE

    for (let i = 0; i < customWordsNoSpace.length; i++) {
        const target = customWordsNoSpace[i]

        // Length pre-filter: at most 25% difference (min 2 chars), prevents
        // n-grams from matching much shorter custom words.
        const lenDiff = Math.abs(candidate.length - target.length)
        const maxLen = Math.max(candidate.length, target.length)
        const maxAllowedDiff = Math.max(maxLen * 0.25, 2.0)
        if (lenDiff > maxAllowedDiff) continue

        const dist = levenshtein(candidate, target)
        const levenshteinScore = maxLen > 0 ? dist / maxLen : 1.0

        // Phonetic boost: when two strings share a Soundex code, treat them as
        // much closer. Powerful for user-curated vocab, but it also makes
        // unrelated long words collide (e.g. "prophet"/"propitiation" both code
        // P613), so it is opt-out for always-on default vocabularies.
        const phoneticMatch =
            usePhonetic && soundex(candidate) === soundex(target) && soundex(candidate) !== ''
        const combinedScore = phoneticMatch ? levenshteinScore * 0.3 : levenshteinScore

        if (combinedScore < threshold && combinedScore < bestScore) {
            bestMatch = customWords[i]
            bestScore = combinedScore
        }
    }

    return bestMatch !== null ? { replacement: bestMatch, score: bestScore } : null
}

export interface CustomWordsOptions {
    /** Longest n-gram (in words) to consider. Handy default is 3. Use 1 to
     *  match only single tokens — prevents an n-gram from swallowing adjacent
     *  words like "of righteousness" → "righteousness". */
    maxNgram?: number
    /** Whether to use Soundex phonetic matching. Default true (Handy parity).
     *  Disable for broad always-on vocabularies to avoid cross-word collisions. */
    usePhonetic?: boolean
}

/** Preserves the case pattern of `original` when applying `replacement`. */
function preserveCasePattern(original: string, replacement: string): string {
    const letters = original.replace(/[^\p{L}]/gu, '')
    if (letters.length > 0 && letters === letters.toUpperCase()) {
        return replacement.toUpperCase()
    }
    if (original.length > 0 && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1)
    }
    return replacement
}

/** Splits a word into [leading punctuation, trailing punctuation]. */
function extractPunctuation(word: string): [string, string] {
    const prefixMatch = word.match(/^[^\p{L}\p{N}]+/u)
    const suffixMatch = word.match(/[^\p{L}\p{N}]+$/u)
    const prefix = prefixMatch ? prefixMatch[0] : ''
    const suffix = suffixMatch ? suffixMatch[0] : ''
    return [prefix, suffix]
}

/**
 * Applies fuzzy custom-word corrections to transcribed text.
 *
 * @param text         Input transcript.
 * @param customWords  Vocabulary to match against (originals, for replacement).
 * @param threshold    Max similarity score to accept (0 = exact, 1 = anything).
 *                     0.5 is a good sermon default.
 */
export function applyCustomWords(
    text: string,
    customWords: string[],
    threshold = 0.5,
    options: CustomWordsOptions = {},
): string {
    if (!customWords || customWords.length === 0) return text

    const maxNgram = Math.max(1, options.maxNgram ?? 3)
    const usePhonetic = options.usePhonetic ?? true

    const customWordsLower = customWords.map((w) => w.toLowerCase())
    const customWordsNoSpace = customWordsLower.map((w) => w.replace(/ /g, ''))

    const words = text.split(/\s+/).filter((w) => w.length > 0)
    const result: string[] = []
    let i = 0

    while (i < words.length) {
        let matched = false

        // Greedy: try longest n-gram down to 1
        for (let n = maxNgram; n >= 1; n--) {
            if (i + n > words.length) continue

            const ngramWords = words.slice(i, i + n)
            const ngram = buildNgram(ngramWords)

            const match = findBestMatch(ngram, customWords, customWordsNoSpace, threshold, usePhonetic)
            if (match) {
                const [prefix] = extractPunctuation(ngramWords[0])
                const [, suffix] = extractPunctuation(ngramWords[n - 1])
                const corrected = preserveCasePattern(ngramWords[0], match.replacement)
                result.push(`${prefix}${corrected}${suffix}`)
                i += n
                matched = true
                break
            }
        }

        if (!matched) {
            result.push(words[i])
            i++
        }
    }

    return result.join(' ')
}

/**
 * A conservative default vocabulary for sermons: long, phonetically distinctive
 * proper nouns that Whisper reliably mangles and that are NOT homophones of
 * common English words. Short, ambiguous book names (Luke, Mark, Acts, Job)
 * are deliberately excluded here — they are handled context-guarded by
 * `hallucinationFilter.correctAccentMishearings` to avoid false positives.
 *
 * Apply with a tight threshold (≈0.35) so only genuinely close strings match.
 */
export const SERMON_PROPER_NOUNS: readonly string[] = [
    // Hard book names (long, distinctive)
    'Deuteronomy',
    'Ecclesiastes',
    'Lamentations',
    'Thessalonians',
    'Philippians',
    'Colossians',
    'Habakkuk',
    'Zephaniah',
    'Zechariah',
    'Nehemiah',
    'Philemon',
    // Hard-to-transcribe names
    'Nebuchadnezzar',
    'Melchizedek',
    'Methuselah',
    'Jehoshaphat',
    'Zerubbabel',
    'Mephibosheth',
    'Maccabees',
    'Sanhedrin',
    'Gethsemane',
    'Capernaum',
    // Distinctive theological terms
    'righteousness',
    'justification',
    'sanctification',
    'propitiation',
    'reconciliation',
    'tabernacle',
]

// Exposed for testing
export const __testing = { soundex, levenshtein, buildNgram, preserveCasePattern, extractPunctuation }
