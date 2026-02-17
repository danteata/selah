/**
 * SermonListenerPanel Component
 * UI for the sermon listening feature with real-time verse detection
 */

import { useState, useEffect, useRef } from 'react'
import { useSermonListener } from '../../hooks/useSermonListener'
import { formatVerseForDisplay } from '../../services/sermon-listener/verseDetection'
import type { DetectedVerse } from '../../services/sermon-listener/verseDetection'
import { useAppStore } from '../../store/appStore'
import { Mic, Square, Book, Send, Trash2, Loader2 } from 'lucide-react'
import type { Scripture, BibleVerse } from '../../types'

interface SermonListenerPanelProps {
    /** Whether to auto-display detected verses */
    autoDisplay?: boolean
    /** Whether to auto-lookup detected verses */
    autoLookup?: boolean
    /** Initial language for speech recognition */
    language?: string
    /** Callback when a verse is detected */
    onVerseDetected?: (verse: DetectedVerse, scripture: Scripture | null) => void
    /** Compact mode for sidebar */
    compact?: boolean
}

export function SermonListenerPanel({
    autoDisplay = false,
    autoLookup = true,
    language = 'en-US',
    onVerseDetected,
    compact = false,
}: SermonListenerPanelProps) {
    const isDarkMode = useAppStore((state) => state.isDarkMode)
    const [autoDisplayEnabled, setAutoDisplayEnabled] = useState(autoDisplay)
    const transcriptRef = useRef<HTMLDivElement>(null)

    const {
        isListening,
        isSupported,
        transcript,
        interimTranscript,
        detectedVerses,
        currentVerse,
        currentScripture,
        error,
        isLoading,
        provider,
        start,
        stop,
        reset,
        lookupVerse,
        displayCurrentVerse,
        removeVerse,
    } = useSermonListener({
        language,
        autoLookup,
        autoDisplay: autoDisplayEnabled,
        onVerseDetected,
    })

    // Auto-scroll transcript
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
        }
    }, [transcript, interimTranscript])

    // Debug: log transcript changes
    useEffect(() => {
        console.log('[SermonListenerPanel] Transcript updated:', transcript?.substring(0, 100))
    }, [transcript])

    // Handle verse click - display on live
    const handleVerseClick = (verse: DetectedVerse) => {
        lookupVerse(verse)
    }

    // Not supported message
    if (!isSupported) {
        const unsupportedMessage = provider === 'whisper'
            ? 'Whisper API provider is not configured. Add a transcription endpoint in settings, or switch to Web Speech API.'
            : provider === 'whisper-cpp'
                ? 'Whisper.cpp provider is not configured. Set a local whisper.cpp endpoint in settings, or switch to Web Speech API.'
                : "Your browser doesn't support the Web Speech API. Please try Chrome, Edge, or Safari."

        return (
            <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <div className="flex items-center gap-3 text-amber-500">
                    <Mic className="w-6 h-6 opacity-50" />
                    <div>
                        <p className="font-medium">Speech Recognition Not Supported</p>
                        <p className="text-sm opacity-75">
                            {unsupportedMessage}
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-4'}`}>
            {/* Header with controls */}
            <div className={`flex items-center justify-between ${compact ? 'p-2' : 'p-4'} rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <div className="flex items-center gap-3">
                    <div className={`relative ${isListening ? 'animate-pulse' : ''}`}>
                        {isListening ? (
                            <Square className="w-6 h-6 text-red-500" />
                        ) : (
                            <Mic className={`w-6 h-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} />
                        )}
                        {isListening && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                        )}
                    </div>
                    <div>
                        <h3 className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>
                            Sermon Listener
                        </h3>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isListening ? 'Listening for Bible verses...' : 'Click to start listening'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Auto-display toggle */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoDisplayEnabled}
                            onChange={(e) => setAutoDisplayEnabled(e.target.checked)}
                            className="w-4 h-4 rounded"
                        />
                        <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Auto-display
                        </span>
                    </label>

                    {/* Start/Stop button */}
                    <button
                        onClick={isListening ? stop : start}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${isListening
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }`}
                    >
                        {isListening ? 'Stop' : 'Start'}
                    </button>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-red-900/30' : 'bg-red-100'} text-red-500`}>
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {/* Current verse display */}
            {currentVerse && currentScripture && (
                <div className={`p-4 rounded-lg border-2 ${isDarkMode ? 'bg-blue-900/30 border-blue-500' : 'bg-blue-50 border-blue-300'}`}>
                    <div className="flex items-start justify-between mb-2">
                        <h4 className="font-bold text-lg text-blue-500">
                            {formatVerseForDisplay(currentVerse)}
                        </h4>
                        <button
                            onClick={displayCurrentVerse}
                            className="flex items-center gap-1 px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
                        >
                            <Send className="w-4 h-4" />
                            Send to Live
                        </button>
                    </div>
                    <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {Array.isArray(currentScripture.content) && currentScripture.content.map((verse: BibleVerse, idx: number) => (
                            <p key={idx} className="mb-1">
                                <sup className="text-xs text-blue-500 mr-1">{verse.verse}</sup>
                                {verse.scripture}
                            </p>
                        ))}
                    </div>
                </div>
            )}

            {/* Detected verses list */}
            {detectedVerses.length > 0 && (
                <div className={`${compact ? 'p-2' : 'p-4'} rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>
                            Detected Verses ({detectedVerses.length})
                        </h4>
                        <button
                            onClick={reset}
                            className={`text-xs ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Clear all
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {detectedVerses.map((verse, idx) => (
                            <div
                                key={`${verse.reference}-${idx}`}
                                className={`group flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${currentVerse?.reference === verse.reference
                                    ? 'bg-blue-500 text-white'
                                    : isDarkMode
                                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                    }`}
                                onClick={() => handleVerseClick(verse)}
                            >
                                <Book className="w-4 h-4" />
                                <span>{formatVerseForDisplay(verse)}</span>
                                {isLoading && currentVerse?.reference === verse.reference && (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        removeVerse(verse)
                                    }}
                                    className={`ml-1 opacity-0 group-hover:opacity-100 transition-opacity ${currentVerse?.reference === verse.reference
                                        ? 'text-white/70 hover:text-white'
                                        : 'text-gray-400 hover:text-red-500'
                                        }`}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transcript section - always show when listening or has content */}
            {(isListening || transcript || interimTranscript) && (
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>
                            Transcript
                        </h4>
                        {transcript && (
                            <button
                                onClick={reset}
                                className={`text-xs ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div
                        ref={transcriptRef}
                        className={`p-3 rounded-lg max-h-48 overflow-y-auto ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}
                    >
                        <p className={`text-sm whitespace-pre-wrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {transcript}
                            {interimTranscript && (
                                <span className={`${isDarkMode ? 'text-gray-500 italic' : 'text-gray-400 italic'}`}>
                                    {interimTranscript}
                                </span>
                            )}
                        </p>
                        {!transcript && !interimTranscript && isListening && (
                            <p className={`text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                Listening... Speak to see transcription.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!isListening && detectedVerses.length === 0 && (
                <div className={`text-center py-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    <Mic className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                        Start listening to detect Bible verses from the sermon
                    </p>
                </div>
            )}
        </div>
    )
}

export default SermonListenerPanel
