import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DetectedVersesBar } from '../DetectedVersesBar'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            openBibleFromSermon: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../SermonListenerContext', () => ({
    useSermonListenerContext: vi.fn(() => ({
        detectedVerses: [],
        currentVerse: null,
        currentScripture: null,
        isListening: false,
        isSpeechDetected: false,
        setCurrentDetectedVerse: vi.fn(),
        displayCurrentVerse: vi.fn(),
        removeVerse: vi.fn(),
    })),
}))

describe('DetectedVersesBar', () => {
    it('renders nothing when no detected verses and not listening', () => {
        render(<DetectedVersesBar />)
        expect(screen.queryByText('Detected Verses')).not.toBeInTheDocument()
    })
})
