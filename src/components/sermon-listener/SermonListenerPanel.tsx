/**
 * SermonListenerPanel Component
 * UI for the sermon listening feature with real-time verse detection
 */

import { useState, useEffect, useRef } from 'react'
import { useSermonListener } from '../../hooks/useSermonListener'
import { useTranscripts } from '../../hooks/useTranscripts'
import { useAppStore } from '../../store/appStore'
import { formatVerseForDisplay } from '../../services/sermon-listener/verseDetection'
import type { DetectedVerse } from '../../services/sermon-listener/verseDetection'
import { Mic, Square, Book, Send, Trash2, Loader2, Save, FileText, ChevronDown, ChevronUp, X, Calendar, Filter } from 'lucide-react'
import type { Scripture, BibleVerse } from '../../types'
import type { Transcript } from '../../hooks/useTranscripts'

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
    const [showSavedTranscripts, setShowSavedTranscripts] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [transcriptTitle, setTranscriptTitle] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null)
    const [showOnlyBestMatches, setShowOnlyBestMatches] = useState(true) // Default to showing only best matches
    const transcriptRef = useRef<HTMLDivElement>(null)

    const activeSchedule = useAppStore((state) => state.activeSchedule)

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
        isSpeechDetected,
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

    // Use the transcripts hook with the active schedule
    const {
        transcripts,
        scheduleTranscripts,
        isLoading: transcriptsLoading,
        createTranscript,
        deleteTranscript,
    } = useTranscripts(activeSchedule?._id)

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

    // Handle verse click - set as current and lookup
    const handleVerseClick = (verse: DetectedVerse) => {
        // Just lookup the verse content, don't change currentVerse
        // The current verse should always be the latest detected
        lookupVerse(verse)
    }

    // Handle save transcript
    const handleSaveTranscript = async () => {
        if (!transcript.trim()) return

        setIsSaving(true)
        const title = transcriptTitle.trim() || `Sermon Transcript ${new Date().toLocaleDateString()}`

        const result = await createTranscript({
            title,
            transcript,
            detectedVerses,
            provider,
            language,
            scheduleId: activeSchedule?._id,
        })

        setIsSaving(false)

        if (result) {
            setShowSaveDialog(false)
            setTranscriptTitle('')
            // Optionally reset after saving
            // reset()
        }
    }

    // Handle delete transcript
    const handleDeleteTranscript = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (confirm('Are you sure you want to delete this transcript?')) {
            await deleteTranscript(id)
            if (selectedTranscript?._id === id) {
                setSelectedTranscript(null)
            }
        }
    }

    // Format date for display
    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    // Get the transcripts to display based on active schedule
    const displayTranscripts = activeSchedule?._id ? scheduleTranscripts : transcripts

    // Not supported message
    if (!isSupported) {
        const unsupportedMessage = (() => {
            switch (provider) {
                case 'whisper':
                    return 'Whisper API provider is not configured. Add a transcription endpoint in settings, or switch to Web Speech API.'
                case 'whisper-cpp':
                    return 'Whisper.cpp provider is not configured. Set a local whisper.cpp endpoint in settings, or switch to Web Speech API.'
                case 'faster-whisper':
                    return 'Faster-Whisper provider is not configured. Set a Faster-Whisper endpoint in settings, or switch to Web Speech API.'
                case 'elevenlabs':
                    return 'ElevenLabs provider is not configured. Add an ElevenLabs API key in settings, or switch to Web Speech API.'
                case 'desktop-whisper':
                    return 'Desktop Whisper is only available in the desktop app. Please use the desktop version of Selah or switch to another provider.'
                default:
                    return "Your browser doesn't support the Web Speech API. Please try Chrome, Edge, or Safari."
            }
        })()

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
            <div className={`flex items-center gap-2 ${compact ? 'p-1.5' : 'p-2'} rounded-lg bg-gray-100 dark:bg-gray-800 ${isSpeechDetected ? 'ring-2 ring-green-500/50 animate-[speech-glow_1s_ease-in-out_infinite]' : ''}`}>
                <div className={`relative flex-shrink-0 ${isListening ? 'animate-pulse' : ''}`}>
                    {isListening ? (
                        <Square className="w-5 h-5 text-red-500" />
                    ) : (
                        <Mic className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    )}
                    {isListening && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-ping" />
                    )}
                    {/* Speech detection pulse ring */}
                    {isSpeechDetected && (
                        <span className="absolute inset-0 rounded-full bg-green-500/30 animate-[speech-pulse-ring_1s_ease-out_infinite]" />
                    )}
                </div>

                {/* Audio waveform visualization when speech is detected */}
                {isListening && (
                    <div className={`flex items-center justify-center gap-[2px] h-5 ${isSpeechDetected ? 'opacity-100' : 'opacity-30'} transition-opacity duration-200`}>
                        {[...Array(5)].map((_, i) => (
                            <div
                                key={i}
                                className={`w-1 rounded-full ${isSpeechDetected ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`}
                                style={{
                                    animationName: isSpeechDetected ? 'waveform-bar' : 'none',
                                    animationDuration: `${0.4 + i * 0.1}s`,
                                    animationTimingFunction: 'ease-in-out',
                                    animationIterationCount: 'infinite',
                                    animationDelay: `${i * 0.08}s`,
                                    height: '4px'
                                }}
                            />
                        ))}
                    </div>
                )}

                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-gray-700 dark:text-gray-300">
                        {isListening ? 'Listening...' : 'Sermon Listener'}
                    </p>
                    {activeSchedule && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                            Schedule: {activeSchedule.name}
                        </p>
                    )}
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
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                {showOnlyBestMatches
                                    ? `${detectedVerses.filter(v => v.isBestMatch).length} confirmed`
                                    : `${detectedVerses.length} total`
                                } verse{detectedVerses.length !== 1 ? 's' : ''}
                            </span>
                            {/* Filter toggle */}
                            <button
                                onClick={() => setShowOnlyBestMatches(!showOnlyBestMatches)}
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${showOnlyBestMatches
                                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                    }`}
                                title={showOnlyBestMatches ? 'Showing only confirmed verses' : 'Showing all detected verses'}
                            >
                                <Filter className="w-3 h-3" />
                                {showOnlyBestMatches ? 'Confirmed' : 'All'}
                            </button>
                        </div>
                        <button
                            onClick={reset}
                            className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {(showOnlyBestMatches
                            ? detectedVerses.filter(v => v.isBestMatch)
                            : detectedVerses
                        ).map((verse, idx) => (
                            <div
                                key={`${verse.reference}-${idx}`}
                                className={`group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-colors ${currentVerse?.reference === verse.reference
                                    ? 'bg-blue-500 text-white'
                                    : verse.isBestMatch
                                        ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'
                                        : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600'
                                    }`}
                                onClick={() => handleVerseClick(verse)}
                            >
                                <Book className="w-3 h-3" />
                                <span>{formatVerseForDisplay(verse)}</span>
                                {!verse.isBestMatch && (
                                    <span className="text-[8px] opacity-60 ml-0.5">?</span>
                                )}
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
                <div className={`flex-1 min-h-0 p-2 rounded-lg bg-gray-100 dark:bg-gray-800 flex flex-col transition-all duration-300 ${isSpeechDetected ? 'ring-2 ring-green-500/30' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Transcript</span>
                            {isSpeechDetected && (
                                <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                    Speaking
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {transcript && (
                                <button
                                    onClick={() => setShowSaveDialog(true)}
                                    className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600"
                                    title="Save transcript"
                                >
                                    <Save className="w-3 h-3" />
                                    Save
                                </button>
                            )}
                            {transcript && (
                                <button
                                    onClick={reset}
                                    className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ml-2"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <div
                        ref={transcriptRef}
                        className={`flex-1 p-2 rounded text-xs overflow-y-auto bg-white dark:bg-gray-900 transition-all duration-200 ${isSpeechDetected ? 'border border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.1)]' : ''}`}
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

            {/* Save Dialog */}
            {showSaveDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 w-80 max-w-[90vw]">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                                Save Transcript
                            </h3>
                            <button
                                onClick={() => setShowSaveDialog(false)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Title
                            </label>
                            <input
                                type="text"
                                value={transcriptTitle}
                                onChange={(e) => setTranscriptTitle(e.target.value)}
                                placeholder={`Sermon Transcript ${new Date().toLocaleDateString()}`}
                                className="w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                            />
                        </div>

                        {activeSchedule && (
                            <div className="mb-3 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-600 dark:text-blue-400">
                                <Calendar className="w-3 h-3 inline mr-1" />
                                Will be associated with: {activeSchedule.name}
                            </div>
                        )}

                        {detectedVerses.length > 0 && (
                            <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                                {detectedVerses.length} detected verse{detectedVerses.length !== 1 ? 's' : ''} will be saved with this transcript
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowSaveDialog(false)}
                                className="px-3 py-1.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveTranscript}
                                disabled={isSaving || !transcript.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                            >
                                {isSaving ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <Save className="w-3 h-3" />
                                )}
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Saved Transcripts Section */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                <button
                    onClick={() => setShowSavedTranscripts(!showSavedTranscripts)}
                    className="flex items-center justify-between w-full p-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                    <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        Saved Transcripts
                        {displayTranscripts && displayTranscripts.length > 0 && (
                            <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full text-[10px]">
                                {displayTranscripts.length}
                            </span>
                        )}
                    </span>
                    {showSavedTranscripts ? (
                        <ChevronUp className="w-3 h-3" />
                    ) : (
                        <ChevronDown className="w-3 h-3" />
                    )}
                </button>

                {showSavedTranscripts && (
                    <div className="mt-1 max-h-48 overflow-y-auto space-y-1">
                        {transcriptsLoading ? (
                            <div className="p-2 text-center text-xs text-gray-500 dark:text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                            </div>
                        ) : displayTranscripts && displayTranscripts.length > 0 ? (
                            displayTranscripts.map((t) => (
                                <div
                                    key={t._id}
                                    onClick={() => setSelectedTranscript(selectedTranscript?._id === t._id ? null : t)}
                                    className={`p-2 rounded cursor-pointer transition-colors ${selectedTranscript?._id === t._id
                                        ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
                                        : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800'
                                        }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                                {t.title}
                                            </p>
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                                {formatDate(t.createdAt)}
                                            </p>
                                            {t.detectedVerses && t.detectedVerses.length > 0 && (
                                                <div className="flex items-center gap-1 mt-1">
                                                    <Book className="w-2.5 h-2.5 text-blue-500" />
                                                    <span className="text-[10px] text-blue-500">
                                                        {t.detectedVerses.length} verse{t.detectedVerses.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={(e) => handleDeleteTranscript(t._id, e)}
                                            className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* Expanded view */}
                                    {selectedTranscript?._id === t._id && (
                                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                            <p className="text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                {t.transcript.substring(0, 500)}
                                                {t.transcript.length > 500 && '...'}
                                            </p>
                                            {t.detectedVerses && t.detectedVerses.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {t.detectedVerses.map((v, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"
                                                        >
                                                            {v.reference}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="p-3 text-center text-xs text-gray-500 dark:text-gray-400">
                                No saved transcripts
                                {activeSchedule?._id && ' for this schedule'}
                            </div>
                        )}
                    </div>
                )}
            </div>

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