import { bibleVersionObjects } from '../../types'
import type { BibleVersion } from '../../types'
import { BOOK_PATTERN, BOOK_MAX_CHAPTER, BOOK_MAX_VERSES, normalizeBookName, parseSpokenNumber } from './verseDetection'

export interface VoiceCommand {
    type: 'change_version' | 'next_verse' | 'previous_verse' | 'next_chapter' | 'previous_chapter' | 'go_to_verse' | 'go_to_reference' | 'display' | 'stop_listening' | 'start_listening'
    raw: string
    confidence: 'high' | 'medium' | 'low'
    versionId?: string
    versionName?: string
    offset?: number
    verseRef?: string
    targetVerse?: number
    book?: string
    chapter?: number
    verse?: number
}

const AVAILABLE_VERSIONS: Array<{ id: string; names: string[] }> = (() => {
    const allVersions = bibleVersionObjects as BibleVersion[]
    return allVersions.map(v => {
        const id = v.id.toUpperCase()
        const fullName = v.name.toLowerCase()
        const names = [id, fullName]

        if (id === 'KJV') names.push('king james', 'king james version', 'authorized', 'authorized version')
        else if (id === 'NKJV') names.push('new king james', 'new king james version')
        else if (id === 'NIV') names.push('new international', 'new international version')
        else if (id === 'NLT') names.push('new living translation', 'new living')
        else if (id === 'ESV') names.push('english standard', 'english standard version')
        else if (id === 'ASV') names.push('american standard', 'american standard version')
        else if (id === 'AMP') names.push('amplified', 'amplified bible', 'amplified version')
        else if (id === 'CEV') names.push('contemporary english', 'contemporary english version')
        else if (id === 'MSG') names.push('the message', 'message')
        else if (id === 'YLT') names.push("young's literal", 'young literal')
        else if (id === 'WEB') names.push('world english', 'world english bible')

        return { id: v.id, names }
    })
})()

// "WEB" (World English Bible) and "AMP" (Amplified) are ordinary English
// words too ("the web", "turn up the amp") — matching them bare is a
// version-switch false-positive risk that the other codes (KJV, NIV, ESV...)
// don't have.
const AMBIGUOUS_VERSION_CODES = new Set(['WEB', 'AMP'])
const BIBLE_CONTEXT_RE = /\b(bible|version|translation|scripture)\b/i

function findVersionMatch(text: string): { id: string; name: string } | null {
    const lower = text.toLowerCase()

    const exactRegex = /\b(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i
    const exactMatch = exactRegex.exec(text)
    if (exactMatch) {
        const id = exactMatch[1].toUpperCase()
        const version = (bibleVersionObjects as BibleVersion[]).find(v => v.id === id)
        if (version) return { id: version.id, name: version.name }
    }

    for (const v of AVAILABLE_VERSIONS) {
        for (const name of v.names) {
            if (lower.includes(name)) {
                const version = (bibleVersionObjects as BibleVersion[]).find(bv => bv.id === v.id)
                if (version) return { id: version.id, name: version.name }
            }
        }
    }

    return null
}

function detectVersionChangeCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    const versionPatterns = [
        /(?:switch|change|use|switch to|change to|use the|go to|turn to|read from|read in|show|display|look up|read the) (?:the )?(?:bible )?version (?:to )?(.+)/i,
        /(?:switch|change|use|switch to|change to|use the|go to|turn to|read from|read in|show|display|look up) (?:the )?(.+?)(?:\s+version)?/i,
        /(?:read|show|display) (?:that |it |this )?(?:in|from|using|with) (?:the )?(.+?)(?:\s+version)?(?:\s*[,.]?\s*$)/i,
        /(?:bible )?version (?:to |to:?)?(.+)/i,
    ]

    // Collect all explicit matches and keep the LAST valid one in this utterance.
    // This prevents stale earlier mentions from overriding the user's latest command.
    let lastExplicit: VoiceCommand | null = null
    for (const pattern of versionPatterns) {
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
            const versionText = (match[1] || '').trim().replace(/[.,;!?]+$/, '')
            const versionMatch = findVersionMatch(versionText)
            if (!versionMatch) continue
            lastExplicit = {
                type: 'change_version',
                raw: match[0].trim(),
                confidence: 'high',
                versionId: versionMatch.id,
                versionName: versionMatch.name,
            }
        }
    }
    if (lastExplicit) commands.push(lastExplicit)

    if (commands.length === 0) {
        const standalonePatterns = [
            /(?:let'?s? |let us |we should |can you |please )?(?:use|switch to|change to|go to|turn to|read from|pull up|bring up|open) (?:the )?(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i,
            /(?:read|show|display) (?:that |it |this )?(?:in|from|using|with) (?:the )?(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i,
            /(?:give me|get me|i want|i need|i'd like|load|make it|set (?:it )?to) (?:the )?(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i,
            /(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b\s*(?:please|now|if you will|if you would)/i,
        ]

        for (const pattern of standalonePatterns) {
            const match = pattern.exec(text)
            if (match) {
                const id = match[1] || match[2]
                if (id) {
                    const upperId = id.toUpperCase()
                    // "WEB" and "AMP" are also ordinary English words ("the web",
                    // "turn up the amp"). "switch to"/"change to"/"use" are
                    // unambiguous — nobody says "switch to the web" meaning
                    // "browse the internet" — so those stay trusted bare. But
                    // generic verbs ("go to", "turn to", "read from", "pull up",
                    // "bring up", "open") combine naturally with the ordinary
                    // meaning too ("go to the web", "open the web page"), so for
                    // those, require an explicit bible/version/translation
                    // mention elsewhere in the utterance.
                    const hasStrongVersionVerb = /\b(?:switch to|change to|use)\b/i.test(match[0])
                    if (AMBIGUOUS_VERSION_CODES.has(upperId) && !hasStrongVersionVerb && !BIBLE_CONTEXT_RE.test(text)) {
                        continue
                    }
                    const version = (bibleVersionObjects as BibleVersion[]).find(v => v.id.toUpperCase() === upperId)
                    if (version) {
                        commands.push({
                            type: 'change_version',
                            raw: match[0].trim(),
                            confidence: 'high',
                            versionId: version.id,
                            versionName: version.name,
                        })
                        break
                    }
                }
            }
        }
    }

    if (commands.length === 0) {
        // Loosest tier: no adjacency required between the action word and the
        // version alias — the action word can appear anywhere earlier and the
        // alias anywhere later in the utterance. Several aliases are ordinary
        // English words ("message", "amplified"), so this tier additionally
        // requires an explicit bible/version/translation mention to avoid
        // firing on sentences that just happen to contain both an action verb
        // and one of these words (e.g. "he wants to read the message on the
        // wall", "we should use the amplified version of grace").
        if (BIBLE_CONTEXT_RE.test(lower)) {
            for (const v of AVAILABLE_VERSIONS) {
                for (const name of v.names) {
                    if (name.length >= 3 && lower.includes(name)) {
                        const beforeText = lower.substring(0, lower.indexOf(name))
                        const actionWords = ['switch', 'change', 'use', 'go', 'turn', 'read', 'show', 'display', 'look', 'give me', 'get me', 'pull up', 'bring up', 'open', 'see', 'try', 'need', 'want', 'like', 'make it', 'set to', 'please']
                        const hasActionContext = actionWords.some(w => beforeText.includes(w))
                        if (hasActionContext) {
                            const version = (bibleVersionObjects as BibleVersion[]).find(bv => bv.id === v.id)
                            if (version) {
                                commands.push({
                                    type: 'change_version',
                                    raw: text.substring(lower.indexOf(name), lower.indexOf(name) + name.length),
                                    confidence: 'medium',
                                    versionId: version.id,
                                    versionName: version.name,
                                })
                                break
                            }
                        }
                    }
                }
                if (commands.length > 0) break
            }
        }
    }

    return commands
}

function scanAllMatches(text: string, patterns: RegExp[]): { match: RegExpExecArray; pattern: RegExp } | null {
    let lastMatch: { match: RegExpExecArray; pattern: RegExp } | null = null
    for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        let m: RegExpExecArray | null
        while ((m = regex.exec(text)) !== null) {
            lastMatch = { match: m, pattern }
        }
    }
    return lastMatch
}

// "next verse"/"previous chapter" etc. said as a bare directive (or right
// after an imperative verb like "go"/"move"/"turn") is a genuine navigation
// request. The identical phrase used narratively — "in the next verse, Paul
// explains...", "as we saw in the previous chapter..." — is extremely common
// in verse-by-verse preaching and must not step the live screen. Distinguish
// by what immediately precedes the match: a narrating preposition/verb ("in",
// "at", "for", "as", "see", "saw", "read", "reading", "looking at", "note(d)")
// right before an optional "the" means narration, not a command.
const NARRATIVE_PRECEDER_RE = /\b(?:in|at|for|as|see|saw|read|reading|looking at|note|noted)\s+(?:the\s+)?$/i

function isNarrativelyFramed(text: string, matchIndex: number): boolean {
    const before = text.slice(Math.max(0, matchIndex - 30), matchIndex)
    return NARRATIVE_PRECEDER_RE.test(before)
}

function detectNavigationCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    // Chapter navigation — checked first so "next chapter" doesn't fall through to verse
    const nextChapterPatterns = [
        /(?:go |move )?(?:to the |on to the )?next chapter/i,
        /(?:next|go to next|move to next|advance|forward) chapter/i,
    ]
    const nextChapterResult = scanAllMatches(lower, nextChapterPatterns)
    if (nextChapterResult && !isNarrativelyFramed(lower, nextChapterResult.match.index)) {
        commands.push({
            type: 'next_chapter',
            raw: nextChapterResult.match[0],
            confidence: 'high',
        })
    }

    if (commands.length === 0) {
        const prevChapterPatterns = [
            /(?:go |move )?(?:to the |back to the )?(?:previous|prior|last) chapter/i,
            /(?:previous|prev|go back|back|prior|last) chapter/i,
        ]
        const prevChapterResult = scanAllMatches(lower, prevChapterPatterns)
        if (prevChapterResult && !isNarrativelyFramed(lower, prevChapterResult.match.index)) {
            commands.push({
                type: 'previous_chapter',
                raw: prevChapterResult.match[0],
                confidence: 'high',
            })
        }
    }

    // Verse navigation
    if (commands.length === 0) {
        const nextPatterns = [
            /(?:go |move )?(?:to the |on to the )?next (?:verse|verses)/i,
            /next verse/i,
            /(?:next|go to next|move to next|advance|forward) (?:verse|verses)/i,
        ]

        const nextResult = scanAllMatches(lower, nextPatterns)
        if (nextResult && !isNarrativelyFramed(lower, nextResult.match.index)) {
            commands.push({
                type: 'next_verse',
                raw: nextResult.match[0],
                confidence: 'high',
                offset: 1,
            })
        }
    }

    if (commands.length === 0) {
        const prevPatterns = [
            /(?:go |move )?(?:to the |back to the )?(?:previous|prior|last) (?:verse|verses)/i,
            /(?:previous|prev|go back|back|prior|last) (?:verse|verses)/i,
        ]

        const prevResult = scanAllMatches(lower, prevPatterns)
        if (prevResult && !isNarrativelyFramed(lower, prevResult.match.index)) {
            commands.push({
                type: 'previous_verse',
                raw: prevResult.match[0],
                confidence: 'high',
                offset: -1,
            })
        }
    }

    if (commands.length === 0) {
        const displayPatterns = [
            /(?:display|show|put|send|put up|bring up|go live|go live with|present|project) (?:this |that |the )?(?:verse|scripture|passage|text)/i,
            // Bare pronoun object — "that" is deliberately excluded: it's the
            // start of an ordinary subordinate clause in preaching ("I want to
            // show THAT God is faithful"), not a command, far more often than
            // "it"/"this" are.
            /(?:display|show|put|send|put up|bring up|go live|present|project) (?:it|this)/i,
        ]

        const displayResult = scanAllMatches(lower, displayPatterns)
        if (displayResult) {
            commands.push({
                type: 'display',
                raw: displayResult.match[0],
                confidence: 'medium',
            })
        }
    }

    return commands
}

// Common single-word mishearings that aren't in the standard SPOKEN_NUMBERS
// vocabulary (used below only as a last-resort fallback for parseVerseNumber).
const NUMBER_WORD_MISHEARINGS: Record<string, number> = { too: 2, to: 2 }

// Psalm 119 has 176 verses — the longest chapter in the Bible — so that's
// the real sanity ceiling for a verse number (as opposed to a chapter
// number, which caps out around 150 for Psalms).
const MAX_PLAUSIBLE_VERSE = 176

function parseVerseNumber(text: string): number | null {
    // Try digit first (e.g. "verse 15")
    const digitMatch = text.match(/\b(\d{1,3})\b/)
    if (digitMatch) {
        const n = parseInt(digitMatch[1], 10)
        if (n >= 1 && n <= MAX_PLAUSIBLE_VERSE) return n
    }
    // Written/compound number (e.g. "verse three", "verse twenty five",
    // "verse hundred and seventy six"). parseSpokenNumber (verseDetection.ts)
    // already handles multi-word compounds and "and" — this used to be a
    // tiny hand-rolled map covering only single words 1-20, so anything
    // higher ("verse thirty", "verse forty seven" — extremely common real
    // verse numbers) silently produced no command at all.
    const spoken = parseSpokenNumber(text)
    if (spoken !== null && spoken >= 1 && spoken <= MAX_PLAUSIBLE_VERSE) return spoken
    const lower = text.toLowerCase()
    for (const [word, num] of Object.entries(NUMBER_WORD_MISHEARINGS)) {
        if (new RegExp(`\\b${word}\\b`).test(lower)) return num
    }
    return null
}

function detectGoToVerseCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    // "verse 15", "verse three", "verse twenty five", "go to verse 15",
    // "jump to verse 15", "show verse 15", "read verse 15", "take me to
    // verse 15".
    // "versus" is accepted alongside "verse" — Whisper very commonly
    // mishears a bare spoken "verse" as "versus" (phonetically close),
    // confirmed repeatedly across real sermon transcripts. Without this,
    // essentially every bare "verse N" follow-up said in its own utterance
    // (the common case with real-time ASR) silently produced no command at
    // all, leaving the live slide stuck on whatever the earlier bare
    // chapter mention displayed.
    const patterns = [
        new RegExp(`\\b(?:go to|jump to|take me to|show|read|display|present)\\s+(?:(?:verse|versus)\\s+)?(\\d{1,3}|${SPOKEN_NUMBER_PHRASE})\\b`, 'i'),
        new RegExp(`\\b(?:verse|versus)\\s+(\\d{1,3}|${SPOKEN_NUMBER_PHRASE})\\b`, 'i'),
    ]

    let lastMatch: { raw: string; numStr: string } | null = null
    for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        let m: RegExpExecArray | null
        while ((m = regex.exec(text)) !== null) {
            lastMatch = { raw: m[0].trim(), numStr: m[1] }
        }
    }

    if (lastMatch) {
        const targetVerse = parseVerseNumber(lastMatch.numStr)
        if (targetVerse) {
            commands.push({
                type: 'go_to_verse',
                raw: lastMatch.raw,
                confidence: 'high',
                targetVerse,
            })
        }
    }

    return commands
}

// Detect book + chapter references without a verse (e.g. "Psalm 23", "Matthew 5", "Mark chapter 28")
// Also handles spoken numbers: "Matthew chapter six" → chapter 6
// Negative lookahead ensures we don't capture "Psalm 23:1" which is handled by verse detection.
const SPOKEN_NUMBERS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third'

// BOOK + CHAPTER + VERSE — runs BEFORE the chapter-only detector so that
// "John 3:16" / "John 3 16" / "John chapter three sixteen" all dispatch as
// go_to_reference with the actual verse, instead of falling through to the
// search normalization path (which mangles them into nonsense like "John 31:6").
// Order in the alternation matters — colon/dot/dash/verse/×/x before space,
// so "John 3:16" wins over "John 3 16" when both could match.
// The "chapter" keyword can appear either before the number ("chapter 6")
// or after it ("6 chapter" / "the 6th chapter") — both are common spoken
// forms, and missing the latter causes this whole detector to fall through
// to a bare go_to_verse, which then gets stripped from the transcript and
// corrupts the surrounding text for the main regex verse detector.
// Chapter numbers may carry a digit-ordinal suffix from spoken "the 6th
// chapter" phrasing ("6th", "21st"). parseChapter()/parseInt() already
// ignore the trailing letters, so it's safe to accept them here — without
// this, "Ephesians the 6th chapter..." fails to match at all and falls
// back to a bare go_to_verse, which then corrupts the transcript when
// stripped (see comment above).
// Chapter/verse numbers above 20 are routinely spoken as a compound phrase
// — "twenty five", "forty seven", "Psalm hundred and forty seven" — not a
// single word. A single-word-only capture only ever grabs the first word
// ("twenty", "hundred") and silently drops the rest, producing the WRONG
// number instead of failing to match at all — worse than a miss, because
// it's confidently wrong. parseSpokenNumber() (verseDetection.ts) already
// supports the full compound, including "and", once given the whole
// phrase — this just widens what the regex hands it. Capped at 4 words,
// which comfortably covers anything up to "one hundred and seventy six"
// (Psalm 119's verse count, the longest chapter in the Bible).
const SPOKEN_NUMBER_WORD = `(?:${SPOKEN_NUMBERS})`
const SPOKEN_NUMBER_PHRASE = `${SPOKEN_NUMBER_WORD}(?:\\s+(?:and\\s+)?${SPOKEN_NUMBER_WORD}){0,3}`
const CHAPTER_NUM = `\\d{1,3}(?:st|nd|rd|th)?|${SPOKEN_NUMBER_PHRASE}`

// The loose fallback below has no explicit separator keyword — it treats
// any bare number after whitespace as the verse. A compound chapter phrase
// like "hundred and forty seven" (or even just "twenty five") ends in a
// plain number word, so the regex engine happily backtracks CHAPTER_NUM to
// swallow only "hundred and forty" and hands "seven" off as the verse,
// turning "Psalm hundred and forty seven" into 140:7 instead of chapter
// 147. The strict/chapter-only regexes below don't have this ambiguity
// (they require an explicit separator or no verse at all), so only the
// loose regex needs the single-word-only variant.
const CHAPTER_NUM_LOOSE = `\\d{1,3}(?:st|nd|rd|th)?|${SPOKEN_NUMBERS}`

// "versus" is accepted as a separator alongside "verse" — Whisper very
// commonly mishears a bare spoken "verse" as "versus" (they're
// phonetically close), confirmed repeatedly across real sermon transcripts.
const BOOK_CHAPTER_VERSE_REGEX = new RegExp(
    `\\b(${BOOK_PATTERN})(?:[,\\s]+(?:the\\s+)?(?:chapter\\s+)?)?(${CHAPTER_NUM})(?:\\s+chapter)?\\s*(?:[:\\.\\-x×]|vs\\.?|versus|verse)\\s*(\\d{1,3}|${SPOKEN_NUMBERS})(?:\\s*(?:to|through|-|–|—)\\s*(\\d{1,3}))?\\b`,
    'gi',
)

// Looser fallback: "John 3 16" / "John three sixteen" / "Romans 10, 17"
// (comma instead of a keyword separator). Only used if the strict regex
// above produced nothing, and we validate the numbers against
// BOOK_MAX_CHAPTER / BOOK_MAX_VERSES to reject "John 31 6" / "Psalms 200 5".
const BOOK_CHAPTER_VERSE_LOOSE_REGEX = new RegExp(
    `\\b(${BOOK_PATTERN})[,\\s]+(?:the\\s+)?(?:chapter\\s+)?(${CHAPTER_NUM_LOOSE})(?:\\s+chapter)?[,\\s]+(\\d{1,3}|${SPOKEN_NUMBERS})\\b`,
    'gi',
)

const BOOK_CHAPTER_REGEX = new RegExp(
    `\\b(${BOOK_PATTERN})[,]?\\s*(?:the\\s+)?(?:chapter\\s+)?(${CHAPTER_NUM})(?:\\s+chapter)?\\b(?!\\s*(?:[:\\.\\-x×]|vs\\.?|versus|verse)\\s*\\d)`,
    'gi',
)

/** Parse a chapter string — handles digits ("5") and spoken numbers ("six"). */
function parseChapter(raw: string): number | null {
    const digit = parseInt(raw, 10)
    if (!Number.isNaN(digit) && digit >= 1) return digit
    const spoken = parseSpokenNumber(raw)
    if (spoken !== null && spoken >= 1) return spoken
    return null
}

function detectGoToReferenceCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []

    // Reset lastIndex so stale state from prior calls doesn't skip the first match
    BOOK_CHAPTER_REGEX.lastIndex = 0

    // 1. Action-verb based: "open Psalm 23", "go to Matthew 5", "show me John 3", "turn to chapter 6"
    const actionRefPattern = /\b(?:open|go to|turn to|return to|show|read|display|present|take me to|jump to)\s+(?:the\s+)?(?:book\s+of\s+)?(.+)/gi
    let actionMatch: RegExpExecArray | null
    while ((actionMatch = actionRefPattern.exec(text)) !== null) {
        const rest = actionMatch[1].trim()
        BOOK_CHAPTER_REGEX.lastIndex = 0
        const bcMatch = BOOK_CHAPTER_REGEX.exec(rest)
        if (bcMatch) {
            const book = normalizeBookName(bcMatch[1])
            const chapter = parseChapter(bcMatch[2])
            const maxChapter = book ? BOOK_MAX_CHAPTER[book] : undefined
            if (book && chapter !== null && maxChapter !== undefined && chapter <= maxChapter) {
                commands.push({
                    type: 'go_to_reference',
                    raw: actionMatch[0].trim(),
                    confidence: 'high',
                    book,
                    chapter,
                    verse: 1,
                })
            }
        }
    }

    // 2. Standalone book+chapter (no action verb) — lower confidence.
    // Unlike branch 1, there's no imperative verb here to establish command
    // intent, so a narrating mention ("in Isaiah 43, for I have redeemed
    // you...", "back in Deuteronomy 6...") is otherwise indistinguishable
    // from a real "go to Isaiah 43" directive — exactly the same ambiguity
    // detectNavigationCommands() guards against for "next verse"/"previous
    // chapter" via isNarrativelyFramed(). Apply the same guard here: a
    // narrating preposition/verb right before the match means this chunk is
    // quoting/discussing that chapter, not requesting navigation to it.
    if (commands.length === 0) {
        BOOK_CHAPTER_REGEX.lastIndex = 0
        let bcMatch: RegExpExecArray | null
        while ((bcMatch = BOOK_CHAPTER_REGEX.exec(text)) !== null) {
            if (isNarrativelyFramed(text, bcMatch.index)) continue
            const book = normalizeBookName(bcMatch[1])
            const chapter = parseChapter(bcMatch[2])
            const maxChapter = book ? BOOK_MAX_CHAPTER[book] : undefined
            if (book && chapter !== null && maxChapter !== undefined && chapter <= maxChapter) {
                commands.push({
                    type: 'go_to_reference',
                    raw: bcMatch[0].trim(),
                    confidence: 'medium',
                    book,
                    chapter,
                    verse: 1,
                })
            }
        }
    }

    return commands
}

/**
 * Detect a fully-qualified book + chapter + verse reference like
 * "John 3:16", "John 3.16", "John 3-16", "John 3 16", "John chapter three sixteen".
 * Returns commands with verse populated, ready for `go_to_reference` dispatch.
 *
 * Optional action-verb prefix ("open John 3:16") gets high confidence;
 * bare reference ("John 3 16") gets medium confidence. Numbers are
 * validated against BOOK_MAX_CHAPTER / BOOK_MAX_VERSES so a transcript
 * like "John 31 6" doesn't produce a nonsense reference.
 */
function detectBookChapterVerseCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []

    const actionPrefix = '\\b(?:open|go to|turn to|return to|show|read|display|present|take me to|jump to|find|navigate to)\\s+(?:the\\s+)?(?:book\\s+of\\s+)?'

    // 1. Strict: explicit separator (`John 3:16`, `John 3.16`, `John 3-16`,
    //    `John 3×16`, `John 3 x 16`, `John 3 vs 16`, `John 3 verse 16`).
    BOOK_CHAPTER_VERSE_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = BOOK_CHAPTER_VERSE_REGEX.exec(text)) !== null) {
        const prefixMatch = text.slice(0, m.index).match(new RegExp(actionPrefix + '$', 'i'))
        const book = normalizeBookName(m[1])
        const chapter = parseChapter(m[2])
        const verse = parseSpokenNumber(m[3])
        const bookMaxVerses = book ? BOOK_MAX_VERSES[book] : undefined
        if (book && chapter !== null && verse !== null) {
            const maxVerse = bookMaxVerses?.[chapter - 1]
            if (!maxVerse || verse <= maxVerse) {
                commands.push({
                    type: 'go_to_reference',
                    raw: m[0].trim(),
                    confidence: prefixMatch ? 'high' : 'medium',
                    book,
                    chapter,
                    verse,
                })
            }
        }
    }

    // 2. Loose: no separator, "John 3 16" / "John three sixteen".
    //    Validate against max chapter / max verse to reject "John 31 6" /
    //    "Psalms 200 5" (both numbers must be plausible).
    if (commands.length === 0) {
        BOOK_CHAPTER_VERSE_LOOSE_REGEX.lastIndex = 0
        let lm: RegExpExecArray | null
        while ((lm = BOOK_CHAPTER_VERSE_LOOSE_REGEX.exec(text)) !== null) {
            const prefixMatch = text.slice(0, lm.index).match(new RegExp(actionPrefix + '$', 'i'))
            const book = normalizeBookName(lm[1])
            const chapter = parseChapter(lm[2])
            const verse = parseSpokenNumber(lm[3])
            const maxChapter = book ? BOOK_MAX_CHAPTER[book] : undefined
            const maxVerse = book && chapter !== null ? BOOK_MAX_VERSES[book]?.[chapter - 1] : undefined
            // This regex exists to split two adjacent numbers into
            // chapter+verse ("John 3 16", "Romans 10, 17") when nothing else
            // separates them. But "twenty five" is ALSO two adjacent number
            // words, and is a legitimate single compound chapter number
            // ("Psalm chapter twenty five" = Psalm 25, no verse). If the two
            // captured words also parse as one combined compound number,
            // this split is ambiguous with that — and BOOK_MAX_VERSES alone
            // can't tell them apart, since "chapter 20 verse 5" and
            // "chapter 25" are both independently plausible references.
            // Defer to the chapter-only detector in that case instead of
            // guessing, rather than confidently showing the wrong verse.
            const combinesIntoOneNumber = parseSpokenNumber(`${lm[2]} ${lm[3]}`) !== null
            if (
                book &&
                chapter !== null &&
                verse !== null &&
                maxChapter !== undefined &&
                maxVerse !== undefined &&
                chapter <= maxChapter &&
                verse <= maxVerse &&
                verse >= 1 &&
                !combinesIntoOneNumber
            ) {
                commands.push({
                    type: 'go_to_reference',
                    raw: lm[0].trim(),
                    confidence: prefixMatch ? 'high' : 'medium',
                    book,
                    chapter,
                    verse,
                })
            }
        }
    }

    return commands
}

function detectControlCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    if (/(?:stop listening|stop the listener|pause listening|end listening)/i.test(lower)) {
        commands.push({
            type: 'stop_listening',
            raw: lower.match(/(?:stop listening|stop the listener|pause listening|end listening)/i)![0],
            confidence: 'high',
        })
    }

    if (/(?:start listening|resume listening|begin listening)/i.test(lower)) {
        commands.push({
            type: 'start_listening',
            raw: lower.match(/(?:start listening|resume listening|begin listening)/i)![0],
            confidence: 'high',
        })
    }

    return commands
}

const COMMAND_KEYWORDS = [
    'version', 'switch', 'change', 'use the', 'next verse', 'previous verse',
    'next chapter', 'previous chapter', 'go to', 'go to next', 'go back', 'display',
    'show that', 'put up', 'go live', 'stop listening', 'start listening', 'verse',
    // "versus" is not a substring of "verse" ("versus".includes("verse") is
    // false — they diverge at the 5th letter), so it needs its own entry.
    // Whisper very commonly mishears a bare spoken "verse" as "versus";
    // without this, "Versus 6" never clears the intent gate below, so even
    // after detectGoToVerseCommands() learns to parse it, this function
    // still short-circuits to [] before ever calling it.
    'versus',
    'chapter', 'open', 'read', 'turn to', 'return to',
]

function hasCommandIntent(text: string): boolean {
    const lower = text.toLowerCase()
    return COMMAND_KEYWORDS.some(k => lower.includes(k)) ||
        /\b(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i.test(text)
}

export interface DetectVoiceCommandsOptions {
    /**
     * Emit the per-call match/no-match diagnostics. Off by default.
     *
     * Only the call site that actually *executes* commands should turn this
     * on. The transcript-stripping path calls this on every chunk over the
     * whole accumulated transcript, and because matching runs on a trailing
     * window a reference spoken once keeps re-matching for dozens of chunks —
     * which buried the real command decisions under ~100 lines of noise per
     * sermon. The repeats were never executed (execution is gated on the
     * latest utterance plus a dedupe window), they were only logged.
     */
    debug?: boolean
}

export function detectVoiceCommands(
    text: string,
    options: DetectVoiceCommandsOptions = {},
): VoiceCommand[] {
    if (!text || text.length < 3) return []

    const debug = options.debug ?? false
    const recentText = text.slice(-300)

    // Standalone book+chapter references (e.g. "Matthew 8", "Psalm 23") are valid
    // voice commands even when no action verb is present. Check these first so
    // they are not blocked by the keyword-intent filter.
    const referenceCommands = detectGoToReferenceCommands(recentText)

    // Book + chapter + verse (e.g. "John 3:16", "John 3 16", "John chapter three sixteen")
    // — runs BEFORE the chapter-only detector and BEFORE falling through to search,
    // so the verse is captured instead of being mangled by the search normalizer.
    const bookChapterVerseCommands = detectBookChapterVerseCommands(recentText)
    const goToVerseCommands = detectGoToVerseCommands(recentText)

    const hasIntent = hasCommandIntent(recentText)
    if (
        !hasIntent &&
        referenceCommands.length === 0 &&
        bookChapterVerseCommands.length === 0
    ) {
        if (debug) console.log('[VoiceCommand] No command intent in:', recentText.slice(-80))
        return []
    }

    // A bare "book + chapter" mention (detectGoToReferenceCommands) always
    // defaults to verse 1 — it never even tries to parse a verse number. If
    // this same utterance ALSO produced a command with an actual verse
    // number (a spoken "verse N", or a full "book chapter verse"), that's
    // strictly more specific and describes what was really said. Without
    // this, both fire and execute in the order collected below, so the
    // specific one ("go to verse 4") gets immediately overwritten by the
    // less-specific one jumping back to verse 1 — e.g. "2 Corinthians
    // chapter 4 verse 4" briefly displayed verse 1 before the semantic layer
    // corrected it moments later.
    const hasMoreSpecificVerseCommand = goToVerseCommands.length > 0 || bookChapterVerseCommands.length > 0
    const effectiveReferenceCommands = hasMoreSpecificVerseCommand ? [] : referenceCommands

    const allCommands: VoiceCommand[] = [
        ...detectVersionChangeCommands(recentText),
        ...detectNavigationCommands(recentText),
        ...goToVerseCommands,
        ...bookChapterVerseCommands,
        ...effectiveReferenceCommands,
        ...detectControlCommands(recentText),
    ]

    if (debug) {
        if (allCommands.length === 0) {
            console.log('[VoiceCommand] Intent found but no command matched:', recentText.slice(-80))
        } else {
            console.log('[VoiceCommand] Matched:', allCommands.map(c => `${c.type}(${c.confidence})`))
        }
    }

    const seen = new Set<string>()
    return allCommands.filter(cmd => {
        const key = cmd.type === 'go_to_reference'
            ? `${cmd.type}:${cmd.book || ''}:${cmd.chapter || ''}`
            : `${cmd.type}:${cmd.versionId || ''}:${cmd.offset || ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

export function stripCommandsFromTranscript(text: string, commands: VoiceCommand[]): string {
    let cleaned = text
    // Strip longest raw text first. Commands can overlap (e.g. a bare
    // "verse 4" go_to_verse match is a substring of a fuller "Corinthians
    // chapter 4 verse 4" go_to_reference match) — stripping the shorter one
    // first would eat only the tail of the longer one, leaving a truncated
    // "Corinthians chapter 4" behind for the regex verse detector to
    // misread as a bare chapter reference (defaulting to verse 1).
    const byRawLengthDesc = [...commands].sort((a, b) => (b.raw?.length || 0) - (a.raw?.length || 0))
    for (const cmd of byRawLengthDesc) {
        if (cmd.raw && cmd.raw.length > 2) {
            const escaped = cmd.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '')
        }
    }
    return cleaned.replace(/\s{2,}/g, ' ').trim()
}

export function getVersionDisplayName(versionId: string): string {
    const version = (bibleVersionObjects as BibleVersion[]).find(v => v.id === versionId)
    return version?.name || versionId
}
