/**
 * Numbers in transcripts of sung lyrics.
 *
 * Song libraries spell numbers out ("ten thousand reasons", "a thousand
 * tongues"); speech recognisers mostly write them as digits ("10,000
 * reasons"). Matched as-is the two never meet, and the singing check used to
 * reject any window with a digit in it as spoken — so "10,000 Reasons" could
 * not be detected however clearly it was sung.
 *
 * Two jobs here. `isSpokenNumberContext` keeps what genuinely marks speech —
 * money, percentages, calendar years, clock times and Bible references, phone
 * numbers, ages — and `spellOutNumbers` turns every other number into the
 * words a lyric would use.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: Array<[number, string]> = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand']]
const ORDINAL_WORD: Record<string, string> = {
    one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
}

function underThousand(n: number): string {
    const parts: string[] = []
    if (n >= 100) {
        parts.push(ONES[Math.floor(n / 100)], 'hundred')
        n %= 100
    }
    if (n >= 20) {
        parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}` : TENS[Math.floor(n / 10)])
    } else if (n > 0 || parts.length === 0) {
        parts.push(ONES[n])
    }
    return parts.join(' ')
}

/** 0 … 999,999,999,999 as words: 10000 → "ten thousand". */
export function numberToWords(n: number): string {
    if (!Number.isSafeInteger(n) || n < 0) return String(n)
    if (n < 1000) return underThousand(n)
    const parts: string[] = []
    for (const [value, name] of SCALES) {
        if (n >= value) {
            parts.push(underThousand(Math.floor(n / value)), name)
            n %= value
        }
    }
    if (n > 0) parts.push(underThousand(n))
    return parts.join(' ')
}

function toOrdinal(words: string): string {
    const all = words.split(' ')
    const last = all.pop()!
    const ord = ORDINAL_WORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
    return [...all, ord].join(' ')
}

const CURRENCY = /[$£€₵¢₦]\s?\d|\d\s?(?:cedis?|pesewas?|dollars?|pounds?|euros?|naira|ghc|gh₵|bucks)\b|\bgh[c₵]\s?\d/i
const PERCENT = /\d\s?(?:%|percent\b|per cent\b)/i
const CALENDAR_YEAR = /\b(?:1[89]\d{2}|20\d{2})\b(?![,.]?\d)/
const CLOCK_OR_REFERENCE = /\b\d{1,3}:\d{1,3}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)(?!\w)/i
const LONG_DIGIT_RUN = /\d{7,}/
const AGE = /\d+\s*(?:-|\s)?(?:years?|yrs?)\s*(?:-|\s)?old\b/i

/** True when a number in `text` is the kind only speech carries. */
export function isSpokenNumberContext(text: string): boolean {
    return CURRENCY.test(text) || PERCENT.test(text) || CALENDAR_YEAR.test(text)
        || CLOCK_OR_REFERENCE.test(text) || LONG_DIGIT_RUN.test(text) || AGE.test(text)
}

/**
 * Replace each whole number (with or without thousands separators) and each
 * ordinal ("1st", "21st") with words. Decimals and numbers glued to letters
 * ("3a", "9am") are left alone — they are not lyrics either way. After "a" or
 * "an", a leading "one" is dropped, as lyrics say it: "a 1000 tongues" →
 * "a thousand tongues".
 */
export function spellOutNumbers(text: string): string {
    return text.replace(
        /(?<![\p{L}\p{N}_.])(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)?(?![\p{L}\p{N}_]|[.,]\d)/giu,
        (match, digits: string, suffix: string | undefined, offset: number) => {
            const n = Number(digits.replace(/,/g, ''))
            if (!Number.isSafeInteger(n) || n > 999_999_999_999) return match
            let words = numberToWords(n)
            if (suffix) return toOrdinal(words)
            if (/\ban?\s+$/i.test(text.slice(Math.max(0, offset - 4), offset)) && words.startsWith('one ')) {
                words = words.slice(4)
            }
            return words
        },
    )
}
