import { useState } from 'react'
import { Book, BookOpen, Filter, Send, Trash2, ChevronDown, ChevronUp, Mic } from 'lucide-react'
import { useSermonListenerContext } from './SermonListenerContext'
import { useAppStore } from '../../store/appStore'
import { formatVerseForDisplay } from '../../services/sermon-listener/verseDetection'
import type { BibleVerse } from '../../types'

export function DetectedVersesBar() {
    const sermonListener = useSermonListenerContext()
    const openBibleFromSermon = useAppStore((s) => s.openBibleFromSermon)
    const [showOnlyBestMatches, setShowOnlyBestMatches] = useState(true)
    const [isExpanded, setIsExpanded] = useState(true)

    if (!sermonListener) return null

    const {
        detectedVerses,
        currentVerse,
        currentScripture,
        isListening,
        isSpeechDetected,
    } = sermonListener

    const uniqueDetectedVerses = detectedVerses.filter(
        (verse, index, arr) => arr.findIndex(v => v.reference === verse.reference) === index
    )

    if (uniqueDetectedVerses.length === 0 && !isListening) return null

    const displayedVerses = showOnlyBestMatches
        ? uniqueDetectedVerses.filter(v => v.isBestMatch)
        : uniqueDetectedVerses

    const handleLookupInBible = (verse: typeof detectedVerses[0]) => {
        const ref = verse.verseEnd && verse.verseEnd !== verse.verseStart
            ? `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
            : `${verse.book} ${verse.chapter}:${verse.verseStart}`
        openBibleFromSermon(ref)
    }

    return (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/30">
            {/* Header bar */}
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    {isListening && (
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                        </span>
                    )}
                    <Mic className={`w-3.5 h-3.5 ${isListening ? 'text-red-500' : 'text-[var(--accent-amber)]'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-amber)]">
                        Detected Verses
                    </span>
                    {uniqueDetectedVerses.length > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] rounded-full">
                            {showOnlyBestMatches
                                ? uniqueDetectedVerses.filter(v => v.isBestMatch).length
                                : uniqueDetectedVerses.length
                            }
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {uniqueDetectedVerses.length > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowOnlyBestMatches(!showOnlyBestMatches) }}
                            className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] transition-colors ${
                                showOnlyBestMatches
                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                            }`}
                        >
                            <Filter className="w-2.5 h-2.5" />
                            {showOnlyBestMatches ? 'Confirmed' : 'All'}
                        </button>
                    )}
                {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                )}
                </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
                <div className="px-3 pb-2 space-y-2">
                    {/* Current verse card */}
                    {currentVerse && currentScripture && (
                        <div className="p-2 rounded-lg border bg-[var(--accent-teal)]/5 border-[var(--accent-teal)]/30">
                            <div className="flex items-center justify-between mb-1">
                                <h4 className="font-semibold text-xs text-[var(--accent-teal)]">
                                    {formatVerseForDisplay(currentVerse)}
                                </h4>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleLookupInBible(currentVerse)}
                                        className="flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-[var(--accent-teal)] rounded text-[10px] hover:bg-[var(--accent-teal)]/10 transition-all"
                                        title="Look up in Bible"
                                    >
                                        <BookOpen className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={() => sermonListener.displayCurrentVerse()}
                                        className="flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--accent-teal)] text-white rounded text-[10px] hover:brightness-110 shadow-sm"
                                    >
                                        <Send className="w-3 h-3" />
                                        Live
                                    </button>
                                </div>
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] max-h-16 overflow-y-auto leading-relaxed">
                                {Array.isArray(currentScripture.content) && currentScripture.content.slice(0, 3).map((verse: BibleVerse, idx: number) => (
                                    <p key={idx} className="mb-0.5">
                                        <sup className="text-[9px] text-[var(--accent-teal)] mr-0.5">{verse.verse}</sup>
                                        {verse.scripture}
                                    </p>
                                ))}
                                {Array.isArray(currentScripture.content) && currentScripture.content.length > 3 && (
                                    <p className="text-[9px] text-[var(--text-muted)]">+{currentScripture.content.length - 3} more</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Verse chips */}
                    {displayedVerses.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {displayedVerses.map((verse, idx) => (
                                <div
                                    key={`${verse.reference}-${idx}`}
                                    className={`group flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] cursor-pointer transition-colors ${
                                        currentVerse?.reference === verse.reference
                                            ? 'bg-[var(--accent-teal)] text-white'
                                            : verse.isBestMatch
                                                ? 'bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)]'
                                                : 'bg-[var(--bg-tertiary)]/50 hover:bg-[var(--accent-teal)]/10 text-[var(--text-muted)] border border-[var(--border-subtle)]'
                                    }`}
                                    onClick={() => sermonListener.setCurrentDetectedVerse(verse)}
                                >
                                    <Book className="w-2.5 h-2.5" />
                                    <span>{formatVerseForDisplay(verse)}</span>
                                    {!verse.isBestMatch && (
                                        <span className="text-[8px] opacity-60 ml-0.5">?</span>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleLookupInBible(verse) }}
                                        className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                                            currentVerse?.reference === verse.reference
                                                ? 'text-white/70 hover:text-white'
                                                : 'text-[var(--text-muted)] hover:text-[var(--accent-teal)]'
                                        }`}
                                        title="Look up in Bible"
                                    >
                                        <BookOpen className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); sermonListener.removeVerse(verse) }}
                                        className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                                            currentVerse?.reference === verse.reference
                                                ? 'text-white/70 hover:text-white'
                                                : 'text-[var(--text-muted)] hover:text-red-500'
                                        }`}
                                    >
                                        <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Empty listening state */}
                    {uniqueDetectedVerses.length === 0 && isListening && (
                        <div className="flex items-center gap-1.5 py-1 text-[10px] text-[var(--text-muted)]">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                            </span>
                            {isSpeechDetected ? 'Detecting verses…' : 'Listening for verses…'}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}