import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSendToAlternate } from '../useSendToAlternate'
import { useAppStore } from '../../store/appStore'
import { DEFAULT_ALTERNATE_OUTPUT } from '../../types/alternateOutput'
import type { Slide } from '../../types'

const slide = (id: string): Slide => ({ id, type: 'text', contents: ['<p>x</p>'] } as unknown as Slide)

describe('useSendToAlternate', () => {
    beforeEach(() => {
        useAppStore.setState({
            alternateOutput: { ...DEFAULT_ALTERNATE_OUTPUT, contentSource: 'independent' },
            alternateSlide: null,
        })
    })

    it('is unavailable while the output follows the main one', () => {
        // Nothing to choose then — the buttons hide rather than silently doing
        // nothing when pressed.
        useAppStore.setState({ alternateOutput: { ...DEFAULT_ALTERNATE_OUTPUT, contentSource: 'follow' } })
        const { result } = renderHook(() => useSendToAlternate())
        expect(result.current.canSend).toBe(false)
    })

    it('puts a slide on the output', () => {
        const { result } = renderHook(() => useSendToAlternate())
        expect(result.current.canSend).toBe(true)

        act(() => result.current.send(slide('a')))
        expect(useAppStore.getState().alternateSlide?.id).toBe('a')
        expect(result.current.isOnAlternate('a')).toBe(true)
        expect(result.current.isOnAlternate('b')).toBe(false)
    })

    it('replaces whatever was showing', () => {
        const { result } = renderHook(() => useSendToAlternate())
        act(() => result.current.send(slide('a')))
        act(() => result.current.send(slide('b')))
        expect(useAppStore.getState().alternateSlide?.id).toBe('b')
    })

    it('clears the output when the slide already showing is sent again', () => {
        // Same button shows and hides, so an operator can take a graphic off
        // without hunting for a separate control.
        const { result } = renderHook(() => useSendToAlternate())
        act(() => result.current.send(slide('a')))
        act(() => result.current.send(slide('a')))
        expect(useAppStore.getState().alternateSlide).toBeNull()
    })

    it('treats a missing id as not showing', () => {
        const { result } = renderHook(() => useSendToAlternate())
        expect(result.current.isOnAlternate(null)).toBe(false)
        expect(result.current.isOnAlternate(undefined)).toBe(false)
    })
})
