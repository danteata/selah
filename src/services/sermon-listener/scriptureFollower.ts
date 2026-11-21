/**
 * The scripture follower: the part of the sermon listener that works out which
 * passages the preacher is reading or citing, and decides which verse, if any,
 * to show. See GLOSSARY.md.
 *
 * Utterances go in (`hear`); what changed comes out as a snapshot (the heard
 * verses, the current verse, the active Bible version), and what to do about
 * it comes out as decisions ("look this verse up, then put it up"). The
 * follower never touches the store, the screen or the Bible data itself — the
 * listener carries the decisions out — so everything it decides can be
 * exercised with plain values.
 *
 * One follower lives for one listening session. A reset throws it away and
 * makes a new one, so nothing it remembered can leak into the next session.
 */

import type { DetectedVerse } from './verseDetection'
import { detectVerses, NUMBER_TO_BOOK, BOOK_PATTERN } from './verseDetection'
import type { VoiceCommand } from './voiceCommandDetection'
import { detectVoiceCommands, stripCommandsFromTranscript } from './voiceCommandDetection'
import type { SemanticVerseMatch, ExcludedRange } from './semanticVerseDetection'
import type { ActiveReferenceContext } from './referenceContext'
import {
    isContextValid,
    resolveBareReferences,
    resolveStandaloneNumberContinuation,
    updateContextFromVerse,
} from './referenceContext'
import { filterHallucinations, correctAccentMishearings } from './hallucinationFilter'
import { filterFillers } from './fillerFilter'
import { applyCustomWords, SERMON_PROPER_NOUNS } from './customWords'
import { cleanIncrementally, createCleanCache } from './incrementalClean'
import { collapseOverlappingVerses } from '../../lib/collapseOverlappingVerses'
import { canClaimLiveSlide } from '../../lib/semanticRetrievalPolicy'
import { getNextChapter, getPreviousChapter } from '../../utils/bibleReference'

type Confidence = DetectedVerse['confidence']

/** The semantic matcher, as the follower uses it. */
export interface SemanticMatcher {
    addText(
        text: string,
        excludedRanges: ExcludedRange[],
        onUpgrade: (matches: SemanticVerseMatch[] | null) => void,
    ): Promise<SemanticVerseMatch[] | null>
    setReadingContext(book: string | null, chapter?: number, verse?: number): void
}

/** The optional LLM pass, as the follower uses it. */
export interface LlmExtractor {
    isConfigured(): boolean
    extract(text: string, alreadyDetected: string[], signal: AbortSignal): Promise<{ newVerses: DetectedVerse[] }>
}

/** Settings, read afresh on every utterance so a change mid-service applies at once. */
export interface FollowerSettings {
    minConfidence: Confidence
    autoLookup: boolean
    autoDisplay: boolean
    enableVoiceCommands: boolean
    language: string
}

/** What the follower needs to know about the rest of the app. */
export interface FollowerWorld {
    /** Whether the congregation is singing (the song follower is tracking a song). */
    isSinging(): boolean
    /** The verse on the live bible slide, for "next verse" when nothing has been heard yet. */
    liveVerse(): DetectedVerse | null
    /** A spoken version name ("NIV") as a Bible version id, or null. */
    resolveVersion(requested: string): string | null
}

export type VersionChangeResult = { ok: true; label?: string } | { ok: false }

export type FollowerDecision =
    /**
     * Fetch this verse's text and make it the current scripture; then put it
     * up (`project`, rewriting `supersedes` if that placeholder is queued),
     * rewrite the bible slide already live (`refresh-live`), or nothing more.
     */
    | { type: 'look-up'; verse: DetectedVerse; then: 'nothing' | 'project' | 'refresh-live'; supersedes?: string | null }
    /** Fetch the current verse in another version and put it up; report back through `settle`. */
    | { type: 'change-version'; versionId: string; verse: DetectedVerse | null; settle: (result: VersionChangeResult) => void }
    /** Put the current scripture up. */
    | { type: 'display' }
    | { type: 'stop-listening' }
    | { type: 'start-listening' }
    /** A verse was detected and made current — for analytics. */
    | { type: 'detected'; verse: DetectedVerse; detectionType: 'regex' | 'semantic' | 'llm'; verseCount: number }

export interface FollowerSnapshot {
    heardVerses: DetectedVerse[]
    currentVerse: DetectedVerse | null
    activeBibleVersion: string
    lastVoiceCommand: VoiceCommand | null
    semanticSearching: boolean
}

export interface ScriptureFollowerOptions {
    settings: () => FollowerSettings
    world: FollowerWorld
    /** The semantic matcher once it is ready, or null until then. */
    semantic: () => SemanticMatcher | null
    llm: LlmExtractor
    decide: (decision: FollowerDecision) => void
    initialBibleVersion: string
}

const MAX_DETECTED_VERSES_PER_QUERY = 3 // Max verses per semantic search query
const LLM_EXTRACTION_DEBOUNCE_MS = 3500 // Wait for speech to settle before an LLM pass
const CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 } as const

// Voice-command types that change what's on the shared live screen — gated on
// confidence before executing. stop/start_listening are excluded since they
// don't touch the screen.
const SCREEN_AFFECTING_COMMAND_TYPES = new Set<VoiceCommand['type']>([
    'change_version', 'next_verse', 'previous_verse', 'next_chapter',
    'previous_chapter', 'go_to_verse', 'go_to_reference', 'display',
])
const COMMAND_REPEAT_WINDOW_MS = 1800
const COMMAND_COOLDOWN_MS = 3000

// Scripture-marker words. If the matched query contains one of these, the
// match is more likely a real Bible reference and we accept lower scores.
// If none are present, we require a higher score to compensate for the
// lack of an explicit reference signal.
const SCRIPTURE_MARKER_RE = /\b(verse|verses|chapter|chapters|scripture|scriptures|the bible|the word|it is written|the lord said|god said|according to)\b/i
const SCRIPTURE_MARKER_MIN_SCORE = 0.75 // Below this AND no marker → likely incidental match

// Pre-filter gate checked before running semantic search at all (not a strict
// acceptance check — deliberately broader than SCRIPTURE_MARKER_RE above,
// which stays a strict post-hoc filter on weak matches). This only decides "is
// it worth paying for an embedding pass on this chunk", so it favors recall:
// any explicit Bible book name always passes (BOOK_PATTERN, the same list used
// for hard reference parsing), plus a wider set of speech patterns than the
// strict post-filter accepts. A pure paraphrase with zero book name and zero
// marker word still won't pass — that's the inherent recall/speed tradeoff of
// gating at all.
const SEMANTIC_PREFILTER_RE = /\b(verse|verses|chapter|chapters|scripture|scriptures|the bible|the word|it is written|the lord said|god said|jesus said|christ said|paul said|peter said|moses said|david said|according to|in the book of|turn to|let'?s read|reading from|it says|says here|written)\b/i
const BOOK_NAME_RE = new RegExp(`\\b(${BOOK_PATTERN})\\b`, 'i')
function hasScriptureSignal(t: string): boolean {
    return SEMANTIC_PREFILTER_RE.test(t) || BOOK_NAME_RE.test(t)
}

// A previously heard verse that matches again is treated as said again only
// after this long without matching; until then it is the same mention still
// sitting in the rolling window.
const REACTIVATE_AFTER_SILENCE_MS = 60_000

// detectVerses()/resolveBareReferences() used to be run against the ENTIRE
// accumulated session transcript, so a verse mentioned once stayed textually
// present forever and re-matched on every subsequent chunk — "silence" (above)
// could never be genuinely detected, and an old, already-shown verse could
// resurface and hijack whatever chapter was live. Bounding the window means old
// mentions genuinely scroll out of what's scanned. Sized against
// REACTIVATE_AFTER_SILENCE_MS at typical speaking pace (~75s for a fast 200wpm
// speaker up to ~190s for a slow 80wpm one), NOT against verse/quote length —
// detection only needs the short reference-announcing phrase itself.
const RECENT_VERSE_DETECTION_WINDOW_CHARS = 1500

// A new semantic match must beat the existing chapter sibling by this much.
const CHAPTER_DEDUP_DELTA = 0.10

// How long an announced passage stays the reading context.
const CONTEXT_TTL_MS = 120_000

// Rate limit for the semantic-gate diagnostic: the gate is evaluated on every
// transcript chunk, so an unthrottled line would bury the real signal.
const SEMANTIC_GATE_LOG_MS = 5000

/** Real verse paraphrases score in the 0.70-0.85 range; below 0.65 is surface overlap. */
function semanticConfidence(score: number): Confidence {
    return score >= 0.78 ? 'high' : score >= 0.65 ? 'medium' : 'low'
}

/** A semantic match's book, which may arrive as its number ("43"), as a name. */
function bookNameOf(book: string): string {
    const n = parseInt(book, 10)
    return !isNaN(n) && n >= 1 && n <= 66 && /^\d+$/.test(book) ? (NUMBER_TO_BOOK[n] || book) : book
}

// Guards against a same-book+chapter candidate silently overwriting a more
// specific verse already live, when the candidate itself isn't confident
// enough to be a deliberate restatement. Two known live-reproduced failure
// modes, both from the same root cause (a rolling-window regex re-match or a
// debounced semantic pass landing on a less-specific reading of text that's
// already been resolved more precisely):
//   1. Chapter-default regression — "Joshua 24:15" already live, a stale
//      "Joshua chapter 24" fragment still sitting in the rolling window
//      re-matches and defaults to verse 1, reverting the display.
//   2. Range collapse — "Psalms 34:7-8" already live (from an explicit
//      range), a semantic match (which can only ever score single verses,
//      never ranges) lands on just verse 7 and collapses the range down.
// A high-confidence candidate always wins — that's a genuine, deliberate
// restatement, not a stale rematch.
export function isSpecificityDowngrade(live: DetectedVerse | null, candidate: DetectedVerse): boolean {
    if (!live) return false
    if (live.book !== candidate.book || live.chapter !== candidate.chapter) return false
    if (candidate.confidence === 'high') return false

    const liveIsRange = live.verseEnd != null && live.verseEnd > live.verseStart
    const candidateCollapsesRange =
        liveIsRange &&
        (candidate.verseEnd == null || candidate.verseEnd === candidate.verseStart) &&
        candidate.verseStart >= live.verseStart &&
        candidate.verseStart <= (live.verseEnd as number)

    const candidateIsChapterDefault = candidate.verseStart === 1 && candidate.verseEnd == null
    const liveIsSpecific = live.verseStart !== 1 || liveIsRange

    return candidateCollapsesRange || (liveIsSpecific && candidateIsChapterDefault)
}

function dedupeVerses(items: DetectedVerse[]): DetectedVerse[] {
    const map = new Map<string, DetectedVerse>()
    for (const verse of items) {
        const existing = map.get(verse.reference)
        if (!existing) {
            map.set(verse.reference, verse)
            continue
        }
        if ((verse.isBestMatch && !existing.isBestMatch) || verse.startIndex > existing.startIndex) {
            map.set(verse.reference, { ...existing, ...verse, isBestMatch: existing.isBestMatch || verse.isBestMatch })
        }
    }

    // Collapse spans that describe the same passage — a regex range and
    // the individual verses a semantic pass scores inside it are one
    // passage said once. See collapseOverlappingVerses.
    return collapseOverlappingVerses(Array.from(map.values()))
}

/** A verse moved to another position, keeping its book unless told otherwise. */
function verseAt(from: DetectedVerse, book: string, chapter: number, verse: number): DetectedVerse {
    return {
        ...from,
        book,
        chapter,
        verseStart: verse,
        verseEnd: undefined,
        raw: `${book} ${chapter}:${verse}`,
        reference: `${book} ${chapter}:${verse}`,
        startIndex: 0,
        endIndex: 0,
    }
}

export class ScriptureFollower {
    private readonly options: ScriptureFollowerOptions
    private snapshot: FollowerSnapshot
    private readonly listeners = new Set<() => void>()
    private disposed = false

    /** References already heard this session — a match on one is a re-mention, not a new verse. */
    private readonly known = new Set<string>()
    /**
     * Placeholders recorded from a bare "Book Chapter" announcement, which
     * resolves to verse 1. Superseded once the verse actually being announced
     * arrives — see recordAnnouncedVerse.
     */
    private readonly announcedChapterDefaults = new Map<string, { book: string; chapter: number }>()
    /**
     * When the rolling window last matched each verse. Distinguishes a genuine
     * re-reference (the verse stopped matching for a while, then re-appeared)
     * from the same mention still sitting in the window.
     */
    private readonly lastMatchAt = new Map<string, number>()
    /**
     * Each verse's most recent match score — 1.0 for an explicit reference,
     * the cosine score for a semantic match. Chapter dedup compares a new
     * semantic match against it.
     */
    private readonly lastScore = new Map<string, number>()
    /** Bumped on every new regex detection; semantic and LLM results that started earlier are stale. */
    private regexGeneration = 0
    private readingContext: ActiveReferenceContext | null = null
    private versionSwitchCooldownUntil = 0
    private navigationCooldownUntil = 0
    /** Recent command execution times, so a command isn't run twice for one utterance. */
    private readonly commandRunAt = new Map<string, number>()
    private versionChangeRequest = 0
    private llmTimer: ReturnType<typeof setTimeout> | null = null
    private llmAbort: AbortController | null = null
    private semanticSearches = 0
    private lastSemanticGateLogAt = 0
    private readonly cleanCache = createCleanCache()

    constructor(options: ScriptureFollowerOptions) {
        this.options = options
        this.snapshot = {
            heardVerses: [],
            currentVerse: null,
            activeBibleVersion: options.initialBibleVersion,
            lastVoiceCommand: null,
            semanticSearching: false,
        }
    }

    // ----- interface -------------------------------------------------------

    getSnapshot = (): FollowerSnapshot => this.snapshot

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /**
     * An utterance arrived. `text` is the whole transcript so far (or, for an
     * interim result, that plus the words still being recognised); `latestChunk`
     * is just the newest utterance, the only place commands are looked for.
     * `committed` says whether `text` is the committed transcript.
     */
    hear(text: string, { latestChunk, committed }: { latestChunk?: string; committed: boolean }): void {
        if (this.disposed || !text) return
        const settings = this.options.settings()

        if (settings.enableVoiceCommands && this.runCommands(latestChunk?.trim() || '')) {
            // Same-chunk verse detection must not overwrite a just-requested command.
            return
        }

        const cleanText = cleanIncrementally(
            text,
            (input) => this.cleanForDetection(input),
            this.cleanCache,
            `${settings.enableVoiceCommands}:${settings.language}`,
            committed,
        )

        const regexGenerationAtStart = this.regexGeneration

        // Bound what the regex detectors scan to a recent window of the
        // ever-growing transcript so an old mention can genuinely fall silent.
        // windowOffset is added back onto startIndex/endIndex wherever they're
        // used against the un-windowed cleanText (see excludedRanges below).
        const windowOffset = Math.max(0, cleanText.length - RECENT_VERSE_DETECTION_WINDOW_CHARS)
        const recentText = cleanText.slice(windowOffset)

        // Optional LLM augmentation, windowed the same way: cleanText is the
        // whole session's transcript, and an hour in each pass would otherwise
        // resend all of it. A song in progress can't contain a reading, and
        // this used to fire on every window of a nine-minute song.
        if (!this.options.world.isSinging()) {
            this.scheduleLlmExtraction(recentText)
        }

        const { newVerses, reActivatedRefs } = this.detectExplicit(recentText, windowOffset, latestChunk, settings.minConfidence)
        const hasRegexVerses = newVerses.length > 0
        const hasReActivated = reActivatedRefs.length > 0

        if (hasRegexVerses) {
            this.regexGeneration++
            this.takeNewExplicit(newVerses)
        } else if (hasReActivated) {
            this.reactivateExplicit(reActivatedRefs)
        }

        this.searchSemantically(cleanText, text, latestChunk, newVerses, {
            hasRegexVerses,
            hasReActivated,
            regexGenerationAtStart,
            minConfidence: settings.minConfidence,
        })
    }

    /** The operator chose a heard verse: make it current. */
    select(verse: DetectedVerse): void {
        this.update({ currentVerse: verse })
    }

    /** The operator removed a heard verse. It is forgotten, so it can be heard again. */
    remove(reference: string): void {
        this.known.delete(reference)
        this.lastMatchAt.delete(reference)
        this.lastScore.delete(reference)
        this.announcedChapterDefaults.delete(reference)
        this.update({ heardVerses: this.snapshot.heardVerses.filter((v) => v.reference !== reference) })
    }

    /**
     * Pick up a listening session restored after a reload. Its verses count as
     * heard — a match on one is a re-mention — and as long silent, so a
     * re-mention is shown again rather than taken for the same mention still
     * in the window.
     */
    restore(restored: Partial<Pick<FollowerSnapshot, 'heardVerses' | 'currentVerse' | 'activeBibleVersion'>>): void {
        const silentSince = Date.now() - REACTIVATE_AFTER_SILENCE_MS
        for (const verse of restored.heardVerses ?? []) {
            this.known.add(verse.reference)
            this.lastMatchAt.set(verse.reference, silentSince)
        }
        this.update({
            ...(restored.heardVerses ? { heardVerses: restored.heardVerses } : {}),
            ...(restored.currentVerse !== undefined ? { currentVerse: restored.currentVerse } : {}),
            ...(restored.activeBibleVersion ? { activeBibleVersion: restored.activeBibleVersion } : {}),
        })
    }

    /** Listening stopped: drop a pending LLM pass so it can't put a slide up afterwards. */
    cancelPending(): void {
        if (this.llmTimer) {
            clearTimeout(this.llmTimer)
            this.llmTimer = null
        }
        this.llmAbort?.abort()
        this.llmAbort = null
    }

    /** The listening session is over. Results still in flight are dropped. */
    dispose(): void {
        this.cancelPending()
        this.disposed = true
        this.options.semantic()?.setReadingContext(null)
        this.listeners.clear()
    }

    // ----- state -----------------------------------------------------------

    private update(patch: Partial<FollowerSnapshot>): void {
        if (this.disposed) return
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of this.listeners) listener()
    }

    private addHeard(verses: DetectedVerse[], { without }: { without?: string | null } = {}): void {
        const kept = without ? this.snapshot.heardVerses.filter((v) => v.reference !== without) : this.snapshot.heardVerses
        this.update({ heardVerses: dedupeVerses([...kept, ...verses]) })
    }

    private restamp(reference: string, at: number): DetectedVerse | null {
        let stamped: DetectedVerse | null = null
        const heardVerses = this.snapshot.heardVerses.map((v) => {
            if (v.reference !== reference) return v
            stamped = { ...v, retriggerCount: (v.retriggerCount || 0) + 1, lastActivatedAt: at }
            return stamped
        })
        if (stamped) this.update({ heardVerses })
        return stamped
    }

    private emit(decision: FollowerDecision): void {
        if (!this.disposed) this.options.decide(decision)
    }

    private inVersionSwitchCooldown(): boolean {
        return Date.now() < this.versionSwitchCooldownUntil
    }

    private inNavigationCooldown(): boolean {
        return Date.now() < this.navigationCooldownUntil
    }

    /**
     * The one show-a-verse decision. Every detection path ends here; what
     * differs between them is passed in, not written out five times.
     *
     * `continuesSameReference` exempts the navigation cooldown: a verse that
     * completes the reference a command just set ("Hebrews 13" … "Five.") is
     * the rest of that navigation, not a competing one. `confidence`, when
     * given, keeps a low-confidence match in the list for the operator rather
     * than putting it up.
     */
    private offer(verse: DetectedVerse, { continuesSameReference = false, confidence }: { continuesSameReference?: boolean; confidence?: Confidence } = {}): void {
        const { autoLookup, autoDisplay } = this.options.settings()
        if (!autoLookup || this.inVersionSwitchCooldown()) return
        if (this.inNavigationCooldown() && !continuesSameReference) return
        const confident = confidence === undefined || confidence !== 'low'
        this.emit({ type: 'look-up', verse, then: autoDisplay && confident ? 'project' : 'nothing' })
    }

    // ----- voice commands --------------------------------------------------

    /** Run the commands in the newest utterance. True when verse detection should sit this one out. */
    private runCommands(commandSource: string): boolean {
        if (commandSource.length === 0) return false

        const corrected = correctAccentMishearings(commandSource)
        // A chapter announced within the TTL lets a chunk that is only a
        // number ("24", "15 through 16") be read as a verse jump into it.
        // Preachers routinely drop the word "verse" on that second utterance.
        const commands = detectVoiceCommands(corrected, {
            debug: true,
            hasFreshChapterContext: isContextValid(this.readingContext, CONTEXT_TTL_MS),
        })
        if (commands.length > 0) {
            console.log('[SermonListener] Voice commands detected:', {
                source: commandSource,
                corrected,
                commands: commands.map((c) => ({ type: c.type, raw: c.raw, conf: c.confidence })),
            })
        }

        let suppressDetection = false
        for (const cmd of commands) {
            const key = (() => {
                switch (cmd.type) {
                    // The verse belongs in the key. Without it, a bare
                    // "Joshua 24" and the "Joshua 24 verse 15" that follows
                    // it a beat later collapse to one key, and the repeat
                    // window swallows the specific reference.
                    case 'go_to_reference': return `${cmd.type}:${cmd.book || ''}:${cmd.chapter || ''}:${cmd.verse ?? ''}`
                    case 'go_to_verse': return `${cmd.type}::${cmd.targetVerse || ''}`
                    case 'change_version': return `${cmd.type}:${cmd.versionId || ''}:`
                    default: return `${cmd.type}::`
                }
            })()
            const now = Date.now()
            if (now - (this.commandRunAt.get(key) || 0) < COMMAND_REPEAT_WINDOW_MS) continue

            // Version switches change the wording of everything displayed, so
            // they need 'high'; other screen-affecting commands need 'medium'.
            // stop/start_listening don't touch the screen.
            if (SCREEN_AFFECTING_COMMAND_TYPES.has(cmd.type)) {
                const required = cmd.type === 'change_version' ? 'high' : 'medium'
                if (CONFIDENCE_ORDER[cmd.confidence] < CONFIDENCE_ORDER[required]) continue
            }

            this.commandRunAt.set(key, now)
            if (this.runCommand(cmd)) suppressDetection = true

            if (cmd.type !== 'change_version') this.update({ lastVoiceCommand: cmd })
        }
        return suppressDetection
    }

    /** Run one command. True for a version switch or a navigation. */
    private runCommand(cmd: VoiceCommand): boolean {
        const now = Date.now()
        const current = () => this.snapshot.currentVerse || this.options.world.liveVerse()
        const navigateTo = (verse: DetectedVerse, then: 'refresh-live' | 'project', supersedes?: string | null) => {
            this.update({ currentVerse: verse })
            this.readingContext = updateContextFromVerse(verse)
            this.navigationCooldownUntil = now + COMMAND_COOLDOWN_MS
            this.emit({ type: 'look-up', verse, then, supersedes })
        }

        switch (cmd.type) {
            case 'change_version':
                if (!cmd.versionId) return false
                this.changeVersion(cmd)
                return true
            case 'next_verse': {
                const cur = current()
                if (cur) {
                    // Relative navigation rewrites the slide already live; it
                    // has no reference of its own to queue.
                    navigateTo(verseAt(cur, cur.book, cur.chapter, (cur.verseEnd ?? cur.verseStart) + 1), 'refresh-live')
                }
                return true
            }
            case 'previous_verse': {
                const cur = current()
                if (cur) navigateTo(verseAt(cur, cur.book, cur.chapter, Math.max(1, cur.verseStart - 1)), 'refresh-live')
                return true
            }
            case 'next_chapter': {
                const cur = current()
                const next = cur && getNextChapter(cur.book, cur.chapter)
                // From a book's last chapter, "next chapter" is the next book's first.
                if (cur && next) navigateTo(verseAt(cur, next.book, next.chapter, 1), 'refresh-live')
                return true
            }
            case 'previous_chapter': {
                const cur = current()
                const prev = cur && getPreviousChapter(cur.book, cur.chapter)
                if (cur && prev) navigateTo(verseAt(cur, prev.book, prev.chapter, 1), 'refresh-live')
                return true
            }
            case 'go_to_verse': {
                const cur = current()
                const target = cmd.targetVerse
                if (cur && target && target >= 1) {
                    const goto = verseAt(cur, cur.book, cur.chapter, target)
                    this.options.semantic()?.setReadingContext(cur.book, cur.chapter, target)
                    // A spoken "verse N" names a reference as surely as the
                    // full form does — it just borrows the book and chapter
                    // from the announcement before it. Recording it is what
                    // stops the same words being re-detected as a new
                    // reference minutes later.
                    this.recordAnnouncedVerse(goto)
                    navigateTo(goto, 'refresh-live')
                }
                return true
            }
            case 'go_to_reference': {
                const { book, chapter, verse } = cmd
                if (book && chapter && chapter >= 1) {
                    const goto: DetectedVerse = {
                        book,
                        chapter,
                        verseStart: verse || 1,
                        verseEnd: undefined,
                        raw: `${book} ${chapter}:${verse || 1}`,
                        reference: `${book} ${chapter}:${verse || 1}`,
                        confidence: 'high',
                        startIndex: 0,
                        endIndex: 0,
                    }
                    // Tell the semantic layer which passage is actually being
                    // read, so near-identical wording elsewhere in Scripture
                    // doesn't outrank the verses on screen.
                    this.options.semantic()?.setReadingContext(book, chapter, verse)
                    // verse == null is a bare "Book Chapter" mention, whose
                    // verse 1 is a placeholder, not a reference the speaker made.
                    const supersedes = this.recordAnnouncedVerse(goto, verse == null)
                    // Not refresh-live: that only rewrites a bible slide that is
                    // ALREADY live, so an announcement made before anything is
                    // on screen — the first thing a preacher does — displayed
                    // nothing. A named passage deserves its own queue entry.
                    navigateTo(goto, 'project', supersedes)
                }
                return true
            }
            case 'display':
                this.emit({ type: 'display' })
                return false
            case 'stop_listening':
                this.emit({ type: 'stop-listening' })
                return false
            case 'start_listening':
                this.emit({ type: 'start-listening' })
                return false
        }
        return false
    }

    private changeVersion(cmd: VoiceCommand & { versionId?: string }): void {
        const requested = cmd.versionId as string
        const versionId = this.options.world.resolveVersion(requested) || requested
        const request = ++this.versionChangeRequest
        const verse = this.snapshot.currentVerse
        this.update({ activeBibleVersion: versionId })
        this.emit({
            type: 'change-version',
            versionId,
            verse,
            settle: (result) => {
                if (this.disposed || request !== this.versionChangeRequest || !result.ok) return
                if (verse && result.label) {
                    // A fresh object, so consumers keyed by identity re-render
                    // with the reference as the new version labels it.
                    this.update({ currentVerse: { ...verse, raw: result.label, reference: result.label } })
                }
                this.versionSwitchCooldownUntil = Date.now() + COMMAND_COOLDOWN_MS
                this.update({ lastVoiceCommand: cmd })
            },
        })
    }

    /**
     * Record a reference the speaker announced as a voice command ("Psalm 27
     * verse 1", "Joshua 24" then "verse 15") among the heard verses.
     *
     * Nothing else records it: the command text is stripped from the transcript
     * before verse detection runs, so an unrecorded announcement is not
     * protected by the chapter-dedup and already-heard guards the semantic path
     * applies to everything it knows about. And that stripping only covers the
     * last few hundred characters, so once the announcement scrolls further
     * back it reappears in the scanned window and would be detected as a brand
     * new reference — a minute later, taking the live slide. Recording it here
     * turns that into a re-mention.
     *
     * Scored 1.0 like an explicit reference. `isChapterDefault` marks the
     * placeholder verse 1 a bare "Book Chapter" announcement resolves to; when
     * the verse actually being announced arrives, the placeholder is superseded
     * and its reference returned, so its slide can be rewritten too.
     */
    private recordAnnouncedVerse(verse: DetectedVerse, isChapterDefault = false): string | null {
        const now = Date.now()
        const superseded = isChapterDefault
            ? null
            : Array.from(this.announcedChapterDefaults.entries()).find(([reference, placeholder]) =>
                placeholder.book === verse.book
                && placeholder.chapter === verse.chapter
                && reference !== verse.reference,
            )?.[0]

        if (superseded) {
            this.announcedChapterDefaults.delete(superseded)
            this.known.delete(superseded)
            this.lastScore.delete(superseded)
        }
        if (isChapterDefault) {
            this.announcedChapterDefaults.set(verse.reference, { book: verse.book, chapter: verse.chapter })
        }

        this.known.add(verse.reference)
        this.lastMatchAt.set(verse.reference, now)
        this.lastScore.set(verse.reference, 1.0)
        this.addHeard([{
            ...verse,
            isBestMatch: true,
            detectionType: 'regex' as const,
            lastActivatedAt: now,
            retriggerCount: 0,
        }], { without: superseded })

        return superseded ?? null
    }

    // ----- explicit references --------------------------------------------

    /**
     * Clean before detection: voice commands stripped, then raw →
     * hallucination → filler → custom-words (each layer assumes a clean input
     * from the previous one — see fillerFilter.ts).
     */
    private cleanForDetection(input: string): string {
        const { enableVoiceCommands, language } = this.options.settings()
        const commands = enableVoiceCommands ? detectVoiceCommands(input) : []
        let cleaned = commands.length > 0 ? stripCommandsFromTranscript(input, commands) : input

        const hallucination = filterHallucinations(cleaned)
        if (hallucination.hadHallucination) {
            console.log('[SermonListener] Filtered hallucination:', {
                repetitionsRemoved: hallucination.repetitionsRemoved,
                fillersRemoved: hallucination.fillersRemoved,
                profanityRemoved: hallucination.profanityRemoved,
                confidence: hallucination.confidence,
            })
            cleaned = hallucination.cleanedText
        }

        // Filler/stutter removal is language-aware; custom-word correction
        // fixes distinctive proper nouns Whisper mangles. Safe profile for an
        // always-on vocabulary: single-token matching only and no phonetic boost.
        cleaned = filterFillers(cleaned, { lang: language })
        return applyCustomWords(cleaned, [...SERMON_PROPER_NOUNS], 0.25, {
            maxNgram: 1,
            usePhonetic: false,
        })
    }

    /** Explicit references in the window: the new ones, and the ones already heard. */
    private detectExplicit(recentText: string, windowOffset: number, latestChunk: string | undefined, minConfidence: Confidence) {
        let verses = detectVerses(recentText)

        // Resolve bare references (e.g. "verse 6") from the reading context,
        // only when no full book+chapter reference was found and the context
        // has not expired.
        if (verses.length === 0) {
            verses = resolveBareReferences(recentText, this.readingContext, CONTEXT_TTL_MS)
        }

        // Both detectors above ran against the windowed slice; shift their
        // positions back into the un-windowed text before anything uses them.
        if (windowOffset > 0) {
            verses = verses.map((v) => ({ ...v, startIndex: v.startIndex + windowOffset, endIndex: v.endIndex + windowOffset }))
        }

        // A preacher often announces "Book chapter N" and gives just the verse
        // number in its OWN utterance moments later ("Hebrews 13" ... "Five.").
        // Checked against the newest utterance only, so this fires only when
        // that whole utterance is a bare number.
        if (verses.length === 0 && latestChunk) {
            verses = resolveStandaloneNumberContinuation(latestChunk, this.readingContext)
        }

        const minLevel = CONFIDENCE_ORDER[minConfidence]
        const fresh: DetectedVerse[] = []
        const reActivatedRefs: string[] = []
        for (const verse of verses) {
            if (CONFIDENCE_ORDER[verse.confidence] < minLevel) continue
            if (this.known.has(verse.reference)) {
                reActivatedRefs.push(verse.reference)
                continue
            }
            fresh.push({ ...verse, detectionType: 'regex' as const })
        }

        // The most recently mentioned first.
        fresh.sort((a, b) => b.startIndex - a.startIndex)
        const newVerses = fresh.slice(0, MAX_DETECTED_VERSES_PER_QUERY)
        // Explicit references are all best matches.
        for (const verse of newVerses) {
            verse.isBestMatch = true
            this.known.add(verse.reference)
        }
        return { newVerses, reActivatedRefs }
    }

    private takeNewExplicit(newVerses: DetectedVerse[]): void {
        const now = Date.now()
        const stamped = newVerses.map((v) => ({ ...v, lastActivatedAt: now, retriggerCount: 0 }))
        for (const v of stamped) {
            this.lastMatchAt.set(v.reference, now)
            // Explicit references score 1.0, so a semantic match in the same
            // chapter never overrides one.
            this.lastScore.set(v.reference, 1.0)
        }
        this.addHeard(stamped)
        const latest = stamped[0]

        // The rolling window can still hold a bare "Book Chapter" fragment
        // seconds after a more specific verse of that chapter was resolved;
        // its chapter-only reading (verse 1, medium confidence) must not
        // revert the display. Reproduced live with Joshua 24:15 → 24:1.
        if (isSpecificityDowngrade(this.snapshot.currentVerse, latest)) return

        this.update({ currentVerse: latest })
        this.emit({ type: 'detected', verse: latest, detectionType: 'regex', verseCount: stamped.length })

        // A verse that continues the book+chapter a command just set is the
        // rest of that navigation, not a competing one — see `offer`.
        const prior = this.readingContext
        const continuesSameReference = !!prior && prior.book === latest.book && prior.chapter === latest.chapter
        this.readingContext = updateContextFromVerse(latest)
        this.offer(latest, { continuesSameReference })
    }

    /**
     * Verses already heard matched again. A genuine re-reference (the verse
     * was silent for REACTIVATE_AFTER_SILENCE_MS) is shown again; otherwise it
     * is the same mention still in the window, and nothing changes.
     *
     * Only the first is acted on, but every one of them is still matching and
     * has its time refreshed — otherwise one that never comes first would
     * look falsely silent later and hijack the screen.
     */
    private reactivateExplicit(reActivatedRefs: string[]): void {
        const now = Date.now()
        const reference = reActivatedRefs[0]
        if (!this.snapshot.heardVerses.some((v) => v.reference === reference)) return
        const lastMatch = this.lastMatchAt.get(reference) || 0
        const hasBeenSilent = lastMatch > 0 && now - lastMatch >= REACTIVATE_AFTER_SILENCE_MS
        for (const ref of reActivatedRefs) this.lastMatchAt.set(ref, now)
        if (!hasBeenSilent) return

        const verse = this.restamp(reference, now)
        if (!verse) return
        this.update({ currentVerse: verse })
        this.offer(verse)
    }

    // ----- semantic matches -----------------------------------------------

    private searchSemantically(
        cleanText: string,
        text: string,
        latestChunk: string | undefined,
        newVerses: DetectedVerse[],
        chunk: { hasRegexVerses: boolean; hasReActivated: boolean; regexGenerationAtStart: number; minConfidence: Confidence },
    ): void {
        const semantic = this.options.semantic()
        if (!semantic) return

        // A live reading counts as scripture signal on its own: continuous
        // reading has no book name or marker phrase in it, and once a
        // reference has been announced, the prose that follows is the reading.
        const inReadingContext = isContextValid(this.readingContext, CONTEXT_TTL_MS)
        // Worship lyrics are scripture-adjacent by design; while a song is
        // being followed, the audio is singing. See worshipMode.ts.
        const singing = this.options.world.isSinging()
        const signal = hasScriptureSignal(latestChunk || cleanText)
        // A semantic match never overrides an explicit one in the same chunk,
        // so there is no point running the embedding pass then.
        const ready = !singing && cleanText.length >= 30 && !chunk.hasRegexVerses && (signal || inReadingContext)

        if (!ready) {
            const now = Date.now()
            if (now - this.lastSemanticGateLogAt >= SEMANTIC_GATE_LOG_MS) {
                this.lastSemanticGateLogAt = now
                console.log(
                    '[SemanticDetector] gate closed:',
                    `len=${cleanText.length}/30`,
                    `regexVerses=${chunk.hasRegexVerses}`,
                    `signal=${signal}`,
                    `readingContext=${inReadingContext}`,
                    `singing=${singing}`,
                )
            }
            return
        }

        this.semanticSearches++
        this.update({ semanticSearching: true })

        // Explicit references are excluded so the semantic pass doesn't match them again.
        const excludedRanges = newVerses.map((v) => ({ startIndex: v.startIndex, endIndex: v.endIndex }))
        // Handles both the immediate result and a later "upgrade" from the
        // detector's deferred sliding-window fallback.
        const handle = (matches: SemanticVerseMatch[] | null) => this.takeSemanticMatches(matches, text, chunk)

        semantic.addText(cleanText, excludedRanges, handle)
            .then(handle)
            .catch((error: Error) => {
                console.error('[SemanticDetector] Search error:', error)
            })
            .finally(() => {
                if (--this.semanticSearches === 0) this.update({ semanticSearching: false })
            })
    }

    private takeSemanticMatches(
        matches: SemanticVerseMatch[] | null,
        text: string,
        chunk: { hasRegexVerses: boolean; hasReActivated: boolean; regexGenerationAtStart: number; minConfidence: Confidence },
    ): void {
        if (this.disposed || !matches) return
        // A newer explicit reference landed since this search started: the
        // results are still listed, but don't take the current verse.
        const isStale = chunk.regexGenerationAtStart !== this.regexGeneration
        const minLevel = CONFIDENCE_ORDER[chunk.minConfidence]

        // The chapter the speaker announced, if that announcement is still fresh.
        const context = isContextValid(this.readingContext, CONTEXT_TTL_MS) ? this.readingContext : null

        const candidates: Array<{ verse: DetectedVerse; score: number }> = []
        // Set when the top-ranked candidate was already heard — see below.
        let bestCandidateAlreadyHeard = false
        const reActivated: Array<{ reference: string; confidence: Confidence }> = []
        for (const match of matches) {
            const book = bookNameOf(match.book)
            const reference = `${book} ${match.chapter}:${match.verse}`
            const confidence = semanticConfidence(match.score)
            if (CONFIDENCE_ORDER[confidence] < minLevel) continue

            // Inside the passage the speaker announced? The marker floor and
            // chapter dedup both relax for the chapter being read.
            const isAnnouncedChapter = !!context && context.book === book && context.chapter === match.chapter

            // Without a marker word and below SCRIPTURE_MARKER_MIN_SCORE, a
            // match is likely an incidental idiom. Checked before the
            // re-mention test so a weak coincidental re-match can't re-show
            // an old verse. The announced chapter is exempt: the announcement
            // is the reference signal, and verse text carries no marker word.
            if (!isAnnouncedChapter && !SCRIPTURE_MARKER_RE.test(match.text) && match.score < SCRIPTURE_MARKER_MIN_SCORE) continue

            if (this.known.has(reference)) {
                // Carry this match's confidence: a re-show is gated on how good
                // the fresh match is, not on the verse's original confidence.
                reActivated.push({ reference, confidence })
                // The matches arrive ranked. If the best candidate is one
                // already heard, no lower-ranked one may take the display just
                // for being novel — that is how Deuteronomy 11:19 displaced
                // the 6:7 being read.
                if (candidates.length === 0) bestCandidateAlreadyHeard = true
                continue
            }

            // Chapter dedup: one verse per chapter unless a later match is much
            // stronger — the embedding model flags every nearby verse of a
            // chapter. Except in the announced chapter, where sequential
            // verses ARE the reading.
            const sibling = isAnnouncedChapter
                ? undefined
                : this.snapshot.heardVerses.find((v) => v.book === book && v.chapter === match.chapter)
            if (sibling && match.score < (this.lastScore.get(sibling.reference) ?? 0) + CHAPTER_DEDUP_DELTA) {
                // Remember the score so a much stronger match later can override.
                this.lastScore.set(reference, match.score)
                continue
            }

            candidates.push({
                score: match.score,
                verse: {
                    raw: match.reference,
                    reference,
                    book,
                    chapter: match.chapter,
                    verseStart: match.verse,
                    confidence,
                    startIndex: 0,
                    endIndex: text.length,
                    detectionType: 'semantic' as const,
                },
            })
        }

        // In the reading context first, then by confidence: the top slot is
        // what claims the screen, and an out-of-context 'high' must not sort
        // above the in-context 'medium' actually being read.
        candidates.sort((a, b) => {
            if (context) {
                const aIn = a.verse.book === context.book && a.verse.chapter === context.chapter ? 1 : 0
                const bIn = b.verse.book === context.book && b.verse.chapter === context.chapter ? 1 : 0
                if (aIn !== bIn) return bIn - aIn
            }
            return CONFIDENCE_ORDER[b.verse.confidence] - CONFIDENCE_ORDER[a.verse.confidence]
        })
        const top = candidates.slice(0, MAX_DETECTED_VERSES_PER_QUERY)

        if (top.length > 0) {
            // May the top survivor take over the live screen on its own? All of
            // them are listed either way. See canClaimLiveSlide.
            const canClaimDisplay = canClaimLiveSlide(top[0].verse, context, bestCandidateAlreadyHeard)
            top[0].verse.isBestMatch = canClaimDisplay

            const now = Date.now()
            const stamped = top.map(({ verse }) => ({ ...verse, lastActivatedAt: now, retriggerCount: 0 }))
            for (const [i, v] of stamped.entries()) {
                // A stale result must not block a fresher search finding the same verse.
                if (!isStale) this.known.add(v.reference)
                this.lastMatchAt.set(v.reference, now)
                this.lastScore.set(v.reference, top[i].score)
            }
            this.addHeard(stamped)

            const best = stamped[0]
            // A semantic match can only score single verses, so it must not
            // collapse a range or revert a specific verse already current.
            if (canClaimDisplay && !chunk.hasRegexVerses && !isStale && !isSpecificityDowngrade(this.snapshot.currentVerse, best)) {
                this.update({ currentVerse: best })
                this.emit({ type: 'detected', verse: best, detectionType: 'semantic', verseCount: stamped.length })
                this.offer(best, { confidence: best.confidence })
            }
            return
        }

        // A semantic verse already heard matched again: same silence rule as
        // explicit references.
        if (reActivated.length > 0 && !chunk.hasRegexVerses && !chunk.hasReActivated && !isStale) {
            const now = Date.now()
            const { reference, confidence } = reActivated[0]
            if (!this.snapshot.heardVerses.some((v) => v.reference === reference)) return
            const lastMatch = this.lastMatchAt.get(reference) || 0
            const hasBeenSilent = lastMatch > 0 && now - lastMatch >= REACTIVATE_AFTER_SILENCE_MS
            for (const r of reActivated) this.lastMatchAt.set(r.reference, now)
            if (!hasBeenSilent) return

            const verse = this.restamp(reference, now)
            if (!verse) return
            this.update({ currentVerse: verse })
            this.offer(verse, { confidence })
        }
    }

    // ----- LLM pass --------------------------------------------------------

    /**
     * Debounced, optional LLM pass over the newest text. No-op unless an
     * endpoint is configured, so the default experience stays offline.
     */
    private scheduleLlmExtraction(text: string): void {
        const { llm } = this.options
        if (!llm.isConfigured()) return

        if (this.llmTimer) clearTimeout(this.llmTimer)
        this.llmTimer = setTimeout(() => {
            this.llmTimer = null
            this.llmAbort?.abort()
            const controller = new AbortController()
            this.llmAbort = controller
            const regexGenerationAtStart = this.regexGeneration
            llm.extract(text, Array.from(this.known), controller.signal)
                .then((result) => {
                    // The desktop proxy can't be aborted, so an answer can still
                    // arrive after Stop or a newer request. Drop it.
                    if (controller.signal.aborted) return
                    this.takeLlmVerses(result.newVerses, regexGenerationAtStart)
                })
                .catch(() => { /* best-effort augmentation */ })
        }, LLM_EXTRACTION_DEBOUNCE_MS)
    }

    /** Verses the LLM pass found. Only ever adds; held to the same bar as the other paths. */
    private takeLlmVerses(verses: DetectedVerse[], regexGenerationAtStart: number): void {
        if (this.disposed) return
        const minLevel = CONFIDENCE_ORDER[this.options.settings().minConfidence]
        const fresh = verses.filter((v) => !this.known.has(v.reference) && CONFIDENCE_ORDER[v.confidence] >= minLevel)
        if (fresh.length === 0) return

        // The LLM's round trip takes seconds; if a newer explicit reference
        // landed meanwhile, list these but leave the screen alone.
        const isStale = regexGenerationAtStart !== this.regexGeneration

        const now = Date.now()
        const stamped = fresh.map((v) => ({
            ...v,
            isBestMatch: true,
            detectionType: 'llm' as const,
            lastActivatedAt: now,
            retriggerCount: 0,
        }))
        for (const v of stamped) {
            this.known.add(v.reference)
            this.lastMatchAt.set(v.reference, now)
            // Just below an explicit reference, so a later one in the same
            // chapter still wins chapter dedup.
            this.lastScore.set(v.reference, 0.9)
        }
        this.addHeard(stamped)
        if (isStale) return

        const latest = stamped[stamped.length - 1]
        // A slow, weaker LLM guess (often just the chapter default) must not
        // clobber a more specific verse already current.
        if (isSpecificityDowngrade(this.snapshot.currentVerse, latest)) return

        this.update({ currentVerse: latest })
        this.readingContext = updateContextFromVerse(latest)
        this.emit({ type: 'detected', verse: latest, detectionType: 'llm', verseCount: stamped.length })
        this.offer(latest, { confidence: latest.confidence })
    }
}

export function createScriptureFollower(options: ScriptureFollowerOptions): ScriptureFollower {
    return new ScriptureFollower(options)
}
