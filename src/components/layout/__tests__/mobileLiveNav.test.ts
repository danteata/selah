import { describe, it, expect } from 'vitest'
import { liveNavigation, songPartsAround } from '../mobileLiveNav'
import type { Slide } from '../../../types'

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, type: 'bible', ...extra }) as Slide
const part = (id: string, verseLabel: string, songId = 'way') => slide(id, { type: 'song', songId, verseLabel })

const ruth = slide('ruth')
const cor = slide('cor')
const song = [part('v1', 'Verse 1'), part('c1', 'Chorus 1'), part('v2', 'Verse 2'), part('c2', 'Chorus 2')]
const ids = (slides: Slide[]) => slides.map((s) => s.id)

describe('songPartsAround', () => {
    it("is the run of the live song's slides, not another song's or a second copy's", () => {
        const other = part('x1', 'Verse 1', 'other')
        const again = part('w1', 'Verse 1')
        expect(ids(songPartsAround([cor, ...song, other, ruth, again], 'c1'))).toEqual(['v1', 'c1', 'v2', 'c2'])
        expect(songPartsAround([cor, ...song], 'cor')).toEqual([])
    })
})

describe('liveNavigation', () => {
    it('steps through the deck when no song is live', () => {
        const nav = liveNavigation([cor, ruth], [cor, ruth], 'cor')
        expect(nav.prevSlide).toBeNull()
        expect(ids(nav.following)).toEqual(['ruth'])
        expect(nav.place).toBe('1 of 2')
    })

    it("steps through a live song that isn't in the deck, before the deck", () => {
        // The phone's deck is the operator's; a song put up some other way
        // isn't in it. It used to show the start of the deck as "up next".
        const nav = liveNavigation([cor, ruth], [cor, ruth, ...song], 'c1')
        expect(nav.prevSlide?.id).toBe('v1')
        expect(ids(nav.following)).toEqual(['v2', 'c2', 'cor', 'ruth'])
        expect(nav.place).toBe('2 of 4')
    })

    it('carries on with the deck after the song, and back before it', () => {
        const deck = [cor, ...song, ruth]
        expect(ids(liveNavigation(deck, deck, 'c2').following)).toEqual(['ruth'])
        expect(liveNavigation(deck, deck, 'v1').prevSlide?.id).toBe('cor')
    })

    it("follows the song's own order when the deck holds only part of it", () => {
        const deck = [cor, song[0], ruth]
        const nav = liveNavigation(deck, [cor, ...song, ruth], 'v1')
        expect(ids(nav.following)).toEqual(['c1', 'v2', 'c2', 'ruth'])
    })
})
