import { describe, it, expect } from 'vitest'
import { searchMusicIndex } from '../musicSearch'
import { hymnIndexFor, songIndexFor, unifiedMusicIndexFor } from '../musicLibraryIndex'
import type { Hymn, Song } from '../../../types'

const songs = [{ _id: 's1', id: 's1', title: 'Cornerstone', artist: 'Hillsong', lyrics: 'my hope is built on nothing less' }] as Song[]
const hymns = [{ number: '12', title: 'Amazing Grace', author: 'Newton', verses: ['how sweet the sound'] }] as Hymn[]

describe('music library indexes', () => {
    it('builds once for the same lists, and again when a list changes', () => {
        const first = unifiedMusicIndexFor(songs, hymns)
        expect(unifiedMusicIndexFor(songs, hymns)).toBe(first)
        expect(unifiedMusicIndexFor([...songs], hymns)).not.toBe(first)
        expect(songIndexFor(songs)).toBe(songIndexFor(songs))
        expect(hymnIndexFor(hymns)).toBe(hymnIndexFor(hymns))
    })

    it('finds songs and hymns together, resolving each hit to its record', () => {
        const { index, byId } = unifiedMusicIndexFor(songs, hymns)
        const hits = (q: string) => searchMusicIndex(index, q, 10).map((r) => byId.get(r.item.id))
        expect(hits('sweet the sound')[0]).toMatchObject({ kind: 'hymn', hymn: hymns[0] })
        expect(hits('hope is built')[0]).toMatchObject({ kind: 'song', song: songs[0] })
    })

    it('finds a hymn by its number', () => {
        expect(searchMusicIndex(hymnIndexFor(hymns), '12', 5)[0]?.item.id).toBe('12')
    })
})
