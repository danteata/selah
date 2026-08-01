import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SermonListenerSettings } from '../SermonListenerSettings'

// Deliberately NOT mocking the store. A hand-rolled state object has to be
// extended by hand every time the component reads a new slice, and it silently
// rots into `undefined` reads when nobody remembers — this test broke on
// `state.songTracking.autoDetect` for exactly that reason. The real store is a
// plain Zustand store with defaults for everything the component reads, so
// using it directly cannot drift out of date.

vi.mock('../../../services/sermon-listener/nativeAudioCapture', () => ({
    useNativeAudioCapture: vi.fn(() => ({
        systemAudioSupported: false,
    })),
}))

vi.mock('../../../hooks/useAudioDevices', () => ({
    useAudioDevices: vi.fn(() => ({
        devices: [],
        isLoading: false,
        refresh: vi.fn(),
        resolvedDeviceId: '',
    })),
    saveSelectedDeviceLabel: vi.fn(),
}))

describe('SermonListenerSettings', () => {
    it('renders the song-tracking settings off the real store', () => {
        // Asserting on the song-tracking row, not just that render() didn't
        // throw: that slice is what the previous hand-rolled store mock was
        // missing, so a bare smoke test would pass again the moment someone
        // reintroduced one.
        render(<SermonListenerSettings />)
        expect(screen.getByText(/auto-detect songs from your library/i)).toBeInTheDocument()
    })
})
