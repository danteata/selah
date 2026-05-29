import { describe, it, expect } from 'vitest'
import {
    detectVoiceCommands,
    stripCommandsFromTranscript,
    getVersionDisplayName,
    type VoiceCommand,
} from '../voiceCommandDetection'

describe('voiceCommandDetection', () => {
    // -----------------------------------------------------------------------
    // detectVoiceCommands — version changes
    // -----------------------------------------------------------------------
    describe('version change commands', () => {
        it('detects "switch to NIV"', () => {
            const cmds = detectVoiceCommands('switch to NIV')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('change_version')
            expect(cmds[0].versionId).toBe('NIV')
            expect(cmds[0].confidence).toBe('high')
        })

        it('detects "use the King James Version"', () => {
            const cmds = detectVoiceCommands('use the King James Version')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('change_version')
            expect(cmds[0].versionId).toBe('KJV')
        })

        it('detects standalone "NKJV"', () => {
            const cmds = detectVoiceCommands('read from NKJV')
            expect(cmds.some(c => c.type === 'change_version' && c.versionId === 'NKJV')).toBe(true)
        })

        it('detects "new living translation" alias', () => {
            const cmds = detectVoiceCommands('switch to new living translation')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].versionId).toBe('NLT')
        })

        it('keeps the LAST explicit version mention in one utterance', () => {
            const cmds = detectVoiceCommands('first read KJV then switch to NIV')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].versionId).toBe('NIV')
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — navigation
    // -----------------------------------------------------------------------
    describe('navigation commands', () => {
        it('detects "next verse"', () => {
            const cmds = detectVoiceCommands('next verse')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('next_verse')
            expect(cmds[0].offset).toBe(1)
        })

        it('detects "previous verse"', () => {
            const cmds = detectVoiceCommands('previous verse')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('previous_verse')
            expect(cmds[0].offset).toBe(-1)
        })

        it('detects "next chapter" (takes priority over next verse)', () => {
            const cmds = detectVoiceCommands('next chapter')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('next_chapter')
        })

        it('detects "previous chapter"', () => {
            const cmds = detectVoiceCommands('previous chapter')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('previous_chapter')
        })

        it('detects "display this verse"', () => {
            const cmds = detectVoiceCommands('display this verse')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('display')
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — go to verse
    // -----------------------------------------------------------------------
    describe('go to verse commands', () => {
        it('detects "verse 15"', () => {
            const cmds = detectVoiceCommands('verse 15')
            expect(cmds.some(c => c.type === 'go_to_verse' && c.targetVerse === 15)).toBe(true)
        })

        it('detects "go to verse three"', () => {
            const cmds = detectVoiceCommands('go to verse three')
            expect(cmds.some(c => c.type === 'go_to_verse' && c.targetVerse === 3)).toBe(true)
        })

        it('keeps the last verse mention', () => {
            const cmds = detectVoiceCommands('verse 5 and then verse 10')
            const goTo = cmds.filter(c => c.type === 'go_to_verse')
            expect(goTo[goTo.length - 1].targetVerse).toBe(10)
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — go to reference
    // -----------------------------------------------------------------------
    describe('go to reference commands', () => {
        it('detects "Psalm 23" without action verb', () => {
            const cmds = detectVoiceCommands('Psalm 23')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('go_to_reference')
            expect(cmds[0].book).toBe('Psalms')
            expect(cmds[0].chapter).toBe(23)
            expect(cmds[0].verse).toBe(1)
            expect(cmds[0].confidence).toBe('medium')
        })

        it('detects "go to Matthew 5" with action verb', () => {
            const cmds = detectVoiceCommands('go to Matthew 5')
            expect(cmds.some(c =>
                c.type === 'go_to_reference' &&
                c.book === 'Matthew' &&
                c.chapter === 5
            )).toBe(true)
        })

        it('detects spoken chapter numbers: "John chapter six"', () => {
            const cmds = detectVoiceCommands('John chapter six')
            expect(cmds.some(c =>
                c.type === 'go_to_reference' &&
                c.book === 'John' &&
                c.chapter === 6
            )).toBe(true)
        })

        it('does not match "John 3:16" as a reference command (has verse)', () => {
            const cmds = detectVoiceCommands('John 3:16')
            // Should not produce a go_to_reference (verse notation is handled by verseDetection)
            const refs = cmds.filter(c => c.type === 'go_to_reference')
            expect(refs.length).toBe(0)
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — control commands
    // -----------------------------------------------------------------------
    describe('control commands', () => {
        it('detects "stop listening"', () => {
            const cmds = detectVoiceCommands('stop listening')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('stop_listening')
        })

        it('detects "start listening"', () => {
            const cmds = detectVoiceCommands('start listening')
            expect(cmds).toHaveLength(1)
            expect(cmds[0].type).toBe('start_listening')
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — deduplication
    // -----------------------------------------------------------------------
    describe('deduplication', () => {
        it('deduplicates identical commands', () => {
            const cmds = detectVoiceCommands('next verse next verse')
            const nextVerses = cmds.filter(c => c.type === 'next_verse')
            expect(nextVerses).toHaveLength(1)
        })

        it('deduplicates identical version commands', () => {
            const cmds = detectVoiceCommands('use NIV and NIV')
            const changes = cmds.filter(c => c.type === 'change_version')
            expect(changes).toHaveLength(1)
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — false positives / no intent
    // -----------------------------------------------------------------------
    describe('no command intent', () => {
        it('returns empty for regular sermon text', () => {
            const cmds = detectVoiceCommands('For God so loved the world')
            expect(cmds).toHaveLength(0)
        })

        it('returns empty for short text', () => {
            const cmds = detectVoiceCommands('ok')
            expect(cmds).toHaveLength(0)
        })

        it('returns empty for empty string', () => {
            const cmds = detectVoiceCommands('')
            expect(cmds).toHaveLength(0)
        })

        it('returns empty for text with no command keywords', () => {
            const cmds = detectVoiceCommands('the grace of our lord jesus christ')
            expect(cmds).toHaveLength(0)
        })
    })

    // -----------------------------------------------------------------------
    // detectVoiceCommands — complex utterances
    // -----------------------------------------------------------------------
    describe('complex utterances', () => {
        it('handles multiple command types in one utterance', () => {
            const cmds = detectVoiceCommands('switch to NIV and next verse')
            expect(cmds).toHaveLength(2)
            expect(cmds.some(c => c.type === 'change_version')).toBe(true)
            expect(cmds.some(c => c.type === 'next_verse')).toBe(true)
        })
    })

    // -----------------------------------------------------------------------
    // stripCommandsFromTranscript
    // -----------------------------------------------------------------------
    describe('stripCommandsFromTranscript', () => {
        it('removes a simple command from text', () => {
            const cmds: VoiceCommand[] = [{
                type: 'next_verse',
                raw: 'next verse',
                confidence: 'high',
                offset: 1,
            }]
            const cleaned = stripCommandsFromTranscript('next verse', cmds)
            expect(cleaned).toBe('')
        })

        it('removes multiple commands from text', () => {
            const cmds: VoiceCommand[] = [
                { type: 'change_version', raw: 'switch to NIV', confidence: 'high', versionId: 'NIV' },
                { type: 'next_verse', raw: 'next verse', confidence: 'high', offset: 1 },
            ]
            const cleaned = stripCommandsFromTranscript('switch to NIV and next verse', cmds)
            expect(cleaned).toBe('and')
        })

        it('preserves text when no commands', () => {
            const cleaned = stripCommandsFromTranscript('For God so loved', [])
            expect(cleaned).toBe('For God so loved')
        })

        it('handles commands with regex special chars safely', () => {
            const cmds: VoiceCommand[] = [{
                type: 'go_to_verse',
                raw: 'verse 5.',
                confidence: 'high',
                targetVerse: 5,
            }]
            const cleaned = stripCommandsFromTranscript('verse 5. hello', cmds)
            expect(cleaned).toBe('hello')
        })
    })

    // -----------------------------------------------------------------------
    // getVersionDisplayName
    // -----------------------------------------------------------------------
    describe('getVersionDisplayName', () => {
        it('returns display name for known version', () => {
            expect(getVersionDisplayName('NIV')).toBe('New International Version')
        })

        it('returns the input for unknown version', () => {
            expect(getVersionDisplayName('XYZ')).toBe('XYZ')
        })
    })
})
