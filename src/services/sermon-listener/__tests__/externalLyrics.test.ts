import { describe, it, expect } from 'vitest'
import { buildSongFromLyrics } from '../externalLyrics'

describe('buildSongFromLyrics', () => {
    it('structures fetched lyrics into a Song with sections + arrangement', () => {
        const lyrics = [
            'Verse 1',
            'Amazing grace how sweet the sound',
            'That saved a wretch like me',
            '',
            'Chorus',
            'My chains are gone',
            'I have been set free',
        ].join('\n')

        const song = buildSongFromLyrics('Amazing Grace', 'Chris Tomlin', lyrics, 'ext_1', '2026-07-08T00:00:00Z')
        expect(song).not.toBeNull()
        expect(song!.title).toBe('Amazing Grace')
        expect(song!.artist).toBe('Chris Tomlin')
        expect(song!.sections?.map((s) => s.id)).toEqual(['v1', 'c1'])
        expect(song!.defaultArrangement).toEqual(['v1', 'c1'])
        expect(song!.id).toBe('ext_1')
        // verses/lyrics are reconstructed and consistent with sections
        expect(song!.verses).toHaveLength(2)
        expect(song!.lyrics).toContain('Amazing grace how sweet the sound')
    })

    it('falls back to sensible title/artist defaults', () => {
        const song = buildSongFromLyrics('', '', 'line one here\nline two here', 'ext_2', 't')
        expect(song?.title).toBe('Untitled')
        expect(song?.artist).toBe('Unknown')
    })

    it('returns null for empty lyrics', () => {
        expect(buildSongFromLyrics('X', 'Y', '   \n  ', 'ext_3', 't')).toBeNull()
    })
})
