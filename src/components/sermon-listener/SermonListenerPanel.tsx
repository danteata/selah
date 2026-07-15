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
import { Mic, Square, BookOpen, Loader2, Save, FileText, ChevronDown, ChevronUp, X, Calendar, Book, Trash2, NotebookPen, Minimize2, AlertCircle, Check, Cloud, CloudOff, Download, Copy, MoreHorizontal, Music, Sparkles } from 'lucide-react'
import type { Scripture } from '../../types'
import type { Transcript } from '../../hooks/useTranscripts'
import { useSermonCorrections, type SermonCorrection } from '../../hooks/useSermonCorrections'
import { classifyTranscriptionError, getUserAction, transcriptionErrorCodes, isRetryableError } from '../../services/sermon-listener/transcriptionErrors'
import { downloadTranscript, type ExportFormat } from '../../services/sermon-listener/transcriptExport'
import { generateSermonNotes } from '../../services/sermon-listener/sermonNotes'
import { SongTrackingControl } from './SongTrackingControl'
import { sessionAudioRecorder } from '../../services/sermon-listener/sessionAudioRecorder'
import { writeSessionSidecar } from '../../services/sermon-listener/devAccuracyReport'
import { DevAccuracyPanel } from './DevAccuracyPanel'

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
    const [showSavedTranscripts, setShowSavedTranscripts] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [showExportPicker, setShowExportPicker] = useState(false)
    const [showOverflowMenu, setShowOverflowMenu] = useState(false)
    const [transcriptTitle, setTranscriptTitle] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'offline'; text: string } | null>(null)
    const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null)
    const [autoSaveTranscriptId, setAutoSaveTranscriptId] = useState<string | null>(null)
    const [sermonNotes, setSermonNotes] = useState('')
    const [isGeneratingNotes, setIsGeneratingNotes] = useState(false)
    const [showWizard, setShowWizard] = useState(!isSermonListenerWizardComplete())
    const [showReview, setShowReview] = useState(false)
    const transcriptRef = useRef<HTMLDivElement>(null)
    const exportPickerRef = useRef<HTMLDivElement>(null)

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const openBibleFromSermon = useAppStore((state) => state.openBibleFromSermon)
    const visualizerEnabled = useAppStore((state) => state.visualizerEnabled)
    const setVisualizerEnabled = useAppStore((state) => state.setVisualizerEnabled)
    const songAutoDetect = useAppStore((state) => state.songTracking.autoDetect)
    const setSongAutoDetect = useAppStore((state) => state.setSongAutoDetect)

    // Auto-display detected verses. This is the SAME persisted setting the
    // listener reads (settings.sermonListener.autoDisplay) and the Settings
    // screen writes — not local state — so the checkbox actually takes effect
    // and stays in sync everywhere. (Song slide auto-advance is a separate
    // toggle in SongTrackingControl.)
    const appSettings = useAppStore((state) => state.settings)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const autoDisplayEnabled = appSettings.sermonListener?.autoDisplay ?? autoDisplay
    const setAutoDisplayEnabled = (value: boolean) => {
        setAppSettings({
            ...appSettings,
            sermonListener: { ...appSettings.sermonListener, autoDisplay: value },
        })
    }

    const {
        corrections,
        addCorrection,
        removeCorrection,
        syncStatus,
        unsyncCount,
    } = useSermonCorrections()

    const {
        isListening,
        isStarting,
        isSupported,
        transcript,
        transcriptSegments,
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
        rawUtterances,
        start,
        stop,
        reset,
    } = sermonListener

    // Dev-only: record this session's raw audio to disk so it can be
    // re-transcribed offline afterward and compared against what was
    // detected live (see devAccuracyReport.ts). No-op in production builds.
    // `sessionRecordedSignal` bumps DevAccuracyPanel to refresh its list once
    // the sidecar for a just-finished session actually lands — otherwise it
    // only re-fetches when expanded/toggled and can look permanently empty.
    const [sessionRecordedSignal, setSessionRecordedSignal] = useState(0)
    const handleStart = () => {
        if (import.meta.env.DEV) {
            void sessionAudioRecorder.start()
        }
        start()
    }
    const handleStop = () => {
        if (import.meta.env.DEV) {
            const sessionId = sessionAudioRecorder.getSessionId()
            // Read before stop() — stop() clears both once it resolves.
            const startedAt = sessionAudioRecorder.getStartedAt()
            void sessionAudioRecorder.stop().then(() => {
                if (sessionId && startedAt) {
                    void writeSessionSidecar({
                        sessionId,
                        startedAt,
                        stoppedAt: Date.now(),
                        liveDetectedVerses: detectedVerses,
                        rawUtterances,
                    }).then(() => {
                        setSessionRecordedSignal((n) => n + 1)
                    }).catch((err) => {
                        console.warn('[SermonListenerPanel] Failed to write session sidecar:', err)
                    })
                }
            })
        }
        stop()
    }

    const uniqueDetectedVerses = detectedVerses.filter((verse, index, arr) => arr.findIndex(v => v.reference === verse.reference) === index)

    const {
        transcripts,
        isLoading: transcriptsLoading,
        createTranscript,
        updateTranscript,
        deleteTranscript,
    } = useTranscripts()

    useEffect(() => {
        if (!isListening || !transcript.trim()) return
        const timer = setInterval(async () => {
            const title = transcriptTitle.trim() || `Sermon Transcript ${new Date().toLocaleDateString()}`
            if (!autoSaveTranscriptId) {
                const id = await createTranscript({ title, transcript, segments: transcriptSegments, detectedVerses, provider, language, scheduleId: activeSchedule?._id })
                if (id) setAutoSaveTranscriptId(id)
                return
            }
            await updateTranscript(autoSaveTranscriptId, { title, transcript, segments: transcriptSegments, detectedVerses, scheduleId: activeSchedule?._id })
        }, 15000)
        return () => clearInterval(timer)
    }, [isListening, transcript, transcriptSegments, transcriptTitle, autoSaveTranscriptId, createTranscript, updateTranscript, detectedVerses, provider, language, activeSchedule?._id])

    const handleGenerateNotes = async () => {
        const fullText = transcript.trim()
        if (!fullText) return

        setIsGeneratingNotes(true)
        try {
            const notes = await generateSermonNotes(
                transcriptSegments,
                detectedVerses
            )
            setSermonNotes(notes)
        } catch (err) {
            console.warn('[SermonNotes] Generation failed, using heuristic fallback:', err)
            // Heuristic fallback is built into generateSermonNotes —
            // but if even that fails, show an empty notes section
            const verses = detectedVerses.filter(v => v.confidence !== 'low').map(v => formatVerseForDisplay(v))
            const uniqueVerses = Array.from(new Set(verses))
            const timestamp = new Date().toLocaleString()
            setSermonNotes([
                `Sermon Notes — ${timestamp}`,
                '',
                '━━━━━━━━━━━━━━━━━━━━━━━━━',
                'SCRIPTURE REFERENCES',
                '━━━━━━━━━━━━━━━━━━━━━━━━━',
                uniqueVerses.length ? uniqueVerses.map(v => `  • ${v}`).join('\n') : '  (No high-confidence verses detected)',
                '',
                '━━━━━━━━━━━━━━━━━━━━━━━━━',
                'REFLECTION & APPLICATION',
                '━━━━━━━━━━━━━━━━━━━━━━━━━',
                'Main takeaway:',
                '',
                'How does this apply to me?',
                '',
                'One action step this week:',
            ].join('\n'))
        } finally {
            setIsGeneratingNotes(false)
        }
    }


    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
        }
    }, [transcript, interimTranscript])

    useEffect(() => {
        if (!showExportPicker && !showOverflowMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            if (exportPickerRef.current && !exportPickerRef.current.contains(e.target as Node)) {
                setShowExportPicker(false)
                setShowOverflowMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showExportPicker, showOverflowMenu])

    const handleSaveTranscript = async () => {
        if (!transcript.trim()) return

        setIsSaving(true)
        const title = transcriptTitle.trim() || `Sermon Transcript ${new Date().toLocaleDateString()}`

        const result = await createTranscript({
            title,
            transcript,
            segments: transcriptSegments,
            detectedVerses,
            provider,
            language,
            scheduleId: activeSchedule?._id,
        })

        setIsSaving(false)

        if (result) {
            const isOffline = result.startsWith('offline-')
            setSaveMessage({
                type: isOffline ? 'offline' : 'success',
                text: isOffline ? 'Saved offline — will sync when online' : 'Transcript saved!',
            })
            setShowSaveDialog(false)
            setTranscriptTitle('')
        } else {
            setSaveMessage({
                type: 'error',
                text: 'Failed to save transcript',
            })
        }

        setTimeout(() => setSaveMessage(null), 4000)
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

    const displayTranscripts = transcripts

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
        const unsupportedMessage = provider === 'native'
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
            {/* Save feedback toast */}
            {saveMessage && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium animate-in slide-in-from-top-2 ${
                    saveMessage.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    saveMessage.type === 'offline' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                }`}>
                    {saveMessage.type === 'success' && <Check className="w-3.5 h-3.5" />}
                    {saveMessage.type === 'offline' && <CloudOff className="w-3.5 h-3.5" />}
                    {saveMessage.type === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
                    {saveMessage.text}
                </div>
            )}
            {showWizard && (
                <SermonListenerWizard onComplete={() => setShowWizard(false)} />
            )}
            {/* Header with controls - compact inline layout */}
            <div className={`flex items-center flex-wrap gap-x-2 gap-y-1 ${compact ? 'p-1.5' : 'p-2'} rounded-lg bg-gray-100 dark:bg-gray-800 ${isSpeechDetected ? 'ring-2 ring-green-500/50 animate-[speech-glow_1s_ease-in-out_infinite]' : ''}`}>
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

                {/* Live audio level — driven by the real signal for mic and system */}
                {isListening && (
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
                        {isListening
                            ? (captureSource === 'system' ? 'Listening · System Audio' : 'Listening · Microphone')
                            : isStarting ? 'Starting…'
                            : isInitializingProvider ? 'Loading model...'
                            : (provider !== 'web-speech' && !providerReady && isSupported) ? 'Starting transcription...'
                            : 'Sermon Listener'}
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

                {/* Auto-display detected verses - icon toggle (compact, keeps Stop button on-screen at narrow panel widths) */}
                <button
                    onClick={() => setAutoDisplayEnabled(!autoDisplayEnabled)}
                    className={`flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-all ${autoDisplayEnabled ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
                    title={`Auto-display detected Bible verses on the live output (${autoDisplayEnabled ? 'on' : 'off'})`}
                >
                    <Book className="w-3.5 h-3.5" />
                </button>

                {/* Auto-detect songs from the library - icon toggle */}
                <button
                    onClick={() => setSongAutoDetect(!songAutoDetect)}
                    className={`flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-all ${songAutoDetect ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
                    title={`Detect the song being sung and pull it up from the library automatically (${songAutoDetect ? 'on' : 'off'})`}
                >
                    <Music className="w-3.5 h-3.5" />
                </button>

                {/* Audio-reactive visuals toggle - icon toggle */}
                <button
                    onClick={() => setVisualizerEnabled(!visualizerEnabled)}
                    className={`flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-all ${visualizerEnabled ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
                    title={`Audio-reactive motion background on the live output (${visualizerEnabled ? 'on' : 'off'})`}
                >
                    <Sparkles className="w-3.5 h-3.5" />
                </button>

                {/* Hide to background button (only shown when listening and onHide available) */}
                {isListening && onHide && (
                    <button
                        onClick={onHide}
                        className="flex items-center justify-center w-6 h-6 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all flex-shrink-0"
                        title="Minimize panel — keep listening in background"
                    >
                        <Minimize2 className="w-3.5 h-3.5" />
                    </button>
                )}

                {/* Start/Stop button. `isStarting` covers the window between the
                    click and the provider's onStart (native spins up a model +
                    capture first), so the button never falsely reads "Start"
                    while a session is launching. */}
                <button
                    onClick={isListening || isStarting ? handleStop : handleStart}
                    disabled={!isListening && !isStarting && (isInitializingProvider || (provider !== 'web-speech' && !providerReady))}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all shadow-sm flex-shrink-0 ${isListening
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : isStarting
                            ? 'bg-amber-500 text-white cursor-wait'
                            : isInitializingProvider || (provider !== 'web-speech' && !providerReady)
                                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-wait'
                                : 'bg-[var(--accent-teal)] hover:brightness-110 text-white'
                    }`}
                >
                    {isListening ? 'Stop' : isStarting ? 'Starting…' : isInitializingProvider ? 'Loading model...' : (provider !== 'web-speech' && !providerReady) ? 'Starting...' : 'Start'}
                </button>
            </div>

            {/* Predictive song-lyric auto-advance control (shown when a song is live) */}
            <SongTrackingControl />

            {/* Dev-only: recorded-session accuracy review. Renders nothing in production builds. */}
            {import.meta.env.DEV && <DevAccuracyPanel refreshSignal={sessionRecordedSignal} />}

            {/* Error message with structured actions */}
            {error && (() => {
                const errorCode = classifyTranscriptionError(error)
                const userAction = getUserAction(errorCode)
                const isRetryable = isRetryableError(errorCode)
                return (
                    <div className={`p-3 rounded-lg ${isRetryable ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-red-100 dark:bg-red-900/30 text-red-500'}`}>
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{error}</p>
                                {isRetryable && (
                                    <p className="text-xs mt-0.5 opacity-75">Transcription will retry automatically.</p>
                                )}
                                {userAction && (
                                    <p className="text-xs mt-1 opacity-80">{userAction}</p>
                                )}
                            </div>
                            <button
                                onClick={() => sermonListener.reset && sermonListener.reset()}
                                className="text-xs underline opacity-70 hover:opacity-100 flex-shrink-0"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )
            })()}


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

            {/* Zero-friction missed verse flag — only during active listening */}
            {isListening && (
                <MissedVerseTapButton
                    onFlag={(timestamp) => {
                        const nearbyText = rawUtterances
                            .filter(u => Math.abs(u.timestamp - timestamp) < 5000)
                            .map(u => u.text)
                            .join(' ')
                            .slice(-200)
                        addCorrection(`flag-${timestamp}`, {
                            correctionType: 'missed',
                            closestRawText: nearbyText || undefined,
                        })
                    }}
                    flagCount={corrections.filter(c => c.reference.startsWith('flag-')).length}
                />
            )}

            {/* Post-sermon review — show flagged moments with transcript context and verse input */}
            {!isListening && transcript && corrections.length > 0 && (
                <div className="border-t border-[var(--border-subtle)] pt-2">
                    <button
                        onClick={() => setShowReview(!showReview)}
                        className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded transition-colors"
                    >
                        <span className="flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {corrections.length} correction{corrections.length !== 1 ? 's' : ''} recorded
                        </span>
                        <div className="flex items-center gap-1">
                            {unsyncCount > 0 && (
                                <span className="flex items-center gap-0.5 text-[9px] text-gray-400">
                                    <CloudOff className="w-2.5 h-2.5" />
                                    {unsyncCount} unsynced
                                </span>
                            )}
                            {showReview ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </div>
                    </button>
                    {showReview && (
                        <PostSermonReview
                            corrections={corrections}
                            rawUtterances={rawUtterances}
                            onAddVerseReference={(correctionId, verseRef) => {
                                const existing = corrections.find(c => c.id === correctionId)
                                if (existing) {
                                    removeCorrection(correctionId).then(() => {
                                        addCorrection(verseRef, {
                                            originalReference: existing.reference.startsWith('flag-') ? undefined : existing.reference,
                                            correctionType: existing.correctionType,
                                            closestRawText: existing.closestRawText,
                                        })
                                    })
                                }
                            }}
                            onRemove={removeCorrection}
                            syncStatus={syncStatus}
                            unsyncCount={unsyncCount}
                        />
                    )}
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
                            {/* Notes is the only always-visible action — it's a unique workflow
                                (AI summary) so it deserves prime placement. Export/Copy/Save/Clear
                                live in a "⋯" menu to keep the header from overflowing. */}
                            {transcript && (
                                <button
                                    onClick={handleGenerateNotes}
                                    disabled={isGeneratingNotes}
                                    className="flex items-center gap-1 text-[10px] text-[var(--accent-teal)] hover:brightness-110 disabled:opacity-50"
                                    title="Generate sermon notes"
                                >
                                    {isGeneratingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <NotebookPen className="w-3 h-3" />}
                                    {isGeneratingNotes ? 'Generating…' : 'Notes'}
                                </button>
                            )}
                            {transcript && (
                                <div className="relative" ref={exportPickerRef}>
                                    <button
                                        onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                                        className="flex items-center justify-center w-6 h-6 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                        title="More actions"
                                        aria-label="More transcript actions"
                                    >
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                    </button>
                                    {showOverflowMenu && (
                                        <div className="absolute right-0 top-7 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 min-w-[160px]">
                                            <button
                                                onClick={() => { setShowOverflowMenu(false); setShowExportPicker(!showExportPicker) }}
                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <Download className="w-3 h-3" />
                                                Export…
                                            </button>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(transcript)
                                                        .then(() => {
                                                            setShowOverflowMenu(false)
                                                            setSaveMessage({ type: 'success', text: 'Transcript copied' })
                                                            setTimeout(() => setSaveMessage(null), 2000)
                                                        })
                                                        .catch(() => {})
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <Copy className="w-3 h-3" />
                                                Copy to clipboard
                                            </button>
                                            <button
                                                onClick={() => { setShowOverflowMenu(false); setShowSaveDialog(true) }}
                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <Save className="w-3 h-3" />
                                                Save…
                                            </button>
                                            <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                                            <button
                                                onClick={() => { setShowOverflowMenu(false); reset() }}
                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/5"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                Clear transcript
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div
                        ref={transcriptRef}
                        className={`flex-1 p-2 rounded text-xs overflow-y-auto bg-white dark:bg-gray-900 transition-all duration-200 ${isSpeechDetected ? 'border border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.1)]' : ''}`}
                    >
                        {transcriptSegments.length > 0 ? (
                            <div className="space-y-1.5 text-gray-700 dark:text-gray-300">
                                {transcriptSegments.map((seg, i) => {
                                    const minutes = Math.floor(seg.startMs / 60000)
                                    const seconds = Math.floor((seg.startMs % 60000) / 1000)
                                    const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`
                                    const isLastInterim = i === transcriptSegments.length - 1 && interimTranscript && !transcript.includes(interimTranscript)
                                    return (
                                        <p key={seg.id} className={`leading-relaxed ${isLastInterim ? 'italic text-gray-400 dark:text-gray-500' : ''}`}>
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mr-1 select-none">{timeLabel}</span>
                                            {seg.text}
                                            {isLastInterim && ` ${interimTranscript}`}
                                        </p>
                                    )
                                })}
                            </div>
                        ) : transcript ? (
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
                        <div className="flex items-center gap-2">
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
                            <button
                                onClick={() => setSermonNotes('')}
                                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                title="Close notes"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
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
                                                {t._isOffline && (
                                                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400">
                                                        <CloudOff className="w-2.5 h-2.5" />
                                                        offline
                                                    </span>
                                                )}
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

function MissedVerseTapButton({ onFlag, flagCount }: { onFlag: (timestamp: number) => void; flagCount: number }) {
    const [justFlagged, setJustFlagged] = useState(false)

    const handleTap = () => {
        onFlag(Date.now())
        setJustFlagged(true)
        setTimeout(() => setJustFlagged(false), 1200)
    }

    return (
        <button
            onClick={handleTap}
            className={`w-full px-2 py-1.5 rounded text-[10px] font-medium transition-all border flex items-center justify-center gap-1 ${
                justFlagged
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-300 text-green-600 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/20'
            }`}
            title="One tap to flag a missed verse — add the reference after the sermon"
        >
            {justFlagged ? (
                <>
                    <Check className="w-3 h-3" />
                    Flagged {flagCount + 1}
                </>
            ) : (
                <>
                    <AlertCircle className="w-3 h-3" />
                    Missed a verse? Tap to flag
                    {flagCount > 0 && <span className="ml-1 bg-amber-200 dark:bg-amber-800 px-1 rounded">{flagCount}</span>}
                </>
            )}
        </button>
    )
}

function PostSermonReview({
    corrections,
    rawUtterances,
    onAddVerseReference,
    onRemove,
    syncStatus,
    unsyncCount,
}: {
    corrections: SermonCorrection[]
    rawUtterances: Array<{ text: string; timestamp: number; confidence?: number }>
    onAddVerseReference: (correctionId: string, verseRef: string) => void
    onRemove: (id: string) => Promise<void>
    syncStatus: 'idle' | 'syncing' | 'done'
    unsyncCount: number
}) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [verseInput, setVerseInput] = useState('')

    const getTranscriptContext = (timestamp: number) => {
        const nearby = rawUtterances
            .filter(u => Math.abs(u.timestamp - timestamp) < 8000)
            .map(u => u.text)
            .join(' ')
        return nearby ? nearby.slice(-200) : '(no transcript at this moment)'
    }

    const formatTime = (ts: number) => {
        const d = new Date(ts)
        return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
    }

    return (
        <div className="px-1 py-1 space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
            {corrections.map(c => {
                const isFlag = c.reference.startsWith('flag-')
                const timestamp = isFlag ? parseInt(c.reference.replace('flag-', ''), 10) : c.timestamp
                const context = c.closestRawText || (isFlag ? getTranscriptContext(timestamp) : '')

                return (
                    <div key={c.id} className="bg-gray-50 dark:bg-gray-800 rounded p-1.5 space-y-1">
                        <div className="flex items-center gap-1">
                            <span className={`px-1 py-0.5 rounded text-[8px] font-medium ${
                                c.correctionType === 'missed' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                : c.correctionType === 'wrong-verse' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            }`}>
                                {c.correctionType === 'missed' ? 'Missed' : c.correctionType === 'wrong-verse' ? 'Wrong v.' : 'Wrong b.'}
                            </span>
                            {isFlag ? (
                                <span className="text-[9px] text-gray-400 font-mono">{formatTime(timestamp)}</span>
                            ) : (
                                <span className="text-[10px] text-gray-700 dark:text-gray-300 font-medium truncate">{c.reference}</span>
                            )}
                            <div className="flex-1" />
                            <button
                                onClick={() => onRemove(c.id)}
                                className="text-gray-400 hover:text-red-500 transition-colors"
                                title="Remove"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>

                        {context && (
                            <p className="text-[9px] text-gray-500 dark:text-gray-400 italic truncate" title={context}>
                                "{context}"
                            </p>
                        )}

                        {isFlag && (
                            <div className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={editingId === c.id ? verseInput : ''}
                                    onChange={(e) => setVerseInput(e.target.value)}
                                    onFocus={() => {
                                        setEditingId(c.id)
                                        setVerseInput('')
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && verseInput.trim()) {
                                            onAddVerseReference(c.id, verseInput.trim())
                                            setEditingId(null)
                                            setVerseInput('')
                                        }
                                    }}
                                    placeholder="e.g. Matthew 5:3"
                                    className="flex-1 px-1.5 py-0.5 text-[10px] border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:ring-1 focus:ring-[var(--accent-teal)] focus:border-[var(--accent-teal)] outline-none"
                                />
                                <button
                                    onClick={() => {
                                        if (verseInput.trim()) {
                                            onAddVerseReference(c.id, verseInput.trim())
                                            setEditingId(null)
                                            setVerseInput('')
                                        }
                                    }}
                                    disabled={!editingId || !verseInput.trim()}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--accent-teal)] text-white disabled:opacity-30"
                                >
                                    ✓
                                </button>
                            </div>
                        )}

                        {c.originalReference && !isFlag && (
                            <span className="text-[9px] text-gray-400">was: {c.originalReference}</span>
                        )}
                    </div>
                )
            })}

            {syncStatus === 'syncing' && (
                <div className="flex items-center gap-1 text-[9px] text-gray-400 px-2 py-0.5">
                    <Cloud className="w-3 h-3 animate-pulse" />
                    Syncing...
                </div>
            )}
            {unsyncCount > 0 && syncStatus !== 'syncing' && (
                <div className="flex items-center gap-1 text-[9px] text-gray-400 px-2 py-0.5">
                    <CloudOff className="w-3 h-3" />
                    {unsyncCount} correction{unsyncCount !== 1 ? 's' : ''} will sync when online
                </div>
            )}
        </div>
    )
}

export default SermonListenerPanel