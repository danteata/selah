import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Slide } from '../../types'

const session = vi.hoisted(() => ({
    current: {
        isConnected: true,
        isOperator: false,
        isOpen: true,
        isStrict: false,
        setLiveSlide: vi.fn(async () => {}),
        addToQueue: vi.fn(async () => {}),
    },
}))
vi.mock('../useLiveSession', () => ({ useLiveSession: () => session.current }))
const phone = vi.hoisted(() => ({ value: false }))
vi.mock('../useIsMobile', () => ({ isMobileViewport: () => phone.value }))

import { useAppStore } from '../../store/appStore'
import { useGoLive } from '../useGoLive'

const song = ['v1', 'c1', 'v2'].map((id) => ({ id, type: 'song', songId: 'way', contents: [] }) as unknown as Slide)

describe('useGoLive', () => {
    beforeEach(() => {
        session.current = { ...session.current, isConnected: true, isOperator: false, isOpen: true, isStrict: false }
        session.current.setLiveSlide.mockClear()
        session.current.addToQueue.mockClear()
        phone.value = false
        useAppStore.setState({ activeSlides: [], liveOutputSlidesId: [], activeNavSection: 'music' })
    })

    it("sends a contributor's whole song to the session, not only the slide going live", () => {
        // Only the live slide reached the server: the rest of the song, and
        // its place in the deck, stayed on this phone and went at a reload.
        const { result } = renderHook(() => useGoLive())
        act(() => { result.current.addAndGoLive(song) })
        expect(session.current.setLiveSlide).toHaveBeenCalledWith('v1')
        expect(session.current.addToQueue).toHaveBeenCalledWith(['v1', 'c1', 'v2'])
    })

    it("leaves the operator's own deck to its sync", () => {
        session.current.isOperator = true
        const { result } = renderHook(() => useGoLive())
        act(() => { result.current.addAndGoLive(song) })
        expect(session.current.addToQueue).not.toHaveBeenCalled()
    })

    it("suggests what a contributor adds, but not in a strict session", () => {
        const { result, rerender } = renderHook(() => useGoLive())
        act(() => result.current.addToQueue(song))
        expect(session.current.addToQueue).toHaveBeenCalledWith(['v1', 'c1', 'v2'])

        session.current.addToQueue.mockClear()
        session.current.isStrict = true
        rerender()
        act(() => result.current.addToQueue([{ ...song[0], id: 'other' }]))
        expect(session.current.addToQueue).not.toHaveBeenCalled()
    })

    it('goes back to the live view on a phone', () => {
        phone.value = true
        const { result } = renderHook(() => useGoLive())
        act(() => { result.current.addAndGoLive(song) })
        expect(useAppStore.getState().activeNavSection).toBeNull()
    })
})
