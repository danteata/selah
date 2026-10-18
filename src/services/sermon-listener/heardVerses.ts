/**
 * The verses a sermon listener shares with the rest of its live session: the
 * few it heard most recently, so a phone without a listener of its own can
 * send one live (see HeardVersesPublisher and HeardVersesStrip).
 */

import type { DetectedVerse } from './verseDetection'
import type { HeardVerse } from '../../types'

/** Matches MAX_HEARD_VERSES in convex/schema.ts. */
export const MAX_HEARD_VERSES = 5

/**
 * The newest verses heard, newest first, one per reference. Only best matches:
 * the listener's lower-ranked alternatives are for the operator at the desk to
 * weigh up, not for a tap-to-go-live list on someone's phone.
 */
export function heardVersesFrom(detected: DetectedVerse[], version: string | undefined): HeardVerse[] {
    const byReference = new Map<string, HeardVerse>()
    for (const verse of detected) {
        // Every detection is stamped when it's made (or heard again); one
        // without a time can't be placed among the newest, so it's left out.
        if (!verse.isBestMatch || verse.lastActivatedAt === undefined) continue
        const heardAt = verse.lastActivatedAt
        const seen = byReference.get(verse.reference)
        if (seen && seen.heardAt >= heardAt) continue
        byReference.set(verse.reference, {
            reference: verse.reference,
            book: verse.book,
            chapter: verse.chapter,
            verseStart: verse.verseStart,
            ...(verse.verseEnd && verse.verseEnd !== verse.verseStart ? { verseEnd: verse.verseEnd } : {}),
            ...(version ? { version } : {}),
            heardAt,
        })
    }
    return [...byReference.values()]
        .sort((a, b) => b.heardAt - a.heardAt)
        .slice(0, MAX_HEARD_VERSES)
}

/** "just now", "40s ago", "3m ago" — how long since a verse was heard. */
export function heardAgo(heardAt: number, now: number): string {
    const seconds = Math.max(0, Math.round((now - heardAt) / 1000))
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    return `${Math.round(seconds / 60)}m ago`
}
