/**
 * Builds the Whisper `initial_prompt` used to bias the decoder toward Bible /
 * sermon vocabulary BEFORE generation. Biasing up front gives much higher
 * recall for scripture references and hard proper nouns than patching the
 * output afterwards (see hallucinationFilter / customWords, which still run as
 * a safety net). Item #6 of the Handy inspiration notes.
 *
 * Whisper truncates the prompt to roughly the last 224 tokens, so we keep the
 * canonical book list first and append the harder, lower-frequency names —
 * those are the ones that benefit most from biasing and are cheapest to lose.
 */

import { SERMON_PROPER_NOUNS } from './customWords'

/** Canonical 66-book list (deduped display names) used to prime the decoder. */
const BIBLE_BOOKS =
    'Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth Samuel Kings ' +
    'Chronicles Ezra Nehemiah Esther Job Psalms Proverbs Ecclesiastes Song Isaiah ' +
    'Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos Obadiah Jonah Micah Nahum ' +
    'Habakkuk Zephaniah Haggai Zechariah Malachi Matthew Mark Luke John Acts Romans ' +
    'Corinthians Galatians Ephesians Philippians Colossians Thessalonians Timothy ' +
    'Titus Philemon Hebrews James Peter John Jude Revelation'

/**
 * Build the Whisper initial prompt.
 *
 * @param extraTerms Optional session-specific vocabulary (e.g. the church name,
 *   staff/partner names, or the passage currently being preached) appended after
 *   the standard vocabulary so the decoder is biased toward this sermon.
 */
export function buildBibleInitialPrompt(extraTerms: string[] = []): string {
    const parts = [
        'Bible sermon.',
        `Books: ${BIBLE_BOOKS}.`,
        // Hard, low-frequency proper nouns Whisper routinely mangles.
        `Names: ${[...SERMON_PROPER_NOUNS].join(' ')}.`,
        'Chapter verse.',
    ]

    const extras = extraTerms.map((t) => t.trim()).filter((t) => t.length > 0)
    if (extras.length > 0) {
        parts.push(`${extras.join(' ')}.`)
    }

    return parts.join(' ')
}
