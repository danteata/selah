import { describe, it, expect, beforeEach, vi } from 'vitest'
import { audioFeedbackService } from '../audioFeedback'

// Minimal AudioContext mock recording how many oscillators were created.
function installMockAudioContext() {
    const created = { oscillators: 0 }
    const makeParam = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 })
    class MockAudioContext {
        currentTime = 0
        state: AudioContextState = 'running'
        destination = {}
        resume = vi.fn()
        createOscillator() {
            created.oscillators++
            return { type: 'sine', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
        }
        createGain() {
            return { gain: makeParam(), connect: vi.fn() }
        }
    }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext as unknown
    return created
}

describe('audioFeedbackService', () => {
    beforeEach(() => {
        localStorage.clear()
        audioFeedbackService.setEnabled(true)
        delete (window as unknown as { AudioContext?: unknown }).AudioContext
        delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
    })

    it('defaults to enabled and persists the toggle', () => {
        expect(audioFeedbackService.isEnabled()).toBe(true)
        audioFeedbackService.setEnabled(false)
        expect(audioFeedbackService.isEnabled()).toBe(false)
        expect(localStorage.getItem('selah:sermonAudioFeedback')).toBe('false')
    })

    it('plays tones on start when enabled', () => {
        const created = installMockAudioContext()
        audioFeedbackService.setEnabled(true)
        audioFeedbackService.playStart()
        expect(created.oscillators).toBeGreaterThan(0)
    })

    it('does not play when disabled', () => {
        const created = installMockAudioContext()
        audioFeedbackService.setEnabled(false)
        audioFeedbackService.playStart()
        audioFeedbackService.playStop()
        expect(created.oscillators).toBe(0)
    })

    it('no-ops gracefully when Web Audio is unavailable', () => {
        // No AudioContext installed on window.
        audioFeedbackService.setEnabled(true)
        expect(() => {
            audioFeedbackService.playStart()
            audioFeedbackService.playStop()
        }).not.toThrow()
    })
})
