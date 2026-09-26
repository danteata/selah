/**
 * The operator's curated live deck (`liveOutputSlidesId`) through edits and
 * undo. Several edits used to rebuild the deck from every active slide, and
 * undo snapshots carried only the slides, so the deck drifted from what the
 * operator had arranged.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from '../appStore'
import type { Slide } from '../../types'

function slide(id: string, scheduleId = 'sched'): Slide {
    return { id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId, contents: [] }
}

function seed(ids: string[], deck: string[]) {
    useAppStore.setState({
        activeSlides: ids.map((id) => slide(id)),
        liveOutputSlidesId: deck,
        pastStates: [],
        futureStates: [],
    })
}

describe('live deck', () => {
    beforeEach(() => {
        useAppStore.getState().signOut()
    })

    it('removing a slide leaves slides the operator left out of the deck out', () => {
        seed(['a', 'b', 'c'], ['c', 'a']) // b deliberately not in the deck

        act(() => useAppStore.getState().removeActiveSlide(slide('a')))

        expect(useAppStore.getState().liveOutputSlidesId).toEqual(['c'])
    })

    it('undoing a removal puts the slide back in the deck too', () => {
        seed(['a', 'b', 'c'], ['c', 'a'])

        act(() => useAppStore.getState().removeActiveSlide(slide('a')))
        act(() => useAppStore.getState().undo())

        const state = useAppStore.getState()
        expect(state.activeSlides.map((s) => s.id)).toEqual(['a', 'b', 'c'])
        expect(state.liveOutputSlidesId).toEqual(['c', 'a'])
    })

    it('reordering keeps the deck to its members', () => {
        seed(['a', 'b', 'c'], ['a', 'c'])

        act(() => useAppStore.getState().reorderActiveSlides(2, 0)) // c to the front

        expect(useAppStore.getState().activeSlides.map((s) => s.id)).toEqual(['c', 'a', 'b'])
        expect(useAppStore.getState().liveOutputSlidesId).toEqual(['c', 'a'])
    })

    it('caps the undo history', () => {
        seed([], [])
        for (let i = 0; i < 150; i++) {
            act(() => useAppStore.getState().appendActiveSlide(slide(`s${i}`)))
        }
        expect(useAppStore.getState().pastStates.length).toBe(100)
    })

    it("drops history when a collaborator's slides arrive, so undo can't delete them", () => {
        seed(['a'], ['a'])
        act(() => useAppStore.getState().appendActiveSlide(slide('b')))
        expect(useAppStore.getState().pastStates.length).toBe(1)

        act(() => useAppStore.getState().replaceSlidesForSchedule('sched', [slide('a'), slide('b'), slide('remote')]))

        expect(useAppStore.getState().pastStates).toEqual([])
    })

    it('keeps history for the echo of our own edits', () => {
        seed(['a'], ['a'])
        act(() => useAppStore.getState().appendActiveSlide(slide('b')))

        act(() => useAppStore.getState().replaceSlidesForSchedule('sched', [slide('a'), slide('b')]))

        expect(useAppStore.getState().pastStates.length).toBe(1)
    })
})
