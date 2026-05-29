/**
 * AGGRESSIVE BUG-FINDING TESTS for voiceCommandDetection
 */

import { describe, it, expect } from 'vitest'
import { detectVoiceCommands, stripCommandsFromTranscript } from '../voiceCommandDetection'

describe('voiceCommandDetection — BUG HUNTING', () => {
    // -----------------------------------------------------------------------
    // BUG 6: Regular sermon text triggers command intent false positive
    // -----------------------------------------------------------------------
    it('[BUG 6] "we use the Bible every day" should NOT have command intent', () => {
        const cmds = detectVoiceCommands('we use the Bible every day')
        // "use the" is in COMMAND_KEYWORDS, causing false positive intent
        // Then no actual command pattern matches, so it returns []
        // But the intent filter should not fire on non-command speech
        expect(cmds).toHaveLength(0)
    })

    it('[BUG 6] "let us go to the park" should NOT be a go_to_reference', () => {
        const cmds = detectVoiceCommands('let us go to the park')
        // "go to" is in keywords, but "park" is not a Bible book
        expect(cmds).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    // BUG 7: Written number parsing matches substrings
    // -----------------------------------------------------------------------
    it('[BUG 7] "verse tool" should NOT parse as verse 2', () => {
        // "tool" contains "too" as a substring
        const cmds = detectVoiceCommands('verse tool')
        // It might match go_to_verse with targetVerse=2 because "tool".includes("too")
        const goToVerse = cmds.filter(c => c.type === 'go_to_verse')
        expect(goToVerse.length).toBe(0)
    })

    it('[BUG 7] "verse tone" should NOT parse as verse 1', () => {
        // "tone" contains "one" as a substring
        const cmds = detectVoiceCommands('verse tone')
        const goToVerse = cmds.filter(c => c.type === 'go_to_verse')
        expect(goToVerse.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG: stripCommandsFromTranscript with overlapping command text
    // -----------------------------------------------------------------------
    it('[BUG] stripCommands should handle overlapping command raw texts', () => {
        const text = 'next verse and next verse please'
        const cmds = detectVoiceCommands(text)
        const cleaned = stripCommandsFromTranscript(text, cmds)
        // After stripping both "next verse" commands, should just have "and  please"
        expect(cleaned).toBe('and please')
    })

    // -----------------------------------------------------------------------
    // BUG: empty/whitespace-only commands in stripCommands
    // -----------------------------------------------------------------------
    it('[BUG] stripCommands should handle commands with only whitespace raw', () => {
        const cmds = [{ type: 'next_verse' as const, raw: '   ', confidence: 'high' as const, offset: 1 }]
        const cleaned = stripCommandsFromTranscript('hello world', cmds)
        expect(cleaned).toBe('hello world')
    })
})
