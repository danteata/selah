/**
 * Bare verse numbers spoken after a chapter announcement.
 *
 * Real-time ASR splits "Matthew 7 verse 24" into separate utterances, and
 * preachers usually omit "verse" on the second one. One sermon had six of nine
 * chapter announcements never resolve to a verse for exactly this reason — the
 * three that worked were the three containing the literal word "verse".
 */

import { describe, it, expect } from 'vitest'
import { detectVoiceCommands } from '../voiceCommandDetection'

const withChapter = { hasFreshChapterContext: true }
const withoutChapter = { hasFreshChapterContext: false }

function verseJump(text: string, options = withChapter) {
    return detectVoiceCommands(text, options).filter(c => c.type === 'go_to_verse')
}

describe('bare verse after a chapter announcement', () => {
    // Every one of these was observed failing in a live sermon.
    it.each([
        ['24', 24],
        ['15 through 16', 15],
        ['Three through four', 3],
        ['One through three', 1],
        ['7 through 8', 7],
        ['12 through 17', 12],
        ['7', 7],
        ['24.', 24],
        ['15-16', 15],
        ['twelve to seventeen', 12],
    ])('resolves %j to verse %i', (text, expected) => {
        const [cmd] = verseJump(text as string)
        expect(cmd?.targetVerse).toBe(expected)
    })

    it('does nothing without a live chapter context', () => {
        // The same chunk in isolation is just a number — there is no chapter
        // for it to belong to, so it must not move the live slide.
        expect(verseJump('24', withoutChapter)).toEqual([])
        expect(verseJump('15 through 16', withoutChapter)).toEqual([])
    })

    it('requires the whole chunk to be the number', () => {
        // Sermon prose containing a number must never navigate.
        for (const text of [
            '24 people were in the room',
            'about 40 years later',
            'he was 30 when he began',
            'the year 2024 was hard',
            'and then he said',
        ]) {
            expect(verseJump(text)).toEqual([])
        }
    })

    it('rejects a descending range as a mishearing', () => {
        expect(verseJump('16 through 15')).toEqual([])
    })

    it('is medium confidence — a bare number is genuinely ambiguous', () => {
        const [cmd] = verseJump('24')
        expect(cmd?.confidence).toBe('medium')
    })

    it('does not displace an explicit "verse N" in the same chunk', () => {
        // The explicit form is more specific; it should win rather than
        // producing two competing jumps.
        const cmds = verseJump('verse 15')
        expect(cmds).toHaveLength(1)
        expect(cmds[0].targetVerse).toBe(15)
        expect(cmds[0].confidence).toBe('high')
    })

    it('leaves a full reference alone', () => {
        // "Matthew 7" is a chapter reference, not a bare verse.
        const cmds = detectVoiceCommands('Matthew 7', withChapter)
        expect(cmds.some(c => c.type === 'go_to_reference')).toBe(true)
        expect(cmds.filter(c => c.type === 'go_to_verse')).toEqual([])
    })
})
