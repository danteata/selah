/**
 * VoiceSearchButton — mic toggle for search inputs.
 *
 * Designed to live inside the right edge of a search input. Clicking
 * starts a Web Speech recognition session; clicking again (or auto-stop
 * on a final result) ends it. While listening, the icon pulses red.
 *
 * If the browser doesn't support SpeechRecognition, the button renders
 * a disabled state with a tooltip — no broken click target.
 *
 * The button is purely presentational; it doesn't hold the transcript.
 * Pair it with the `useVoiceSearch` hook in the parent and commit
 * `transcript` to the input on `onFinal`.
 *
 * On the Tauri desktop build, Chrome's `not-allowed` error is usually
 * NOT a user-facing permission denial — it's WebView2 failing to
 * initialize its audio capture. We translate the message to a friendlier
 * form there so the button doesn't appear broken even though the user
 * did nothing wrong.
 */

import { Mic, MicOff } from 'lucide-react'
import { isDesktop } from '../../platform'

export interface VoiceSearchButtonProps {
    isListening: boolean
    isSupported: boolean
    error: string | null
    onClick: () => void
    /** Optional className for sizing/positioning inside the input. */
    className?: string
    /** Override the aria-label. Defaults to "Search by voice". */
    label?: string
}

function friendlyError(error: string | null, desktop: boolean): string | null {
    if (!error) return null
    // Chrome's Web Speech API surfaces a single `not-allowed` error for
    // both "user denied the prompt" and "WebView2 audio capture init
    // failed before a prompt could even appear". On web those are both
    // real permission denials, so keep the literal message. On Tauri
    // desktop, the user almost never sees an actual prompt — the failure
    // is on our side (the WebView couldn't open the audio device) and
    // a "we couldn't start the mic, try again or use a different device"
    // message is much less alarming than "permission denied".
    if (desktop && /permission was denied/i.test(error)) {
        return "We couldn't start the microphone. Check your audio device or system mic permissions, then try again. You can also type your search below."
    }
    return error
}

export function VoiceSearchButton({
    isListening,
    isSupported,
    error,
    onClick,
    className = '',
    label,
}: VoiceSearchButtonProps) {
    const desktop = isDesktop()
    const displayError = friendlyError(error, desktop)

    const title = !isSupported
        ? 'Voice search is not supported in this browser'
        : displayError
            ? displayError
            : isListening
                ? 'Stop listening'
                : 'Search by voice'

    const ariaLabel = label ?? (isListening ? 'Stop voice search' : 'Search by voice')

    if (!isSupported) {
        return (
            <button
                type="button"
                disabled
                aria-label="Voice search not supported"
                title={title}
                className={`p-1 rounded text-[var(--text-muted)] opacity-40 cursor-not-allowed ${className}`}
                data-testid="voice-search-disabled"
            >
                <MicOff className="w-4 h-4" />
            </button>
        )
    }

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={title}
            className={`p-1 rounded transition-colors ${
                isListening
                    ? 'text-red-500 hover:text-red-400'
                    : 'text-[var(--text-muted)] hover:text-[var(--accent-teal)]'
            } ${className}`}
            data-testid="voice-search-button"
            data-listening={isListening ? 'true' : 'false'}
        >
            {isListening ? (
                <span className="relative inline-flex">
                    <Mic className="w-4 h-4" />
                    <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full bg-red-500/30 animate-ping"
                    />
                </span>
            ) : (
                <Mic className="w-4 h-4" />
            )}
        </button>
    )
}
