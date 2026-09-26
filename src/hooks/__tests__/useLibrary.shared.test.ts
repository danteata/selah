import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLibrary } from '../useLibrary'
import type { Slide } from '../../types'

const slide: Slide = { id: 's', index: 0, name: 'Psalm 23', type: 'bible', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: ['The Lord is my shepherd'] }

describe('useLibrary', () => {
    it('is one library for every component that shows it', () => {
        // The preview saves; the library panel removes something else. Each
        // used to keep its own copy, so the panel's write erased the save.
        const preview = renderHook(() => useLibrary())
        const panel = renderHook(() => useLibrary())
        act(() => { panel.result.current.clearLibrary() })

        let saved = preview.result.current.librarySlides[0]
        act(() => { saved = preview.result.current.addToLibrary(slide) })
        act(() => { panel.result.current.addToLibrary({ ...slide, name: 'John 3:16' }) })

        expect(preview.result.current.librarySlides.map((s) => s.name)).toEqual(['Psalm 23', 'John 3:16'])
        act(() => { panel.result.current.removeFromLibrary(saved.id) })
        expect(preview.result.current.librarySlides.map((s) => s.name)).toEqual(['John 3:16'])
    })
})
