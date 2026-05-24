/**
 * SermonListenerPanel Component
 * UI for the sermon listening feature with real-time verse detection
 *
 * When mounted inside a SermonListenerProvider, it uses the shared context
 * state so transcription continues even when the panel is hidden.
 * Otherwise, it creates its own useSermonListener instance (backward compat).
 */

import { useState, useEffect, useRef } from 'react'
import { useSermonListener, type UseSermonListenerReturn } from '../../hooks/useSermonListener'
import { useSermonListenerContext } from './SermonListenerContext'
import { SermonListenerWizard, isSermonListenerWizardComplete } from './SermonListenerWizard'
import { useTranscripts } from '../../hooks/useTranscripts'
import { useAppStore } from '../../store/appStore'
import { formatVerseForDisplay } from '../../services/sermon-listener/verseDetection'
import type { DetectedVerse } from '../../services/sermon-listener/verseDetection'
import { Mic, Square, BookOpen, Loader2, Save, FileText, ChevronDown, ChevronUp, X, Calendar, Book, Trash2, NotebookPen, Minimize2 } from 'lucide-react'
import type { Scripture } from '../../types'
import type { Transcript } from '../../hooks/useTranscripts'

interface SermonListenerPanelProps {
    autoDisplay?: boolean
    autoLookup?: boolean
    language?: string
    onVerseDetected?: (verse: DetectedVerse, scripture: Scripture | null) => void
    compact?: boolean
    onHide?: () => void
}

export function SermonListenerPanel(props: SermonListenerPanelProps) {
    const contextState = useSermonListenerContext()

    if (contextState) {
        return <SermonListenerPanelInner {...props} sermonListener={contextState} />
    }

    return <SermonListenerPanelStandalone {...props} />
}

function SermonListenerPanelStandalone(props: SermonListenerPanelProps) {
    const sermonListener = useSermonListener({
        language: props.language,
        autoLookup: props.autoLookup,
        autoDisplay: props.autoDisplay,
        onVerseDetected: props.onVerseDetected,
    })

    return <SermonListenerPanelInner {...props} sermonListener={sermonListener} />
}

interface SermonListenerPanelInnerProps extends SermonListenerPanelProps {
    sermonListener: UseSermonListenerReturn
}

function SermonListenerPanelInner({
    autoDisplay = false,
    language = 'en-US',
    compact = false,
    onHide,
    sermonListener,
}: SermonListenerPanelInnerProps) {
    const [autoDisplayEnabled, setAutoDisplayEnabled] = useState(autoDisplay)
    const [showSavedTranscripts, setShowSavedTranscripts] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [transcriptTitle, setTranscriptTitle] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null)
    const [autoSaveTranscriptId, setAutoSaveTranscriptId] = useState<string | null>(null)
    const [sermonNotes, setSermonNotes] = useState('')
    const [showWizard, setShowWizard] = useState(!isSermonListenerWizardComplete())
    const transcriptRef = useRef<HTMLDivElement>(null)

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const openBibleFromSermon = useAppStore((state) => state.openBibleFromSermon)

    const {
        isListening,
        isSupported,
        transcript,
        interimTranscript,
        detectedVerses,
        currentVerse,
        error,
        provider,
        isSpeechDetected,
        audioLevel,
        captureSource,
        isInitializingProvider,
        providerReady,
        start,
        stop,
        reset,
        addCorrection,
    } = sermonListener

    const uniqueDetectedVerses = detectedVerses.filter((verse, index, arr) => arr.findIndex(v => v.reference === verse.reference) === index)

    const {
        transcripts,
        scheduleTranscripts,
        isLoading: transcriptsLoading,
        createTranscript,
        updateTranscript,
        deleteTranscript,
    } = useTranscripts(activeSchedule?._id)

    useEffect(() => {
        if (!isListening || !transcript.trim()) return
        const timer = setInterval(async () => {
            const title = transcriptTitle.trim() || `Sermon Transcript ${new Date().toLocaleDateString()}`
            if (!autoSaveTranscriptId) {
                const id = await createTranscript({ title, transcript, detectedVerses, provider, language, scheduleId: activeSchedule?._id })
                if (id) setAutoSaveTranscriptId(id)
                return
            }
            await updateTranscript(autoSaveTranscriptId, { title, transcript, detectedVerses, scheduleId: activeSchedule?._id })
        }, 15000)
        return () => clearInterval(timer)
    }, [isListening, transcript, transcriptTitle, autoSaveTranscriptId, createTranscript, updateTranscript, detectedVerses, provider, language, activeSchedule?._id])

    const generateSermonNotes = () => {
        const body = transcript.trim()
        if (!body) return
        // Split into sentences, filter out very short fragments, take meaningful ones
        const sentences = body
            .replace(/\n+/g, ' ')
            .split(/[.!?]+\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 20 && s.split(/\s+/).length >= 5)
        // Deduplicate near-identical sentences (common with ASR stutter)
        const deduped: string[] = []
        for (const s of sentences) {
            const lower = s.toLowerCase()
            const dup = deduped.some(d => d.toLowerCase().includes(lower) || lower.includes(d.toLowerCase()))
            if (!dup) deduped.push(s)
        }
        const keyPoints = deduped.slice(0, 10)
        const verses = detectedVerses.map(v => formatVerseForDisplay(v))
        const uniqueVerses = Array.from(new Set(verses))
        const timestamp = new Date().toLocaleString()

        setSermonNotes([
            `Sermon Notes — ${timestamp}`,
            `Generated from transcript (${(body.length / 5).toFixed(0)} words)`,
            '',
            '─────────────────────────',
            'SCRIPTURE REFERENCES',
            '─────────────────────────',
            uniqueVerses.length ? uniqueVerses.map((v) => `• ${v}`).join('\n') : '• None detected yet',
            '',
            '─────────────────────────',
            'KEY POINTS',
            '─────────────────────────',
            keyPoints.map((p, i) => `${i + 1}. ${p}.`).join('\n\n'),
            '',
            '─────────────────────────',
            'REFLECTION & APPLICATION',
            '─────────────────────────',
            'Main takeaway:',
            '',
            'How does this apply to me?',
            '',
            'One action step this week:',
            '',
            'Prayer focus:',
            '',
            '─────────────────────────',
            'FULL TRANSCRIPT',
            '─────────────────────────',
            body,
        ].join('\n'))
    }

    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
        }
    }, [transcript, interimTranscript])

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
        }
    }

    const handleDeleteTranscript = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (confirm('Are you sure you want to delete this transcript?')) {
            await deleteTranscript(id)
            if (selectedTranscript?._id === id) {
                setSelectedTranscript(null)
            }
        }
    }

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

    const displayTranscripts = activeSchedule?._id ? scheduleTranscripts : transcripts

    if (isInitializingProvider || isSupported === null) {
        return (
            <div className={`flex flex-col h-full items-center justify-center gap-2 ${compact ? 'p-3' : 'p-6'} text-center text-gray-500 dark:text-gray-400`}>
                <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-teal)]" />
                <p className="text-xs font-medium">
                    Preparing Sermon Listener...
                </p>
                <p className="text-[10px] opacity-75 max-w-[200px]">
                    One moment while the transcription engine loads.
                </p>
            </div>
        )
    }

    if (isSupported === false) {
        const unsupportedMessage = provider === 'desktop-whisper'
            ? 'Local transcription is only available in the desktop app. Please use the desktop version of Selah.'
            : "Your browser doesn't support speech recognition. Please try Chrome, Edge, or Safari."

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
            {showWizard && (
                <SermonListenerWizard onComplete={() => setShowWizard(false)} />
            )}
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
                    {isSpeechDetected && (
                        <span className="absolute inset-0 rounded-full bg-green-500/30 animate-[speech-pulse-ring_1s_ease-out_infinite]" />
                    )}
                </div>

                {/* Audio waveform visualization - driven by real audio level */}
                {isListening && captureSource === 'system' && (
                    <div className="flex items-center gap-1.5 h-6 px-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-medium text-blue-500">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                        System Audio
                    </div>
                )}
                {isListening && captureSource !== 'system' && (
                    <div className={`flex items-end justify-center gap-[2px] h-6 min-w-[48px] ${(isSpeechDetected || audioLevel > 0.02) ? 'opacity-100' : 'opacity-35'} transition-opacity duration-200`}>
                        {[4, 7, 5, 9, 6, 8, 5, 7].map((weight, i) => {
                            const minH = 3
                            const maxH = 22
                            const scaled = Math.min(audioLevel * weight * 0.7, 1)
                            const h = minH + scaled * (maxH - minH)
                            return (
                                <div
                                    key={i}
                                    className={`w-[3px] rounded-full transition-[height] duration-75 ${(isSpeechDetected || audioLevel > 0.02) ? 'bg-gradient-to-t from-emerald-600 via-emerald-400 to-cyan-300 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-gray-400 dark:bg-gray-500'}`}
                                    style={{ height: `${h}px` }}
                                />
                            )
                        })}
                    </div>
                )}

                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-gray-700 dark:text-gray-300">
                        {isListening ? 'Listening...' : isInitializingProvider ? 'Loading model...' : (provider !== 'web-speech' && !providerReady && isSupported) ? 'Starting transcription...' : 'Sermon Listener'}
                    </p>
                    {activeSchedule && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                            Schedule: {activeSchedule.name}
                        </p>
                    )}
                    {autoSaveTranscriptId && (
                        <p className="text-[10px] text-[var(--accent-teal)] truncate">Auto-saving</p>
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

                {/* Hide to background button (only shown when listening and onHide available) */}
                {isListening && onHide && (
                    <button
                        onClick={onHide}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all flex-shrink-0"
                        title="Minimize panel — keep listening in background"
                    >
                        <Minimize2 className="w-3 h-3" />
                        <span className="hidden sm:inline">Minimize</span>
                    </button>
                )}

                {/* Start/Stop button */}
                <button
                    onClick={isListening ? stop : start}
                    disabled={!isListening && (isInitializingProvider || (provider !== 'web-speech' && !providerReady))}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all shadow-sm flex-shrink-0 ${isListening
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : isInitializingProvider || (provider !== 'web-speech' && !providerReady)
                            ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-wait'
                            : 'bg-[var(--accent-teal)] hover:brightness-110 text-white'
                    }`}
                >
                    {isListening ? 'Stop' : isInitializingProvider ? 'Loading model...' : (provider !== 'web-speech' && !providerReady) ? 'Starting...' : 'Start'}
                </button>
            </div>

            {/* Error message */}
            {error && (
                <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-500">
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {/* Detected verses link to Bible panel */}
            {uniqueDetectedVerses.length > 0 && (
                <div className="px-2 py-1.5 rounded-lg bg-[var(--accent-amber)]/5 border border-[var(--accent-amber)]/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-[var(--accent-amber)]" />
                            <span className="text-xs font-medium text-[var(--accent-amber)]">
                                {uniqueDetectedVerses.filter(v => v.isBestMatch).length} confirmed verse{uniqueDetectedVerses.filter(v => v.isBestMatch).length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <button
                            onClick={() => openBibleFromSermon(formatVerseForDisplay(currentVerse || uniqueDetectedVerses[0]))}
                            className="flex items-center gap-1 px-2 py-0.5 bg-[var(--accent-teal)] text-white rounded text-[10px] font-medium hover:brightness-110 transition-all shadow-sm"
                        >
                            <BookOpen className="w-3 h-3" />
                            View in Bible
                        </button>
                    </div>
                    {currentVerse && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">
                            Current: <span className="text-[var(--accent-teal)] font-medium">{formatVerseForDisplay(currentVerse)}</span>
                        </p>
                    )}
                </div>
            )}

            {/* Missed verse flag — zero friction, one tap records timestamp for post-sermon review */}
            {(isListening || transcript) && <MissedVerseFlag onFlag={addCorrection} />}

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
                                    onClick={generateSermonNotes}
                                    className="flex items-center gap-1 text-[10px] text-[var(--accent-teal)] hover:brightness-110"
                                    title="Generate sermon notes"
                                >
                                    <NotebookPen className="w-3 h-3" />
                                    Notes
                                </button>
                            )}
                            {transcript && (
                                <button
                                    onClick={() => setShowSaveDialog(true)}
                                    className="flex items-center gap-1 text-[10px] text-[var(--accent-teal)] hover:brightness-110"
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
                        {transcript ? (
                            <div className="space-y-2 text-gray-700 dark:text-gray-300">
                                {transcript.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean).map((para, i) => {
                                    const trimmed = para.trim()
                                    if (!trimmed) return null
                                    const isInterim = i === 0 && interimTranscript && !transcript.includes(interimTranscript)
                                    return (
                                        <p key={i} className={`leading-relaxed ${isInterim ? 'italic text-gray-400 dark:text-gray-500' : ''}`}>
                                            {trimmed}
                                            {isInterim && ` ${interimTranscript}`}
                                        </p>
                                    )
                                })}
                                {interimTranscript && !transcript.includes(interimTranscript) && (
                                    <p className="italic text-gray-400 dark:text-gray-500">
                                        {interimTranscript}
                                    </p>
                                )}
                            </div>
                        ) : interimTranscript ? (
                            <p className="italic text-gray-400 dark:text-gray-500">
                                {interimTranscript}
                            </p>
                        ) : isListening ? (
                            <p className="italic text-gray-400 dark:text-gray-500">
                                Listening...
                            </p>
                        ) : (
                            <p className="italic text-gray-400 dark:text-gray-500">
                                Start listening to see the transcript here.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {sermonNotes && (
                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">Sermon Notes</p>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(sermonNotes)
                                    .then(() => alert('Notes copied to clipboard'))
                                    .catch(() => {})
                            }}
                            className="text-[10px] text-[var(--accent-teal)] hover:brightness-110"
                        >
                            Copy
                        </button>
                    </div>
                    <textarea
                        value={sermonNotes}
                        onChange={(e) => setSermonNotes(e.target.value)}
                        className="w-full h-32 p-2 rounded text-xs bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-700/50 text-gray-700 dark:text-gray-200 font-sans resize-y focus:outline-none focus:ring-1 focus:ring-[var(--accent-teal)]"
                        placeholder="Your sermon notes..."
                    />
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
                            <div className="mb-3 p-2 rounded bg-[var(--accent-teal)]/5 text-[var(--accent-teal)]">
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
                                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-[var(--accent-teal)] text-white hover:brightness-110 disabled:opacity-50 transition-all shadow-sm"
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
                                        ? 'bg-[var(--accent-teal)]/5 border border-[var(--accent-teal)]/20'
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
                                                    <Book className="w-2.5 h-2.5 text-[var(--accent-teal)]" />
                                                    <span className="text-[10px] text-[var(--accent-teal)]">
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
                                                            className="px-1.5 py-0.5 text-[10px] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] rounded"
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
                        {onHide && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                                Hide this panel while recording to keep listening in the background
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

function MissedVerseFlag({ onFlag }: { onFlag: (ref: string) => void }) {
    const [flagged, setFlagged] = useState(false)

    const handleFlag = () => {
        onFlag('manual-flag')
        setFlagged(true)
        setTimeout(() => setFlagged(false), 2000)
    }

    return (
        <button
            onClick={handleFlag}
            className={`w-full px-2 py-1 rounded text-[10px] font-medium transition-all border ${flagged
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-300 text-green-600 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/20'
                }`}
            title="Tap to mark a missed verse — add the reference after the sermon"
        >
            {flagged ? 'Flagged for review' : 'Missed a verse? Tap here'}
        </button>
    )
}

export default SermonListenerPanel