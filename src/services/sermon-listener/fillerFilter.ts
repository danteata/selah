/**
 * Language-aware filler-word and stutter filtering.
 *
 * Ported from Handy's `audio_toolkit/text.rs` (`filter_transcription_output`).
 * Whisper transcripts of slow or deliberate speakers — common in sermons —
 * are littered with filler tokens ("uh", "um", "hmm") and stutter artifacts
 * ("wh wh wh why"). This removes them in a language-correct way.
 *
 * The crucial correctness call carried over from Handy: the conservative
 * fallback (unknown language) deliberately EXCLUDES "um", "eh", and "ha"
 * because they are real words in several languages (Portuguese "um" = "a/an",
 * Spanish "ha" = "has"). Removing them blindly corrupts non-English text.
 *
 * Intended order in the post-processing pipeline (see useSermonListener):
 *   raw → hallucination → filler → custom-words
 * Each layer assumes a clean input from the previous one.
 */

const STUTTER_THRESHOLD = 3

/**
 * Returns the filler words appropriate for the given (BCP-47-ish) language
 * code. Only the leading subtag is used, so "pt-BR" maps to "pt".
 */
function getFillerWordsForLanguage(lang: string): string[] {
    const baseLang = (lang || '').split(/[-_]/)[0].toLowerCase()

    switch (baseLang) {
        case 'en':
            return ['uh', 'um', 'uhm', 'umm', 'uhh', 'uhhh', 'ah', 'hmm', 'hm', 'mmm', 'mm', 'mh', 'eh', 'ehh', 'ha']
        case 'es':
            return ['ehm', 'mmm', 'hmm', 'hm']
        case 'pt':
            return ['ahm', 'hmm', 'mmm', 'hm']
        case 'fr':
            return ['euh', 'hmm', 'hm', 'mmm']
        case 'de':
            return ['äh', 'ähm', 'hmm', 'hm', 'mmm']
        case 'it':
            return ['ehm', 'hmm', 'mmm', 'hm']
        case 'cs':
            return ['ehm', 'hmm', 'mmm', 'hm']
        case 'pl':
            return ['hmm', 'mmm', 'hm']
        case 'tr':
            return ['hmm', 'mmm', 'hm']
        case 'ru':
            return ['хм', 'ммм', 'hmm', 'mmm']
        case 'uk':
            return ['хм', 'ммм', 'hmm', 'mmm']
        case 'ar':
            return ['hmm', 'mmm']
        case 'ja':
            return ['hmm', 'mmm']
        case 'ko':
            return ['hmm', 'mmm']
        case 'vi':
            return ['hmm', 'mmm', 'hm']
        case 'zh':
            return ['hmm', 'mmm']
        default:
            // Conservative universal fallback (no "um", "eh", "ha")
            return ['uh', 'uhm', 'umm', 'uhh', 'uhhh', 'ah', 'hmm', 'hm', 'mmm', 'mm', 'mh', 'ehh']
    }
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Collapses 3+ consecutive identical (case-insensitive) all-alphabetic words
 * to a single instance. E.g. "wh wh wh wh" → "wh", "I I I I" → "I".
 * Two repetitions ("no no") are intentionally preserved — they are usually
 * deliberate emphasis, not a stutter.
 */
function collapseStutters(text: string): string {
    const words = text.split(/\s+/).filter((w) => w.length > 0)
    if (words.length === 0) return text

    const result: string[] = []
    let i = 0

    while (i < words.length) {
        const word = words[i]
        const wordLower = word.toLowerCase()

        // Only collapse purely alphabetic tokens (skip numbers, punctuation-bearing tokens)
        if (/^[\p{L}]+$/u.test(wordLower)) {
            let count = 1
            while (i + count < words.length && words[i + count].toLowerCase() === wordLower) {
                count++
            }
            // Always push one instance; advance past the whole run if it was a stutter
            result.push(word)
            i += count >= STUTTER_THRESHOLD ? count : 1
        } else {
            result.push(word)
            i++
        }
    }

    return result.join(' ')
}

export interface FillerFilterOptions {
    /** Language code used to select filler words (e.g. "en", "pt-BR"). */
    lang?: string
    /**
     * User-provided filler list. Overrides language defaults entirely.
     * An empty array disables filler removal (stutter collapse still runs).
     * `undefined` uses the language defaults.
     */
    customFillerWords?: string[]
}

/**
 * Filters raw transcription text by removing filler words (language-aware)
 * and collapsing stutter artifacts, then normalizes whitespace.
 */
export function filterFillers(text: string, options: FillerFilterOptions = {}): string {
    if (!text || text.trim().length === 0) return text

    const { lang = 'en', customFillerWords } = options

    const fillerWords = customFillerWords !== undefined
        ? customFillerWords
        : getFillerWordsForLanguage(lang)

    let filtered = text

    // Remove filler words (case-insensitive, with optional trailing , or .)
    for (const word of fillerWords) {
        if (!word) continue
        const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b[,.]?`, 'giu')
        filtered = filtered.replace(pattern, '')
    }

    // Collapse stutter runs
    filtered = collapseStutters(filtered)

    // Normalize whitespace and trim
    filtered = filtered.replace(/\s{2,}/g, ' ').trim()

    return filtered
}

// Exposed for testing
export const __testing = { getFillerWordsForLanguage, collapseStutters }
