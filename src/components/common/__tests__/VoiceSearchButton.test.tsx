/**
 * Tests for the VoiceSearchButton component.
 *
 * The component is purely presentational — the parent owns the
 * recognition state. We verify the three rendering modes
 * (supported-listening, supported-idle, unsupported) and that
 * click events forward to the caller.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VoiceSearchButton } from '../VoiceSearchButton'

afterEach(() => {
    vi.restoreAllMocks()
})

describe('VoiceSearchButton', () => {
    it('renders the idle mic icon when supported and not listening', () => {
        render(
            <VoiceSearchButton
                isListening={false}
                isSupported
                error={null}
                onClick={() => {}}
            />,
        )
        const button = screen.getByTestId('voice-search-button')
        expect(button.getAttribute('data-listening')).toBe('false')
        expect(button.getAttribute('aria-label')).toBe('Search by voice')
    })

    it('renders the listening state with a pulse when isListening is true', () => {
        render(
            <VoiceSearchButton
                isListening
                isSupported
                error={null}
                onClick={() => {}}
            />,
        )
        const button = screen.getByTestId('voice-search-button')
        expect(button.getAttribute('data-listening')).toBe('true')
        expect(button.getAttribute('aria-label')).toBe('Stop voice search')
        // The pulse span is rendered alongside the icon while listening
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull()
    })

    it('forwards clicks to the onClick handler', () => {
        const onClick = vi.fn()
        render(
            <VoiceSearchButton
                isListening={false}
                isSupported
                error={null}
                onClick={onClick}
            />,
        )
        fireEvent.click(screen.getByTestId('voice-search-button'))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('renders a disabled state with MicOff when SpeechRecognition is unavailable', () => {
        render(
            <VoiceSearchButton
                isListening={false}
                isSupported={false}
                error={null}
                onClick={() => {}}
            />,
        )
        const button = screen.getByTestId('voice-search-disabled')
        expect(button).toBeDisabled()
    })

    it('surfaces the error in the tooltip when one is set', () => {
        render(
            <VoiceSearchButton
                isListening={false}
                isSupported
                error="Microphone permission was denied."
                onClick={() => {}}
            />,
        )
        const button = screen.getByTestId('voice-search-button')
        expect(button.getAttribute('title')).toBe('Microphone permission was denied.')
    })
})
