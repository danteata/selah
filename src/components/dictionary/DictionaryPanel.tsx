import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookA, Loader2, Plus, Zap, History, Layers } from 'lucide-react'
import { useDictionary, useDictionaryPacks } from '../../hooks/useDictionary'
import { useResultNavigation } from '../../hooks/useResultNavigation'
import { useSendToAlternate } from '../../hooks/useSendToAlternate'
import { useScripture, useSlideCreation, useAnalytics } from '../../hooks'
import { useGoLive } from '../../hooks/useGoLive'
import { useVoiceSearch } from '../../hooks/useVoiceSearch'
import { VoiceSearchButton } from '../common/VoiceSearchButton'
import { TemplateSelector } from '../templates/TemplateSelector'
import { AnalyticsEventType } from '../../services/analytics/types'
import { formatHeadword, searchDictionaries, type DictionaryMatch } from '../../lib/search/dictionarySearch'
import { parseFullBibleReference, formatReferenceQuery } from '../../utils/bibleReference'
import { DictionaryEntryView } from './DictionaryEntryView'
import type { TemplateItem } from '../../hooks/useTemplates'
import type { DictionaryEntry, DictionaryPack } from '../../types'

const RECENT_LOOKUPS_KEY = 'selah-recent-dictionary-lookups'
const MAX_RECENT = 8

/** How many results get their definitions hydrated for the preview snippets. */
const SNIPPET_BATCH = 12

interface RecentLookup {
    packId: string
    key: string
    word: string
}

function readRecentLookups(): RecentLookup[] {
    try {
        const raw = localStorage.getItem(RECENT_LOOKUPS_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : []
    } catch {
        return []
    }
}

interface DictionaryPanelProps {
    onClose: () => void
    isInline?: boolean
    initialQuery?: string
}

export function DictionaryPanel({ onClose, isInline = false, initialQuery = '' }: DictionaryPanelProps) {
    const [query, setQuery] = useState(initialQuery)
    const [activePackId, setActivePackId] = useState<string | null>(null)
    const [matches, setMatches] = useState<DictionaryMatch[]>([])
    const [snippets, setSnippets] = useState<Map<string, DictionaryEntry>>(new Map())
    const [selected, setSelected] = useState<DictionaryEntry | null>(null)
    const [searching, setSearching] = useState(false)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [recent, setRecent] = useState<RecentLookup[]>(() => readRecentLookups())

    const { packs, loading: packsLoading } = useDictionaryPacks()
    const { loadIndex, getEntry } = useDictionary()
    const { createDictionarySlides, createBibleSlide } = useSlideCreation()
    const { fetchScripture } = useScripture()
    const { canGoLive, addToQueue, addAndGoLive } = useGoLive()
    const { trackEvent } = useAnalytics()
    const alternate = useSendToAlternate()

    const packsById = useMemo(
        () => new Map(packs.map((pack) => [pack.id, pack])),
        [packs],
    )

    // Bible dictionaries first: in a church, "Aaron" means the priest before it
    // means anything Webster's has to say. Within a kind, manifest order wins.
    const orderedPacks = useMemo(() => {
        const rank: Record<DictionaryPack['kind'], number> = { bible: 0, lexicon: 1, english: 2 }
        return [...packs].sort((a, b) => rank[a.kind] - rank[b.kind])
    }, [packs])

    const searchPacks = useMemo(
        () => activePackId ? orderedPacks.filter((pack) => pack.id === activePackId) : orderedPacks,
        [orderedPacks, activePackId],
    )

    const voice = useVoiceSearch({
        onFinal: (text) => setQuery(text),
    })

    // Warm the indexes as soon as the panel opens. Webster's is 102k headwords
    // — about a second to fetch and parse — and that second belongs to opening
    // the panel, not to the operator's first keystroke mid-service.
    useEffect(() => {
        for (const pack of packs) void loadIndex(pack.id)
    }, [packs, loadIndex])

    // Run the search. Cheap enough per keystroke — an index lookup is a binary
    // search, and the indexes are cached after the first load — so there's no
    // debounce, but `cancelled` guards the async index/definition fetches.
    const searchPackIds = useMemo(() => searchPacks.map((p) => p.id).join(','), [searchPacks])

    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed || searchPacks.length === 0) {
            setMatches([])
            setSnippets(new Map())
            // Clearing the box mid-search must also clear the spinner, or the
            // next search that finds nothing shows it instead of "no entries".
            setSearching(false)
            return
        }

        let cancelled = false
        setSearching(true)

        const run = async () => {
            const indexes = (await Promise.all(searchPacks.map((pack) => loadIndex(pack.id))))
                .filter((index): index is NonNullable<typeof index> => !!index)
            if (cancelled) return

            const found = searchDictionaries(indexes, trimmed, { packOrder: searchPacks })
            setMatches(found)
            setSearching(false)

            // Hydrate the top results so rows can show a definition snippet.
            // Prefix matches share a first letter, so this is usually one shard
            // fetch per pack — and cached from then on.
            const hydrated = await Promise.all(
                found.slice(0, SNIPPET_BATCH).map(async (match) => {
                    const entry = await getEntry(match.record.packId, match.record.key)
                    return entry ? [`${match.record.packId}:${match.record.key}`, entry] as const : null
                }),
            )
            if (cancelled) return
            setSnippets(new Map(hydrated.filter((pair): pair is NonNullable<typeof pair> => !!pair)))
        }

        void run()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, searchPackIds, loadIndex, getEntry])

    const rememberLookup = useCallback((entry: DictionaryEntry) => {
        setRecent((previous) => {
            const next = [
                { packId: entry.packId, key: entry.key, word: entry.word },
                ...previous.filter((item) => !(item.packId === entry.packId && item.key === entry.key)),
            ].slice(0, MAX_RECENT)
            try {
                localStorage.setItem(RECENT_LOOKUPS_KEY, JSON.stringify(next))
            } catch {
                // Private-mode storage failure just means no history.
            }
            return next
        })
    }, [])

    const openEntry = useCallback(async (packId: string, key: string) => {
        const entry = await getEntry(packId, key)
        if (!entry) return
        setSelected(entry)
        rememberLookup(entry)
        trackEvent(AnalyticsEventType.DICTIONARY_ENTRY_VIEWED, {
            pack: packId,
            word: entry.word,
            sense_count: entry.senses.length,
            reference_count: entry.refs?.length ?? 0,
        })
    }, [getEntry, rememberLookup, trackEvent])

    /** Queue (or project) an entry — the whole thing, or a single sense. */
    const queueEntry = useCallback((
        entry: DictionaryEntry,
        { goLive, senseIndex }: { goLive: boolean; senseIndex?: number },
    ) => {
        const slides = createDictionarySlides(entry, {
            pack: packsById.get(entry.packId),
            template: selectedTemplate,
            senseIndex,
        })
        if (slides.length === 0) return

        if (goLive) addAndGoLive(slides)
        else addToQueue(slides)

        rememberLookup(entry)
        trackEvent(AnalyticsEventType.DICTIONARY_SLIDE_CREATED, {
            pack: entry.packId,
            word: entry.word,
            slide_count: slides.length,
            went_live: goLive,
            whole_entry: senseIndex === undefined,
            has_template: !!selectedTemplate,
        })
    }, [createDictionarySlides, packsById, selectedTemplate, addAndGoLive, addToQueue, rememberLookup, trackEvent])

    /** Turn a reference cited by an entry into a Bible slide. */
    const queueReference = useCallback(async (reference: string, goLive: boolean) => {
        const parsed = parseFullBibleReference(reference)
        if (!parsed) {
            console.warn(`Could not parse dictionary reference "${reference}"`)
            return
        }

        const scripture = await fetchScripture(
            `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`,
        )
        if (!scripture) return

        const slide = createBibleSlide(scripture)
        if (goLive) addAndGoLive([slide])
        else addToQueue([slide])

        trackEvent(AnalyticsEventType.DICTIONARY_REFERENCE_USED, {
            reference: formatReferenceQuery(parsed.bookIndex, parsed.chapter, parsed.startVerse, parsed.endVerse),
            went_live: goLive,
        })
    }, [fetchScripture, createBibleSlide, addAndGoLive, addToQueue, trackEvent])

    const searchInputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!isInline) searchInputRef.current?.focus()
    }, [isInline])

    /** Put an entry on the alternate output — Add and Live's third peer. */
    const sendEntryToAlternate = useCallback(async (match: DictionaryMatch) => {
        const cacheKey = `${match.record.packId}:${match.record.key}`
        const entry = snippets.get(cacheKey) ?? await getEntry(match.record.packId, match.record.key)
        if (!entry) return
        const slides = createDictionarySlides(entry, {
            pack: packsById.get(entry.packId),
            template: selectedTemplate,
        })
        // One slide only: the output holds a single slide, so a multi-sense entry
        // sends its first card rather than silently dropping the rest.
        if (slides[0]) alternate.send(slides[0])
    }, [snippets, getEntry, createDictionarySlides, packsById, selectedTemplate, alternate])

    // Quick-add straight from a result row, without opening the entry.
    const quickUse = useCallback(async (match: DictionaryMatch, goLive: boolean) => {
        const cacheKey = `${match.record.packId}:${match.record.key}`
        const entry = snippets.get(cacheKey) ?? await getEntry(match.record.packId, match.record.key)
        if (entry) queueEntry(entry, { goLive })
    }, [snippets, getEntry, queueEntry])

    // Same keyboard contract as the Bible panel: the best match is highlighted
    // as soon as results appear, Enter presents it, Shift+Enter queues it.
    const { focusedIndex, setFocusedIndex, handleKeyDown, listRef } = useResultNavigation<HTMLDivElement>({
        count: matches.length,
        resetKey: `${query}:${matches.length}`,
        onActivate: (index, { queue }) => {
            const match = matches[index]
            if (match) void quickUse(match, !queue)
        },
        enabled: !selected,
    })

    if (selected) {
        return (
            <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg">
                <DictionaryEntryView
                    entry={selected}
                    pack={packsById.get(selected.packId)}
                    canGoLive={canGoLive}
                    onBack={() => setSelected(null)}
                    onUse={(options) => queueEntry(selected, options)}
                    onUseReference={queueReference}
                />
                <div className="flex-shrink-0 px-3 pb-3">
                    <TemplateSelector
                        slideType="dictionary"
                        selectedTemplate={selectedTemplate}
                        onSelect={setSelectedTemplate}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg" onKeyDown={handleKeyDown}>
            {!isInline && (
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-semibold">Dictionary</h2>
                    <button
                        onClick={onClose}
                        className="text-xs text-[var(--accent-teal)] hover:underline font-medium"
                    >
                        Close
                    </button>
                </div>
            )}

            {/* Search */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={voice.isListening ? voice.transcript : query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={voice.isListening ? 'Listening…' : 'Define a word, name or place…'}
                        aria-label="Search the dictionary"
                        className="w-full pl-9 pr-10 py-2 text-sm border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <VoiceSearchButton
                            isListening={voice.isListening}
                            isSupported={voice.isSupported}
                            error={voice.error}
                            onClick={voice.isListening ? voice.stop : voice.start}
                        />
                    </div>
                </div>

                {/* Pack filter */}
                {packs.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        <PackChip
                            label="All"
                            active={activePackId === null}
                            onClick={() => setActivePackId(null)}
                        />
                        {orderedPacks.map((pack) => (
                            <PackChip
                                key={pack.id}
                                label={pack.shortName}
                                title={`${pack.name}${pack.year ? ` (${pack.year})` : ''} — ${pack.entryCount.toLocaleString()} entries`}
                                active={activePackId === pack.id}
                                onClick={() => setActivePackId(activePackId === pack.id ? null : pack.id)}
                            />
                        ))}
                    </div>
                )}

                {/* The template decides the slide's layout and styling, so it has to
                    be choosable where Add / Live / Alt are — not only inside an
                    opened entry, which is where it used to live. */}
                {packs.length > 0 && (
                    <div className="mt-2">
                        <TemplateSelector
                            slideType="dictionary"
                            selectedTemplate={selectedTemplate}
                            onSelect={setSelectedTemplate}
                        />
                    </div>
                )}

                {/* Same hint the Bible panel carries, so the keyboard contract is
                    discoverable rather than folklore. */}
                {matches.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--text-muted)]">
                        <span>Enter = Present</span>
                        <span>Shift+Enter = Add to queue</span>
                        <span>↑↓ Navigate</span>
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto" ref={listRef}>
                {packsLoading ? (
                    <div className="p-8 flex items-center justify-center text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                ) : packs.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        <BookA className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">No dictionaries installed</p>
                        <p className="text-xs mt-1 text-gray-400">
                            Run <code>npm run build-dictionary-packs</code> to bundle them.
                        </p>
                    </div>
                ) : !query.trim() ? (
                    <RecentLookups
                        recent={recent}
                        packsById={packsById}
                        onOpen={openEntry}
                    />
                ) : matches.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        {searching ? (
                            <Loader2 className="w-5 h-5 mx-auto animate-spin opacity-60" />
                        ) : (
                            <>
                                <BookA className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                <p className="text-sm">No entries for “{query.trim()}”</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-800">
                        {matches.map((match, index) => {
                            const cacheKey = `${match.record.packId}:${match.record.key}`
                            const entry = snippets.get(cacheKey)
                            const pack = packsById.get(match.record.packId)
                            const isFocused = focusedIndex === index

                            return (
                                <div
                                    key={cacheKey}
                                    data-result-index={index}
                                    onMouseEnter={() => setFocusedIndex(index)}
                                    className={`flex items-start justify-between gap-2 px-3 py-2.5 transition-colors group ${
                                        isFocused
                                            ? 'bg-[var(--accent-teal)]/8 ring-1 ring-inset ring-[var(--accent-teal)]/20'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                                    }`}
                                >
                                    <button
                                        onClick={() => openEntry(match.record.packId, match.record.key)}
                                        className="flex-1 min-w-0 text-left"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                                {formatHeadword(match.record.word)}
                                            </span>
                                            {pack && (
                                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                                    {pack.shortName}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                                            {entry?.senses[0]?.text ?? '…'}
                                        </p>
                                    </button>
                                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => quickUse(match, false)}
                                            className="p-1.5 rounded-lg text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10"
                                            title="Add to queue"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        {alternate.canSend && (
                                            <button
                                                onClick={() => void sendEntryToAlternate(match)}
                                                className="p-1.5 rounded-lg text-[var(--accent-indigo)] hover:bg-[var(--accent-indigo)]/10"
                                                title="Send to the alternate output"
                                            >
                                                <Layers className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        {canGoLive && (
                                            <button
                                                onClick={() => quickUse(match, true)}
                                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10"
                                                title="Send to live output"
                                            >
                                                <Zap className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

function PackChip({ label, title, active, onClick }: {
    label: string
    title?: string
    active: boolean
    onClick: () => void
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-pressed={active}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${active
                ? 'bg-[var(--accent-teal)] text-white'
                : 'bg-[var(--bg-tertiary)] text-gray-600 dark:text-gray-300 hover:bg-[var(--accent-teal)]/15'
                }`}
        >
            {label}
        </button>
    )
}

function RecentLookups({ recent, packsById, onOpen }: {
    recent: RecentLookup[]
    packsById: Map<string, DictionaryPack>
    onOpen: (packId: string, key: string) => void
}) {
    if (recent.length === 0) {
        return (
            <div className="p-6 text-center text-gray-500">
                <BookA className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Search a word to define it on screen</p>
                <p className="text-xs mt-1 text-gray-400">
                    Bible names and places, Greek and Hebrew terms, or plain English.
                </p>
            </div>
        )
    }

    return (
        <div className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
                <History className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Recent lookups
                </span>
            </div>
            <div className="flex flex-wrap gap-1">
                {recent.map((item) => (
                    <button
                        key={`${item.packId}:${item.key}`}
                        onClick={() => onOpen(item.packId, item.key)}
                        className="px-2 py-1 rounded-md text-[11px] font-medium bg-[var(--bg-tertiary)] text-gray-700 dark:text-gray-300 hover:bg-[var(--accent-teal)]/15 hover:text-[var(--accent-teal)] transition-colors"
                        title={packsById.get(item.packId)?.name}
                    >
                        {formatHeadword(item.word)}
                    </button>
                ))}
            </div>
        </div>
    )
}
