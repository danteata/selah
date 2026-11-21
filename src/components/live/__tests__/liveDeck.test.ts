import { describe, it, expect } from 'vitest'
import type { Slide } from '../../../types'
import { liveDeckFor, deckPosition } from '../liveDeck'

function slide(id: string, scheduleId?: string): Slide {
    return { id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId, contents: [] } as Slide
}

describe('liveDeckFor', () => {
    const slides = [slide('a', 's1'), slide('b', 's2'), slide('c', ''), slide('d')]

    it('follows the deck order, not the order of the slides', () => {
        expect(liveDeckFor(['d', 'a', 'c'], slides, 's1').map((s) => s.id)).toEqual(['d', 'a', 'c'])
    })

    it("keeps the schedule's slides and the unscheduled ones", () => {
        expect(liveDeckFor(['a', 'b', 'c', 'd'], slides, 's1').map((s) => s.id)).toEqual(['a', 'c', 'd'])
    })

    it('with no schedule, keeps only the unscheduled slides', () => {
        expect(liveDeckFor(['a', 'b', 'c', 'd'], slides, null).map((s) => s.id)).toEqual(['c', 'd'])
    })

    it('drops ids that name no slide, and is empty with no deck', () => {
        expect(liveDeckFor(['gone', 'c'], slides, null).map((s) => s.id)).toEqual(['c'])
        expect(liveDeckFor(null, slides, 's1')).toEqual([])
    })
})

describe('deckPosition', () => {
    const deck = [slide('a'), slide('b'), slide('c')]

    it('gives the slides either side of the one on air', () => {
        const p = deckPosition(deck, 'b')
        expect(p.index).toBe(1)
        expect(p.previous?.id).toBe('a')
        expect(p.nextUp?.id).toBe('c')
    })

    it('has nothing next up after the last slide, and nothing before the first', () => {
        expect(deckPosition(deck, 'c').nextUp).toBeUndefined()
        expect(deckPosition(deck, 'a').previous).toBeUndefined()
    })

    it('with nothing on air, or on air outside the deck, next up is the first slide', () => {
        for (const live of [null, 'elsewhere']) {
            const p = deckPosition(deck, live)
            expect(p.index).toBe(-1)
            expect(p.previous).toBeUndefined()
            expect(p.nextUp?.id).toBe('a')
        }
    })
})
