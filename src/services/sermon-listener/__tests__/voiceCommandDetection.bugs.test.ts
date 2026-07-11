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

    // -----------------------------------------------------------------------
    // Regression tests for false-positive shapes found in the precision audit
    // -----------------------------------------------------------------------
    it('"let\'s go to the web and look this up" should NOT switch to WEB translation', () => {
        const cmds = detectVoiceCommands("let's go to the web and look this up")
        expect(cmds.some(c => c.type === 'change_version')).toBe(false)
    })

    it('"please go to the web for more info" should NOT switch to WEB translation', () => {
        const cmds = detectVoiceCommands('please go to the web for more info')
        expect(cmds.some(c => c.type === 'change_version')).toBe(false)
    })

    it('"switch to WEB" (explicit, unambiguous verb) should still switch translation', () => {
        const cmds = detectVoiceCommands('switch to WEB')
        expect(cmds.some(c => c.type === 'change_version' && c.versionId === 'WEB')).toBe(true)
    })

    it('"he wants to read the message written on the wall" should NOT switch to MSG', () => {
        const cmds = detectVoiceCommands('he wants to read the message written on the wall')
        expect(cmds.some(c => c.type === 'change_version')).toBe(false)
    })

    it('"we should use the amplified version of grace" mentions "version" so it IS a real command', () => {
        // This one legitimately says "version" — it's a real (if unusual) request.
        const cmds = detectVoiceCommands('we should use the amplified version of grace in our lives')
        expect(cmds.some(c => c.type === 'change_version' && c.versionId === 'AMP')).toBe(true)
    })

    it('"turn up the amp before we start" should NOT switch to AMP translation', () => {
        const cmds = detectVoiceCommands('turn up the amp before we start')
        expect(cmds.some(c => c.type === 'change_version')).toBe(false)
    })

    it('"in the next verse, Paul explains grace to us" should NOT trigger next_verse navigation', () => {
        const cmds = detectVoiceCommands('in the next verse, Paul explains grace to us')
        expect(cmds.some(c => c.type === 'next_verse')).toBe(false)
    })

    it('"as we saw in the previous verse, David repented" should NOT trigger previous_verse navigation', () => {
        const cmds = detectVoiceCommands('as we saw in the previous verse, David repented')
        expect(cmds.some(c => c.type === 'previous_verse')).toBe(false)
    })

    it('"let\'s go to the next verse together" (genuine command) should still trigger next_verse', () => {
        const cmds = detectVoiceCommands("let's go to the next verse together")
        expect(cmds.some(c => c.type === 'next_verse')).toBe(true)
    })

    it('bare "next verse" (terse command) should still trigger next_verse', () => {
        const cmds = detectVoiceCommands('next verse')
        expect(cmds.some(c => c.type === 'next_verse')).toBe(true)
    })

    it('"I want to show that God is faithful" should NOT trigger a display command', () => {
        const cmds = detectVoiceCommands('I want to show that God is faithful')
        expect(cmds.some(c => c.type === 'display')).toBe(false)
    })

    it('"put that up" (bare pronoun command) is a known gap after the "that" fix — documents the trade-off', () => {
        // Removing "that" from the display pronoun set to kill the "show
        // that <clause>" false positive also loses this narrower terse form.
        // Acceptable per the product's stated preference: better to miss
        // than to misfire on ordinary preaching language.
        const cmds = detectVoiceCommands('put that up')
        expect(cmds.some(c => c.type === 'display')).toBe(false)
    })

    // -----------------------------------------------------------------------
    // A specific verse mention must win over a same-utterance chapter-only
    // default (real-world regression: live testing showed a momentary wrong
    // verse before the semantic layer self-corrected).
    // -----------------------------------------------------------------------
    it('a bare go_to_reference (defaults to verse 1) does not survive alongside a more specific verse command', () => {
        const cmds = detectVoiceCommands('First of all, 2 Corinthians chapter 4 verse 4.')
        const references = cmds.filter(c => c.type === 'go_to_reference')
        // Every surviving go_to_reference for this utterance must carry the
        // actual spoken verse (4), never the bare-chapter default of 1.
        for (const ref of references) {
            expect(ref.verse).toBe(4)
        }
        expect(cmds.some(c => c.type === 'go_to_verse' && c.targetVerse === 4)).toBe(true)
    })

    it('a bare chapter-only reference still fires normally when no verse is mentioned', () => {
        const cmds = detectVoiceCommands('Turn to Psalm 23')
        const ref = cmds.find(c => c.type === 'go_to_reference')
        expect(ref?.verse).toBe(1)
    })

    // -----------------------------------------------------------------------
    // Real-world regression: live testing showed "2nd Corinthians chapter 4
    // verse 4" get displayed as "2 Corinthians 4:1" moments after the correct
    // 4:4 was shown. Root cause: stripCommandsFromTranscript stripped the
    // shorter overlapping go_to_verse raw ("verse 4") before the longer
    // go_to_reference raw ("2nd Corinthians chapter 4 verse 4"), which ate
    // only the tail of the phrase and left "2nd Corinthians chapter 4"
    // behind — a bare chapter reference the regex verse detector then
    // misread as verse 1 on every subsequent pass over the accumulated
    // transcript.
    // -----------------------------------------------------------------------
    it('stripCommandsFromTranscript removes the full reference, not just a truncated remainder, when a shorter command raw is a substring of a longer one', () => {
        const text = 'First of all, 2nd Corinthians chapter 4 verse 4'
        const cmds = detectVoiceCommands(text)
        const cleaned = stripCommandsFromTranscript(text, cmds)
        expect(cleaned).not.toContain('chapter 4')
        expect(cleaned).not.toContain('Corinthians')
    })

    // -----------------------------------------------------------------------
    // Real-transcript regression: "Romans 10, 17 said, So then faith cometh"
    // was matched as a bare go_to_reference defaulting to verse 1 — the
    // comma between the chapter and verse numbers ("10, 17") wasn't accepted
    // by the loose book+chapter+verse regex (which only allowed a bare
    // space), so the verse got silently dropped instead of read as 17.
    // -----------------------------------------------------------------------
    it('"Book N, V" (comma between chapter and verse) captures the actual verse, not a default of 1', () => {
        const cmds = detectVoiceCommands('Romans 10, 17 said, So then faith cometh, this kind of faith.')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Romans')
        expect(ref?.chapter).toBe(10)
        expect(ref?.verse).toBe(17)
    })

    // -----------------------------------------------------------------------
    // Real-transcript regression: "Then in Ephesians 6 chapter verse 10
    // through 17" (and the "the 6th chapter" ordinal variant) were not
    // recognized as a full book+chapter+verse reference at all — this
    // file's own book+chapter+verse regexes only accepted "chapter" BEFORE
    // the number ("chapter 6"), never after it ("6 chapter" / "the 6th
    // chapter"). That left only a bare go_to_verse("verse 10") as the
    // detected command; stripping just that fragment out of the transcript
    // left "Ephesians 6 chapter through 17" behind, which the main regex
    // verse detector then misread as a bare chapter reference (defaulting
    // to verse 1) instead of the actual 6:10-17 range.
    // -----------------------------------------------------------------------
    it('"Book N chapter verse V through W" (chapter keyword after the number) resolves the full reference', () => {
        const cmds = detectVoiceCommands('Then in Ephesians 6 chapter verse 10 through 17.')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Ephesians')
        expect(ref?.chapter).toBe(6)
        expect(ref?.verse).toBe(10)
    })

    it('"Book the Nth chapter verse V through W" (digit-ordinal chapter, keyword after the number) resolves the full reference', () => {
        const cmds = detectVoiceCommands('Then in Ephesians the 6th chapter verse 10 through 17')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Ephesians')
        expect(ref?.chapter).toBe(6)
        expect(ref?.verse).toBe(10)
    })

    it('stripCommandsFromTranscript removes the full "Book N chapter verse V through W" reference, not a truncated remainder', () => {
        const text = 'Then in Ephesians 6 chapter verse 10 through 17.'
        const cmds = detectVoiceCommands(text)
        const cleaned = stripCommandsFromTranscript(text, cmds)
        expect(cleaned).not.toContain('chapter')
        expect(cleaned).not.toContain('Ephesians')
    })

    // -----------------------------------------------------------------------
    // Chapters above 100 spoken as a compound phrase ("Psalm hundred and
    // forty seven") used to only capture the word "hundred" and silently
    // drop "and forty seven", firing on the WRONG chapter (Psalms 100
    // instead of 147) rather than failing to match — the exact failure
    // mode the app is designed to avoid ("better to miss than show wrong").
    // -----------------------------------------------------------------------
    it('"Psalm hundred and forty seven" resolves the full compound chapter number, not just "hundred"', () => {
        const cmds = detectVoiceCommands('Psalm hundred and forty seven.')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Psalms')
        expect(ref?.chapter).toBe(147)
        expect(ref?.verse).toBe(1)
    })

    it('"Psalm one hundred and fifty" resolves a leading-ones-word compound chapter number', () => {
        const cmds = detectVoiceCommands('Psalm one hundred and fifty')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Psalms')
        expect(ref?.chapter).toBe(150)
    })

    it('"Psalm hundred and forty seven verse three" keeps the compound chapter AND the explicit verse', () => {
        const cmds = detectVoiceCommands('Psalm hundred and forty seven verse three')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Psalms')
        expect(ref?.chapter).toBe(147)
        expect(ref?.verse).toBe(3)
    })

    it('a compound chapter phrase does not break the "Book N, V" loose comma fallback', () => {
        // Regression guard: extending chapter-number matching to compound
        // phrases must not make the loose "Romans 10, 17" heuristic swallow
        // trailing digits as part of the chapter.
        const cmds = detectVoiceCommands('Romans 10, 17')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Romans')
        expect(ref?.chapter).toBe(10)
        expect(ref?.verse).toBe(17)
    })

    it('a spoken compound chapter number with the "chapter" keyword is not split into chapter+verse by the loose fallback', () => {
        // "Psalm chapter twenty five" is one compound chapter number
        // (Psalm 25), not chapter 20 verse 5 — the loose "two adjacent
        // numbers = chapter+verse" heuristic used to win over the correct
        // chapter-only detection because it doesn't know "twenty" and
        // "five" combine into one number.
        const cmds = detectVoiceCommands('Psalm chapter twenty five')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Psalms')
        expect(ref?.chapter).toBe(25)
        expect(ref?.verse).toBe(1)
    })

    it('"John chapter three sixteen" still splits into chapter 3 verse 16 (not a valid compound number)', () => {
        // Regression guard for the fix above: "three" and "sixteen" can't
        // combine into one number (ones+ones isn't a valid English
        // compound), so this must still split into chapter+verse.
        const cmds = detectVoiceCommands('John chapter three sixteen')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'John')
        expect(ref?.chapter).toBe(3)
        expect(ref?.verse).toBe(16)
    })

    // -----------------------------------------------------------------------
    // "verse" mis-transcribed as "versus" — Whisper very commonly hears a
    // bare spoken "verse" as "versus" (phonetically close). Confirmed
    // repeatedly across real sermon transcripts, where nearly every bare
    // "verse N" follow-up (said in its own utterance, after an earlier
    // utterance already named the book+chapter) was transcribed as
    // "Versus N" and silently produced no command at all — the live slide
    // never advanced past the bare chapter's default verse 1.
    // -----------------------------------------------------------------------
    it('a bare "Versus N" (verse mis-transcribed as versus) still triggers go_to_verse', () => {
        const cmds = detectVoiceCommands('Versus 6')
        const cmd = cmds.find(c => c.type === 'go_to_verse')
        expect(cmd?.targetVerse).toBe(6)
    })

    it('"Book chapter N versus V" resolves the full reference via the versus separator', () => {
        const cmds = detectVoiceCommands('Ephesians chapter three versus fourteen')
        const ref = cmds.find(c => c.type === 'go_to_reference' && c.book === 'Ephesians')
        expect(ref?.chapter).toBe(3)
        expect(ref?.verse).toBe(14)
    })

    // -----------------------------------------------------------------------
    // Multi-word spoken verse numbers ("verse twenty five", "verse forty
    // seven") used to only capture the first word ("twenty" -> 20, "forty"
    // -> 47 became 40), because both the regex capture group and the
    // hand-rolled WRITTEN_NUMBERS map only handled a single word 1-20.
    // -----------------------------------------------------------------------
    it('"verse twenty five" resolves the full compound verse number, not just "twenty"', () => {
        const cmds = detectVoiceCommands('verse twenty five')
        const cmd = cmds.find(c => c.type === 'go_to_verse')
        expect(cmd?.targetVerse).toBe(25)
    })

    it('"verse forty seven" resolves correctly (previously unsupported above "twenty")', () => {
        const cmds = detectVoiceCommands('verse forty seven')
        const cmd = cmds.find(c => c.type === 'go_to_verse')
        expect(cmd?.targetVerse).toBe(47)
    })
})
