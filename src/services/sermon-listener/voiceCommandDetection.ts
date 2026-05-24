import { bibleVersionObjects } from '../../types'
import type { BibleVersion } from '../../types'
import { BOOK_PATTERN, normalizeBookName, parseSpokenNumber } from './verseDetection'

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
                    const version = (bibleVersionObjects as BibleVersion[]).find(v => v.id.toUpperCase() === id.toUpperCase())
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

function detectNavigationCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    // Chapter navigation — checked first so "next chapter" doesn't fall through to verse
    const nextChapterPatterns = [
        /(?:go |move )?(?:to the |on to the )?next chapter/i,
        /(?:next|go to next|move to next|advance|forward) chapter/i,
    ]
    const nextChapterResult = scanAllMatches(lower, nextChapterPatterns)
    if (nextChapterResult) {
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
        if (prevChapterResult) {
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
        if (nextResult) {
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
        if (prevResult) {
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
            /(?:display|show|put|send|put up|bring up|go live|present|project) (?:it|that|this)/i,
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

const WRITTEN_NUMBERS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    // Common mishearings
    too: 2, to: 2,
}

function parseVerseNumber(text: string): number | null {
    // Try digit first (e.g. "verse 15")
    const digitMatch = text.match(/\b(\d{1,3})\b/)
    if (digitMatch) {
        const n = parseInt(digitMatch[1], 10)
        if (n >= 1 && n <= 150) return n
    }
    // Try written number (e.g. "verse three")
    const lower = text.toLowerCase()
    for (const [word, num] of Object.entries(WRITTEN_NUMBERS)) {
        if (lower.includes(word)) return num
    }
    return null
}

function detectGoToVerseCommands(text: string): VoiceCommand[] {
    const commands: VoiceCommand[] = []
    const lower = text.toLowerCase()

    // "verse 15", "verse three", "go to verse 15", "jump to verse 15",
    // "show verse 15", "read verse 15", "take me to verse 15"
    const patterns = [
        /\b(?:go to|jump to|take me to|show|read|display|present)\s+(?:verse\s+)?(\d{1,3}|[a-z]+)\b/i,
        /\bverse\s+(\d{1,3}|[a-z]+)\b/i,
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
const BOOK_CHAPTER_REGEX = new RegExp(
    `\\b(${BOOK_PATTERN})[,]?\\s*(?:chapter\\s+)?(\\d{1,3}|${SPOKEN_NUMBERS})\\b(?!\\s*(?:[:\\.\\-]|x|vs\\.?|verse)\\s*\\d)`,
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
            if (book && chapter !== null) {
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

    // 2. Standalone book+chapter (no action verb) — lower confidence
    if (commands.length === 0) {
        BOOK_CHAPTER_REGEX.lastIndex = 0
        let bcMatch: RegExpExecArray | null
        while ((bcMatch = BOOK_CHAPTER_REGEX.exec(text)) !== null) {
            const book = normalizeBookName(bcMatch[1])
            const chapter = parseChapter(bcMatch[2])
            if (book && chapter !== null) {
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
    'chapter', 'open', 'read', 'turn to', 'return to',
]

function hasCommandIntent(text: string): boolean {
    const lower = text.toLowerCase()
    return COMMAND_KEYWORDS.some(k => lower.includes(k)) ||
        /\b(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i.test(text)
}

export function detectVoiceCommands(text: string): VoiceCommand[] {
    if (!text || text.length < 3) return []

    const recentText = text.slice(-300)

    // Standalone book+chapter references (e.g. "Matthew 8", "Psalm 23") are valid
    // voice commands even when no action verb is present. Check these first so
    // they are not blocked by the keyword-intent filter.
    const referenceCommands = detectGoToReferenceCommands(recentText)

    const hasIntent = hasCommandIntent(recentText)
    if (!hasIntent && referenceCommands.length === 0) {
        console.log('[VoiceCommand] No command intent in:', recentText.slice(-80))
        return []
    }

    const allCommands: VoiceCommand[] = [
        ...detectVersionChangeCommands(recentText),
        ...detectNavigationCommands(recentText),
        ...detectGoToVerseCommands(recentText),
        ...referenceCommands,
        ...detectControlCommands(recentText),
    ]

    if (allCommands.length === 0) {
        console.log('[VoiceCommand] Intent found but no command matched:', recentText.slice(-80))
    } else {
        console.log('[VoiceCommand] Matched:', allCommands.map(c => `${c.type}(${c.confidence})`))
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
    for (const cmd of commands) {
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
