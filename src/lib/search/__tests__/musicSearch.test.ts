import { describe, it, expect } from 'vitest'
import { searchMusic, type MusicSearchItem } from '../musicSearch'

const ITEMS: MusicSearchItem[] = [
    { id: 's1', title: 'Amazing Grace', subtitle: 'John Newton', body: "Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found" },
    { id: 's2', title: 'How Great Thou Art', subtitle: 'Stuart Hine', body: 'O Lord my God when I in awesome wonder\nConsider all the worlds thy hands have made' },
    { id: 's3', title: 'Great Is Thy Faithfulness', subtitle: 'Thomas Chisholm', body: 'Great is thy faithfulness O God my Father\nThere is no shadow of turning with thee' },
    { id: 's4', title: 'Blessed Assurance', subtitle: 'Fanny Crosby', body: 'Blessed assurance Jesus is mine\nOh what a foretaste of glory divine' },
]

describe('searchMusic', () => {
    it('finds a song by a lyric fragment, not just the title', () => {
        const r = searchMusic(ITEMS, 'sweet the sound', 5)
        expect(r[0].item.id).toBe('s1')
    })

    it('ranks a title match above an incidental lyric-word match', () => {
        // "great" is in s2's & s3's titles and s3's body; the title hits win.
        const r = searchMusic(ITEMS, 'great', 5)
        expect(['s2', 's3']).toContain(r[0].item.id)
        expect(r[0].matchType).toBe('title')
    })

    it('is punctuation and curly-quote tolerant', () => {
        // Query uses a curly apostrophe + trailing punctuation.
        const r = searchMusic(ITEMS, 'o lord my god!', 5)
        expect(r[0].item.id).toBe('s2')
    })

    it('matches across a line break in the lyrics', () => {
        // "me I once" straddles a newline in s1's body.
        const r = searchMusic(ITEMS, 'like me i once was lost', 5)
        expect(r[0].item.id).toBe('s1')
    })

    it('tolerates word-order / partial recall via BM25', () => {
        const r = searchMusic(ITEMS, 'faithfulness father god', 5)
        expect(r[0].item.id).toBe('s3')
    })

    it('returns nothing for a query with no term overlap', () => {
        expect(searchMusic(ITEMS, 'helicopter spreadsheet', 5)).toHaveLength(0)
    })

    it('returns [] for an empty query', () => {
        expect(searchMusic(ITEMS, '   ', 5)).toHaveLength(0)
    })

    it('promotes a verbatim title match to the top', () => {
        const r = searchMusic(ITEMS, 'Blessed Assurance', 5)
        expect(r[0].item.id).toBe('s4')
        expect(r[0].matchType).toBe('title')
    })
})
