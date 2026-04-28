import { bibleVersionObjects } from '../../types'
import type { BibleVersion } from '../../types'

export interface VoiceCommand {
    type: 'change_version' | 'next_verse' | 'previous_verse' | 'go_to_verse' | 'display' | 'stop_listening' | 'start_listening'
    raw: string
    confidence: 'high' | 'medium' | 'low'
    versionId?: string
    versionName?: string
    offset?: number
    verseRef?: string
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
            /(?:let'?s? |let us |we should |can you |please )?(?:use|switch to|change to|go to|turn to|read from) (?:the )?(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i,
            /(?:read|show|display) (?:that |it |this )?(?:in|from|using|with) (?:the )?(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i,
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
                    const actionWords = ['switch', 'change', 'use', 'go', 'turn', 'read', 'show', 'display', 'look']
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

    const nextPatterns = [
        /(?:go |move )?(?:to the |on to the )?next (?:verse|verses|chapter)/i,
        /next verse/i,
        /(?:next|go to next|move to next|advance|forward) (?:verse|verses|chapter)/i,
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

    if (commands.length === 0) {
        const prevPatterns = [
            /(?:go |move )?(?:to the |back to the )?(?:previous|prior|last) (?:verse|verses|chapter)/i,
            /(?:previous|prev|go back|back|prior|last) (?:verse|verses|chapter)/i,
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
    'go to next', 'go back', 'display', 'show that', 'put up', 'go live',
    'stop listening', 'start listening'
]

function hasCommandIntent(text: string): boolean {
    const lower = text.toLowerCase()
    return COMMAND_KEYWORDS.some(k => lower.includes(k)) ||
        /\b(KJV|NKJV|NIV|NLT|ESV|ASV|AMP|CEV|MSG|YLT|WEB)\b/i.test(text)
}

export function detectVoiceCommands(text: string): VoiceCommand[] {
    if (!text || text.length < 3) return []

    const recentText = text.slice(-300)
    if (!hasCommandIntent(recentText)) return []

    const allCommands: VoiceCommand[] = [
        ...detectVersionChangeCommands(recentText),
        ...detectNavigationCommands(recentText),
        ...detectControlCommands(recentText),
    ]

    const seen = new Set<string>()
    return allCommands.filter(cmd => {
        const key = `${cmd.type}:${cmd.versionId || ''}:${cmd.offset || ''}`
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
