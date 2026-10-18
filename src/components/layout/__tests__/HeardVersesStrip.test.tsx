import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HeardVerse } from '../../../types'

/**
 * On a phone in a live session, what the desk's sermon listener just heard,
 * each verse a tap from the screen: Live for whoever may put slides up,
 * Suggest for a contributor in review mode, nothing for someone watching.
 */

const h = vi.hoisted(() => ({
    heard: [] as HeardVerse[],
    isConnected: true,
    fetchScripture: vi.fn(),
    createBibleSlide: vi.fn(),
    addAndGoLive: vi.fn(),
    addToQueue: vi.fn(),
    appendActiveSlide: vi.fn(),
}))

vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: (state: unknown) => unknown) => selector({
        sessionHeardVerses: h.heard,
        settings: { defaultBibleVersion: 'KJV' },
        appendActiveSlide: h.appendActiveSlide,
    }),
}))
vi.mock('../../../hooks/useScripture', () => ({ useScripture: () => ({ fetchScripture: h.fetchScripture }) }))
vi.mock('../../../hooks/useSlideCreation', () => ({ useSlideCreation: () => ({ createBibleSlide: h.createBibleSlide }) }))
vi.mock('../../../hooks/useGoLive', () => ({ useGoLive: () => ({ addAndGoLive: h.addAndGoLive }) }))
vi.mock('../../../hooks/useLiveSession', () => ({ useLiveSession: () => ({ isConnected: h.isConnected, addToQueue: h.addToQueue }) }))

const { HeardVersesStrip } = await import('../HeardVersesStrip')

const john: HeardVerse = { reference: 'John 3:16', book: 'John', chapter: 3, verseStart: 16, version: 'NIV', heardAt: Date.now() }
const psalm: HeardVerse = { reference: 'Psalms 23:1', book: 'Psalms', chapter: 23, verseStart: 1, heardAt: Date.now() - 90_000 }

describe('HeardVersesStrip', () => {
    beforeEach(() => {
        h.heard = [john, psalm]
        h.isConnected = true
        for (const fn of [h.fetchScripture, h.createBibleSlide, h.addAndGoLive, h.addToQueue, h.appendActiveSlide]) fn.mockReset()
        h.fetchScripture.mockResolvedValue({ label: 'John 3:16', content: 'For God so loved' })
        h.createBibleSlide.mockReturnValue({ id: 'slide-1' })
    })

    it('shows nothing outside a session, or before anything is heard', () => {
        h.isConnected = false
        const { container, rerender } = render(<HeardVersesStrip canControlLive canSuggest={false} />)
        expect(container).toBeEmptyDOMElement()
        h.isConnected = true
        h.heard = []
        rerender(<HeardVersesStrip canControlLive canSuggest={false} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('lists what was heard, newest first, with when and in which translation', () => {
        render(<HeardVersesStrip canControlLive canSuggest={false} />)
        expect(screen.getByText('John 3:16')).toBeInTheDocument()
        expect(screen.getByText('just now · NIV')).toBeInTheDocument()
        expect(screen.getByText('2m ago')).toBeInTheDocument()
    })

    it('sends a verse live in the translation the listener used', async () => {
        render(<HeardVersesStrip canControlLive canSuggest={false} />)
        fireEvent.click(screen.getByRole('button', { name: 'Go live: John 3:16' }))
        await waitFor(() => expect(h.addAndGoLive).toHaveBeenCalledWith([{ id: 'slide-1' }]))
        expect(h.fetchScripture).toHaveBeenCalledWith('43:3:16', 'NIV')
        expect(h.addToQueue).not.toHaveBeenCalled()
    })

    it('falls back to this device’s translation when the listener didn’t say', async () => {
        render(<HeardVersesStrip canControlLive canSuggest={false} />)
        fireEvent.click(screen.getByRole('button', { name: 'Go live: Psalms 23:1' }))
        await waitFor(() => expect(h.fetchScripture).toHaveBeenCalledWith('19:23:1', 'KJV'))
    })

    it('suggests instead, for a contributor whose suggestions are reviewed', async () => {
        render(<HeardVersesStrip canControlLive={false} canSuggest />)
        fireEvent.click(screen.getByRole('button', { name: 'Suggest: John 3:16' }))
        await waitFor(() => expect(h.addToQueue).toHaveBeenCalledWith(['slide-1']))
        expect(h.appendActiveSlide).toHaveBeenCalledWith({ id: 'slide-1' })
        expect(h.addAndGoLive).not.toHaveBeenCalled()
    })

    it('offers someone watching no button', () => {
        render(<HeardVersesStrip canControlLive={false} canSuggest={false} />)
        expect(screen.getByText('John 3:16')).toBeInTheDocument()
        expect(screen.queryByRole('button')).toBeNull()
    })
})
