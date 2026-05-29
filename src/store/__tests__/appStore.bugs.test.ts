/**
 * AGGRESSIVE BUG-FINDING TESTS for appStore
 *
 * These tests target undo/redo, state consistency, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAppStore } from '../appStore'
import type { Slide } from '../../types'

describe('appStore — BUG HUNTING', () => {
    beforeEach(() => {
        useAppStore.getState().signOut()
    })

    // -----------------------------------------------------------------------
    // BUG 3: Undo/redo nests full state objects causing memory leaks
    // -----------------------------------------------------------------------
    it('[BUG 3] futureStates should not contain nested pastStates/futureStates', () => {
        const store = useAppStore.getState()
        const slide: Slide = {
            id: 's1', index: 0, name: 'A', type: 'text',
            layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [],
        }

        act(() => store.appendActiveSlide(slide))
        act(() => store.undo())

        const state = useAppStore.getState()
        // After undo, futureStates[0] should be a minimal snapshot, not a full state object
        const futureSnapshot = state.futureStates[0]

        // The snapshot should NOT contain nested pastStates / futureStates
        // (it currently does because the entire state object is pushed)
        expect((futureSnapshot as any).pastStates).toBeUndefined()
        expect((futureSnapshot as any).futureStates).toBeUndefined()
    })

    // -----------------------------------------------------------------------
    // BUG 4: liveOutputSlidesId is not restored on undo
    // -----------------------------------------------------------------------
    it('[BUG 4] undo should restore liveOutputSlidesId to its past value', () => {
        const store = useAppStore.getState()
        const s1: Slide = { id: 's1', index: 0, name: 'A', type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [] }
        const s2: Slide = { id: 's2', index: 1, name: 'B', type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [] }

        act(() => {
            store.appendActiveSlide(s1)
            store.setLiveOutputSlidesId(['s1'])
        })

        const beforeLiveOutput = useAppStore.getState().liveOutputSlidesId
        expect(beforeLiveOutput).toEqual(['s1'])

        act(() => {
            store.appendActiveSlide(s2)
            store.setLiveOutputSlidesId(['s1', 's2'])
        })

        act(() => store.undo())

        const afterUndo = useAppStore.getState()
        // EXPECTED: liveOutputSlidesId should be ['s1'] (the value before adding s2)
        // ACTUAL: liveOutputSlidesId stays at ['s1', 's2'] (current value)
        expect(afterUndo.liveOutputSlidesId).toEqual(['s1'])
    })

    // -----------------------------------------------------------------------
    // BUG: Multiple undo/redo cycles should not corrupt state
    // -----------------------------------------------------------------------
    it('[BUG] should survive 5 undo/redo cycles without corruption', () => {
        const store = useAppStore.getState()
        const s1: Slide = { id: 's1', index: 0, name: 'A', type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [] }

        act(() => store.appendActiveSlide(s1))

        for (let i = 0; i < 5; i++) {
            act(() => store.undo())
            act(() => store.redo())
        }

        const state = useAppStore.getState()
        expect(state.activeSlides).toHaveLength(1)
        expect(state.activeSlides[0].id).toBe('s1')
    })

    // -----------------------------------------------------------------------
    // BUG: undo with empty pastStates should be a no-op
    // -----------------------------------------------------------------------
    it('[BUG] undo on empty pastStates should not corrupt futureStates', () => {
        const store = useAppStore.getState()

        act(() => store.undo())

        const state = useAppStore.getState()
        expect(state.futureStates).toHaveLength(0)
        expect(state.pastStates).toHaveLength(0)
    })
})
