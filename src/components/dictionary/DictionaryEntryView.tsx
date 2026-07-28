import { useCallback } from 'react'
import { ChevronLeft, Plus, Zap, BookOpen } from 'lucide-react'
import { formatHeadword } from '../../lib/search/dictionarySearch'
import type { DictionaryEntry, DictionaryPack } from '../../types'

interface DictionaryEntryViewProps {
    entry: DictionaryEntry
    pack?: DictionaryPack
    canGoLive: boolean
    onBack: () => void
    /** Queue (or go live with) the whole entry, or one sense of it. */
    onUse: (options: { goLive: boolean; senseIndex?: number }) => void
    /** Project a scripture reference the entry cites. */
    onUseReference: (reference: string, goLive: boolean) => void
}

export function DictionaryEntryView({
    entry,
    pack,
    canGoLive,
    onBack,
    onUse,
    onUseReference,
}: DictionaryEntryViewProps) {
    const headword = formatHeadword(entry.word)

    const senseCount = entry.senses.length
    const addWholeEntry = useCallback((goLive: boolean) => onUse({ goLive }), [onUse])

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="p-3">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 mb-3 text-xs font-medium text-[var(--accent-teal)] hover:underline"
                >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back to results
                </button>

                {/* Headword */}
                <div className="mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white break-words">
                        {headword}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {entry.transliteration && entry.transliteration !== entry.word && (
                            <span className="italic">{entry.transliteration}</span>
                        )}
                        {entry.strongs && (
                            <span className="font-mono text-[11px]">{entry.strongs}</span>
                        )}
                        {pack && (
                            <span>
                                {pack.name}
                                {pack.year ? ` (${pack.year})` : ''}
                            </span>
                        )}
                    </div>
                </div>

                {/* Whole-entry actions */}
                <div className="flex items-center gap-1.5 mb-4">
                    <button
                        onClick={() => addWholeEntry(false)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--accent-teal)] bg-[var(--accent-teal)]/10 hover:bg-[var(--accent-teal)]/20 transition-colors"
                        title="Add the whole definition to the queue"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add {senseCount > 1 ? 'all' : ''}
                    </button>
                    {canGoLive && (
                        <button
                            onClick={() => addWholeEntry(true)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
                            title="Send to live output"
                        >
                            <Zap className="w-3.5 h-3.5" />
                            Live
                        </button>
                    )}
                </div>

                {/* Senses — each independently projectable, because a preacher
                    usually wants one meaning, not the whole article. */}
                <div className="space-y-3">
                    {entry.senses.map((sense, index) => (
                        <div
                            key={index}
                            className="group rounded-lg border border-[var(--border-subtle)] p-2.5 hover:border-[var(--accent-teal)]/40 transition-colors"
                        >
                            <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                    {sense.label || (senseCount > 1 ? `Sense ${index + 1}` : 'Definition')}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => onUse({ goLive: false, senseIndex: index })}
                                        className="p-1 rounded text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10"
                                        title="Add this sense to the queue"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                    {canGoLive && (
                                        <button
                                            onClick={() => onUse({ goLive: true, senseIndex: index })}
                                            className="p-1 rounded text-red-500 hover:bg-red-500/10"
                                            title="Send this sense live"
                                        >
                                            <Zap className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                {sense.text}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Scripture references — the reason a Bible dictionary belongs
                    in a projection app: the entry names the passages, and one
                    click puts them on screen in the church's own version. */}
                {entry.refs && entry.refs.length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                Scriptures ({entry.refs.length})
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {entry.refs.map((reference) => (
                                <button
                                    key={reference}
                                    onClick={(event) => onUseReference(reference, event.shiftKey && canGoLive)}
                                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--bg-tertiary)] text-gray-700 dark:text-gray-300 hover:bg-[var(--accent-teal)]/15 hover:text-[var(--accent-teal)] transition-colors"
                                    title={canGoLive
                                        ? `Add ${reference} to the queue (shift-click to go live)`
                                        : `Add ${reference} to the queue`}
                                >
                                    {reference}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Attribution — Easton's/Smith's are CC BY and Strong's JSON is
                    CC BY-SA, so the credit has to be visible somewhere. */}
                {pack && (
                    <p className="mt-5 pt-2.5 border-t border-[var(--border-subtle)] text-[10px] leading-relaxed text-gray-400">
                        {pack.attribution}
                    </p>
                )}

            </div>
        </div>
    )
}
