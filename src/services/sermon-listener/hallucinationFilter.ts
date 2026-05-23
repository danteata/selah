/**
 * Hallucination Filter for Whisper Transcription
 *
 * Filters common Whisper hallucination patterns from transcript text
 * before verse detection runs, preventing false positives.
 *
 * Common Whisper hallucinations:
 * 1. Repetition loops (same phrase repeated 3+ times)
 * 2. Filler patterns during silence ("Thank you", "Thanks for watching")
 * 3. Numerically implausible references (chapter > 999)
 */

const REPETITION_THRESHOLD = 3

const FILLER_PATTERNS: RegExp[] = [
    /\bthank\s+you\b.*\bthank\s+you\b/i,
    /\bthanks\s+for\s+watching\b/i,
    /\bsubscribe\b.*\blike\b/i,
    /\bplease\s+subscribe\b/i,
    /\bcomment\s+below\b/i,
    /\blike\s+and\s+subscribe\b/i,
    /\bthanks\s+for\s+listening\b/i,
    /\bthank\s+you\s+for\s+listening\b/i,
    /\byou\s+can\s+find\s+us\b/i,
    /\bvisit\s+our\s+website\b/i,
    /\bfollow\s+us\s+on\b/i,
]

// Common English profanities that Whisper sometimes hallucinates or
// mis-transcribes (e.g. "a far country" -> "a fuck country").
// In a church context these are almost always transcription errors.
const PROFANITY_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\bf+u+c+k+\b/gi, replacement: '[censored]' },
    { pattern: /\bs+h+i+t+\b/gi, replacement: '[censored]' },
    { pattern: /\bd+a+m+n+\b/gi, replacement: '[censored]' },
    { pattern: /\bh+e+l+l+\b/gi, replacement: '[censored]' },
    { pattern: /\ba+s+s+h+o+l+e+\b/gi, replacement: '[censored]' },
    { pattern: /\bb+i+t+c+h+\b/gi, replacement: '[censored]' },
    { pattern: /\ba+s+s+\b/gi, replacement: '[censored]' },
    { pattern: /\bc+u+n+t+\b/gi, replacement: '[censored]' },
    { pattern: /\bd+i+c+k+\b/gi, replacement: '[censored]' },
    { pattern: /\bn+i+g+g+e+r+\b/gi, replacement: '[censored]' },
    { pattern: /\bf+a+g+\b/gi, replacement: '[censored]' },
    { pattern: /\bb+a+s+t+a+r+d+\b/gi, replacement: '[censored]' },
]

function removeProfanity(text: string): { text: string; removed: number } {
    let cleaned = text
    let removed = 0
    for (const { pattern, replacement } of PROFANITY_REPLACEMENTS) {
        const before = cleaned
        cleaned = cleaned.replace(pattern, replacement)
        if (cleaned !== before) {
            removed += (before.match(pattern) || []).length
        }
    }
    return { text: cleaned, removed }
}

export interface HallucinationFilterResult {
    cleanedText: string
    hadHallucination: boolean
    repetitionsRemoved: number
    fillersRemoved: number
    profanityRemoved: number
    confidence: number
}

function removeRepetitionLoops(text: string): { text: string; removed: number } {
    const words = text.split(/\s+/)
    if (words.length < 6) return { text, removed: 0 }

    let removed = 0
    const result: string[] = []

    let i = 0
    while (i < words.length) {
        let foundRepetition = false

        for (let phraseLen = Math.min(10, Math.floor(words.length / REPETITION_THRESHOLD)); phraseLen >= 2; phraseLen--) {
            if (i + phraseLen > words.length) continue

            const phrase = words.slice(i, i + phraseLen).join(' ').toLowerCase()
            let repeatCount = 1

            let j = i + phraseLen
            while (j + phraseLen <= words.length) {
                const nextPhrase = words.slice(j, j + phraseLen).join(' ').toLowerCase()
                if (nextPhrase === phrase) {
                    repeatCount++
                    j += phraseLen
                } else {
                    break
                }
            }

            if (repeatCount >= REPETITION_THRESHOLD) {
                result.push(words.slice(i, i + phraseLen).join(' '))
                removed += repeatCount - 1
                i = j
                foundRepetition = true
                break
            }
        }

        if (!foundRepetition) {
            result.push(words[i])
            i++
        }
    }

    return { text: result.join(' '), removed }
}

function removeFillerPatterns(text: string): { text: string; removed: number } {
    let cleaned = text
    let removed = 0

    for (const pattern of FILLER_PATTERNS) {
        const match = cleaned.match(pattern)
        if (match) {
            cleaned = cleaned.replace(pattern, '')
            removed++
        }
    }

    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
    return { text: cleaned, removed }
}

function hasImplausibleReferences(text: string): boolean {
    const largeNumberPattern = /\b(\d{3,})\b/g
    let match: RegExpExecArray | null
    while ((match = largeNumberPattern.exec(text)) !== null) {
        const num = parseInt(match[1], 10)
        if (num > 999) return true
    }
    return false
}

export function filterHallucinations(text: string): HallucinationFilterResult {
    if (!text || text.trim().length === 0) {
        return {
            cleanedText: text,
            hadHallucination: false,
            repetitionsRemoved: 0,
            fillersRemoved: 0,
            profanityRemoved: 0,
            confidence: 1,
        }
    }

    let current = text
    let totalRepetitionsRemoved = 0
    let totalFillersRemoved = 0

    // Remove profanity first so it doesn't skew verse detection
    const { text: afterProfanity, removed: profRemoved } = removeProfanity(current)
    current = afterProfanity
    const totalProfanityRemoved = profRemoved

    const { text: afterRepetition, removed: repRemoved } = removeRepetitionLoops(current)
    current = afterRepetition
    totalRepetitionsRemoved += repRemoved

    const { text: afterFillers, removed: fillRemoved } = removeFillerPatterns(current)
    current = afterFillers
    totalFillersRemoved += fillRemoved

    const hadHallucination = totalRepetitionsRemoved > 0 || totalFillersRemoved > 0 || totalProfanityRemoved > 0
    const hasImplausible = hasImplausibleReferences(current)

    let confidence = 1
    if (hadHallucination) confidence = 0.7
    if (hasImplausible) confidence = Math.min(confidence, 0.8)

    return {
        cleanedText: current,
        hadHallucination,
        repetitionsRemoved: totalRepetitionsRemoved,
        fillersRemoved: totalFillersRemoved,
        profanityRemoved: totalProfanityRemoved,
        confidence,
    }
}