/**
 * Active Reference Context
 *
 * Maintains the most recently detected book+chapter across transcript chunks
 * so that bare references like "verse 6" (without a book name) can be
 * resolved using sermon context.
 *
 * Flow:
 * 1. A full reference is detected (e.g. "Ephesians 6:1") → context is set.
 * 2. A later chunk says "and now verse 6" → resolver uses context → Ephesians 6:6.
 * 3. Context expires after TTL (default 120 s) to avoid stale resolution.
 */

import type { DetectedVerse } from './verseDetection'
import { parseSpokenNumber } from './verseDetection'

export interface ActiveReferenceContext {
    book: string
    chapter: number
    setAt: number
}

const DEFAULT_TTL_MS = 120_000

export function createContext(book: string, chapter: number): ActiveReferenceContext {
    return { book, chapter, setAt: Date.now() }
}

export function isContextValid(
    context: ActiveReferenceContext | null,
    ttlMs: number = DEFAULT_TTL_MS,
): context is ActiveReferenceContext {
    if (!context) return false
    return Date.now() - context.setAt <= ttlMs
}

export function updateContextFromVerse(
    verse: DetectedVerse,
): ActiveReferenceContext {
    return { book: verse.book, chapter: verse.chapter, setAt: Date.now() }
}

// ---------------------------------------------------------------------------
// Bare-reference resolution
// ---------------------------------------------------------------------------

// "versus" is accepted alongside "verse"/"verses" \u2014 Whisper very commonly
// mishears a bare spoken "verse" as "versus" (phonetically close), confirmed
// repeatedly across real sermon transcripts.
const BARE_VERSE_PATTERN = /\b(?:verse|verses|versus)\s+(\d{1,3}|[a-z]+)\b/gi
const BARE_VERSE_RANGE_PATTERN = /\b(?:verse|verses|versus)\s+(\d{1,3}|[a-z]+)\s+(?:to|through|-|\u2013|\u2014)\s+(\d{1,3}|[a-z]+)\b/gi
const BARE_CHAPTER_PATTERN = /\bchapter\s+(\d{1,3}|[a-z]+)\b/gi

// A preacher very often announces "Book chapter N" and then, in its OWN
// separate ASR utterance a moment later, gives just the verse number with
// NO "verse"/"versus" keyword at all ("Hebrews 13" ... "Five.") \u2014 the word
// gets clipped by the speech engine's pause-based chunking, or simply isn't
// said as clearly the second time. Unlike BARE_VERSE_PATTERN (which needs an
// explicit keyword and can safely scan a whole paragraph), this has no
// keyword to anchor on, so it only fires when the ENTIRE utterance is
// nothing but a number \u2014 never against a number embedded in ordinary
// sentence text, where it would be far too easy to misfire on an unrelated
// count, date, or quantity.
const STANDALONE_NUMBER_PATTERN = /^\s*(\d{1,3}|[a-z]+)\s*\.?\s*$/i

interface BareMatch {
    raw: string
    verseStart: number
    verseEnd?: number
    startIndex: number
    endIndex: number
}

function findBareVerseMatches(text: string): BareMatch[] {
    const matches: BareMatch[] = []
    const seen = new Set<string>()

    // Ranges first (greedy) so "verse 6 to 10" is captured as a range,
    // not as two overlapping single-verse matches.
    let m: RegExpExecArray | null
    BARE_VERSE_RANGE_PATTERN.lastIndex = 0
    while ((m = BARE_VERSE_RANGE_PATTERN.exec(text)) !== null) {
        const startStr = m[1]
        const endStr = m[2]
        const startNum = parseSpokenNumber(startStr) ?? parseInt(startStr, 10)
        const endNum = parseSpokenNumber(endStr) ?? parseInt(endStr, 10)
        if (startNum && endNum && startNum >= 1 && endNum >= 1 && startNum <= 176 && endNum <= 176) {
            const key = `${m.index}:${startNum}-${endNum}`
            if (!seen.has(key)) {
                seen.add(key)
                matches.push({
                    raw: m[0],
                    verseStart: startNum,
                    verseEnd: endNum,
                    startIndex: m.index,
                    endIndex: m.index + m[0].length,
                })
            }
        }
    }

    // Single verses
    BARE_VERSE_PATTERN.lastIndex = 0
    while ((m = BARE_VERSE_PATTERN.exec(text)) !== null) {
        const numStr = m[1]
        const num = parseSpokenNumber(numStr) ?? parseInt(numStr, 10)
        if (num && num >= 1 && num <= 176) {
            const key = `${m.index}:${num}`
            // Skip if this span is already covered by a range match
            const covered = matches.some(
                r => m!.index >= r.startIndex && m!.index + m![0].length <= r.endIndex,
            )
            if (!covered && !seen.has(key)) {
                seen.add(key)
                matches.push({
                    raw: m[0],
                    verseStart: num,
                    startIndex: m.index,
                    endIndex: m.index + m[0].length,
                })
            }
        }
    }

    return matches
}

function findBareChapterMatches(text: string): BareMatch[] {
    const matches: BareMatch[] = []
    let m: RegExpExecArray | null
    BARE_CHAPTER_PATTERN.lastIndex = 0
    while ((m = BARE_CHAPTER_PATTERN.exec(text)) !== null) {
        const numStr = m[1]
        const num = parseSpokenNumber(numStr) ?? parseInt(numStr, 10)
        if (num && num >= 1 && num <= 150) {
            matches.push({
                raw: m[0],
                verseStart: num, // for chapter matches this IS the chapter number
                startIndex: m.index,
                endIndex: m.index + m[0].length,
            })
        }
    }
    return matches
}

/**
 * Look for bare references ("verse 6", "verses 4 to 7", "chapter 3")
 * in `text` and resolve them using the provided context.
 *
 * Returns an empty array if context is null, expired, or no bare
 * references are found.
 */
export function resolveBareReferences(
    text: string,
    context: ActiveReferenceContext | null,
    ttlMs: number = DEFAULT_TTL_MS,
): DetectedVerse[] {
    if (!isContextValid(context, ttlMs)) return []

    const detected: DetectedVerse[] = []
    const seen = new Set<string>()

    // Bare verse numbers are medium-confidence — unlike a bare chapter
    // number, `context` here is only ever populated by an EXPLICIT book+
    // chapter reference detected earlier (see `updateContextFromVerse`), so
    // "verse four" arriving while that context is still fresh overwhelmingly
    // means the same passage's verse 4, not an unrelated "verse one/two" said
    // about a song or repeated point. Once a book is already in play, this is
    // the normal, expected way a preacher continues quoting it.
    const verseMatches = findBareVerseMatches(text)
    for (const match of verseMatches) {
        const reference = match.verseEnd
            ? `${context.book} ${context.chapter}:${match.verseStart}-${match.verseEnd}`
            : `${context.book} ${context.chapter}:${match.verseStart}`

        if (seen.has(reference)) continue
        seen.add(reference)

        detected.push({
            raw: match.raw,
            reference,
            book: context.book,
            chapter: context.chapter,
            verseStart: match.verseStart,
            verseEnd: match.verseEnd,
            startIndex: match.startIndex,
            endIndex: match.endIndex,
            confidence: 'medium',
            detectionType: 'regex',
        })
    }

    // Chapter-only bare references are lower-confidence — the speaker may
    // simply be saying "chapter 3" in a non-Bible context. Only resolve if
    // no verse matches were found in the same text (avoids competing signals).
    if (detected.length === 0) {
        const chapterMatches = findBareChapterMatches(text)
        for (const match of chapterMatches) {
            const reference = `${context.book} ${match.verseStart}:1`
            if (seen.has(reference)) continue
            seen.add(reference)

            detected.push({
                raw: match.raw,
                reference,
                book: context.book,
                chapter: match.verseStart,
                verseStart: 1,
                startIndex: match.startIndex,
                endIndex: match.endIndex,
                confidence: 'low',
                detectionType: 'regex',
            })
        }
    }

    return detected
}

const STANDALONE_NUMBER_TTL_MS = 15_000

/**
 * Resolve a single ASR utterance that is NOTHING BUT a bare number ("Five.",
 * "22") against a very recently set reference context, treating it as the
 * missing verse number for a "Book chapter N" ... "<verse>" reference split
 * across two separate utterances — a very common real-time-ASR artifact
 * where the word "verse"/"versus" gets clipped or simply isn't repeated.
 *
 * Deliberately much stricter than resolveBareReferences: there's no keyword
 * to anchor on, so this only fires when the WHOLE utterance is a number
 * (never a number embedded in ordinary sentence text, where misfiring on an
 * unrelated count/date/quantity would be far too easy), and only within a
 * short freshness window (default 15s, not the full 120s context TTL) — a
 * bare number is a much weaker signal than an explicit "verse N", so it
 * shouldn't stay eligible to attach to the chapter for as long.
 */
export function resolveStandaloneNumberContinuation(
    chunkText: string,
    context: ActiveReferenceContext | null,
    ttlMs: number = STANDALONE_NUMBER_TTL_MS,
): DetectedVerse[] {
    if (!isContextValid(context, ttlMs)) return []

    const trimmed = chunkText.trim()
    const match = trimmed.match(STANDALONE_NUMBER_PATTERN)
    if (!match) return []

    const numStr = match[1]
    const num = parseSpokenNumber(numStr) ?? parseInt(numStr, 10)
    if (!num || num < 1 || num > 176) return []

    return [{
        raw: trimmed,
        reference: `${context.book} ${context.chapter}:${num}`,
        book: context.book,
        chapter: context.chapter,
        verseStart: num,
        startIndex: 0,
        endIndex: trimmed.length,
        confidence: 'medium',
        detectionType: 'regex',
    }]
}

/**
 * Convenience: resolve AND update context in one call.
 * Used by useSermonListener when a full reference is detected.
 */
export function resolveBareAndUpdateContext(
    text: string,
    context: ActiveReferenceContext | null,
    ttlMs: number = DEFAULT_TTL_MS,
): { verses: DetectedVerse[]; updatedContext: ActiveReferenceContext | null } {
    const verses = resolveBareReferences(text, context, ttlMs)
    // Keep existing context (caller refreshes from detected verses separately)
    return { verses, updatedContext: context }
}
