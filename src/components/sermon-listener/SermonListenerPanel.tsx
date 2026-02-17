/**
 * SermonListenerPanel Component
 * UI for the sermon listening feature with real-time verse detection
 */

import { useState, useEffect, useRef } from 'react'
import { useSermonListener } from '../../hooks/useSermonListener'
import { formatVerseForDisplay } from '../../services/sermon-listener/verseDetection'
import type { DetectedVerse } from '../../services/sermon-listener/verseDetection'
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
            <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-800">
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
        <div className={`flex flex-col h-full ${compact ? 'gap-2' : 'gap-3'}`}>
            {/* Header with controls - compact inline layout */}
            <div className={`flex items-center gap-2 ${compact ? 'p-1.5' : 'p-2'} rounded-lg bg-gray-100 dark:bg-gray-800`}>
                <div className={`relative flex-shrink-0 ${isListening ? 'animate-pulse' : ''}`}>
                    {isListening ? (
                        <Square className="w-5 h-5 text-red-500" />
                    ) : (
                        <Mic className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    )}
                    {isListening && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping" />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-gray-700 dark:text-gray-300">
                        {isListening ? 'Listening...' : 'Sermon Listener'}
                    </p>
                </div>

                {/* Auto-display toggle - compact */}
                <label className="flex items-center gap-1 cursor-pointer flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={autoDisplayEnabled}
                        onChange={(e) => setAutoDisplayEnabled(e.target.checked)}
                        className="w-3 h-3 rounded"
                    />
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        Auto
                    </span>
                </label>

                {/* Start/Stop button */}
                <button
                    onClick={isListening ? stop : start}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex-shrink-0 ${isListening
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                        }`}
                >
                    {isListening ? 'Stop' : 'Start'}
                </button>
            </div>

            {/* Error message */}
            {error && (
                <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-500">
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {/* Current verse display - compact */}
            {currentVerse && currentScripture && (
                <div className="p-2 rounded-lg border bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-500/50">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold text-sm text-blue-500">
                            {formatVerseForDisplay(currentVerse)}
                        </h4>
                        <button
                            onClick={displayCurrentVerse}
                            className="flex items-center gap-1 px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors"
                        >
                            <Send className="w-3 h-3" />
                            Send
                        </button>
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300 max-h-20 overflow-y-auto">
                        {Array.isArray(currentScripture.content) && currentScripture.content.slice(0, 3).map((verse: BibleVerse, idx: number) => (
                            <p key={idx} className="mb-0.5">
                                <sup className="text-[10px] text-blue-500 mr-0.5">{verse.verse}</sup>
                                {verse.scripture}
                            </p>
                        ))}
                        {Array.isArray(currentScripture.content) && currentScripture.content.length > 3 && (
                            <p className="text-[10px] text-gray-400">+{currentScripture.content.length - 3} more verses</p>
                        )}
                    </div>
                </div>
            )}

            {/* Detected verses list - compact inline chips */}
            {detectedVerses.length > 0 && (
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {detectedVerses.length} verse{detectedVerses.length !== 1 ? 's' : ''}
                        </span>
                        <button
                            onClick={reset}
                            className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {detectedVerses.map((verse, idx) => (
                            <div
                                key={`${verse.reference}-${idx}`}
                                className={`group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-colors ${currentVerse?.reference === verse.reference
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'
                                    }`}
                                onClick={() => handleVerseClick(verse)}
                            >
                                <Book className="w-3 h-3" />
                                <span>{formatVerseForDisplay(verse)}</span>
                                {isLoading && currentVerse?.reference === verse.reference && (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        removeVerse(verse)
                                    }}
                                    className={`ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${currentVerse?.reference === verse.reference
                                        ? 'text-white/70 hover:text-white'
                                        : 'text-gray-400 hover:text-red-500'
                                        }`}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transcript section - compact */}
            {(isListening || transcript || interimTranscript) && (
                <div className="flex-1 min-h-0 p-2 rounded-lg bg-gray-100 dark:bg-gray-800 flex flex-col">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Transcript</span>
                        {transcript && (
                            <button
                                onClick={reset}
                                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div
                        ref={transcriptRef}
                        className="flex-1 p-2 rounded text-xs overflow-y-auto bg-white dark:bg-gray-900"
                    >
                        <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                            {transcript}
                            {interimTranscript && (
                                <span className="text-gray-400 dark:text-gray-500 italic">
                                    {interimTranscript}
                                </span>
                            )}
                        </p>
                        {!transcript && !interimTranscript && isListening && (
                            <p className="italic text-gray-400 dark:text-gray-500">
                                Listening...
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Empty state - compact */}
            {!isListening && detectedVerses.length === 0 && !transcript && (
                <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
                    <div className="text-center">
                        <Mic className="w-6 h-6 mx-auto mb-1 opacity-50" />
                        <p className="text-xs">
                            Click Start to detect verses
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SermonListenerPanel
