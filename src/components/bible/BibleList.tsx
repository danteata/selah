import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { Search, ChevronLeft, ChevronRight, BookOpen, Zap, Plus, X, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { generateSlideContent, calculateScreenFontSize, useScripture, useSlideCreation, useSemanticVerseSearch, useLiveSession } from '../../hooks'
import { useVoiceSearch } from '../../hooks/useVoiceSearch'
import { VoiceSearchButton } from '../common/VoiceSearchButton'
import { useAppStore } from '../../store/appStore'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import { useTemplates } from '../../hooks/useTemplates'
import { TemplateSelector } from '../templates/TemplateSelector'
import { DetectedVersesBar } from '../sermon-listener/DetectedVersesBar'
import {
    detectVoiceCommands,
    stripCommandsFromTranscript,
    type VoiceCommand,
} from '../../services/sermon-listener/voiceCommandDetection'
import type { Scripture, BibleVerse } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'
import { bibleBooks, bibleVersionObjects } from '../../types'
import { parseBibleQuery, getBookSuggestions as getBookSuggestionsUtil, buildVerseRows as buildVerseRowsUtil, normalizeBibleReference, type BibleVerseLike } from '../../utils/bibleReference'
import type { VerseRow as VerseRowType } from '../../utils/bibleReference'

const RECENT_VERSES_KEY = 'selah-recent-verses'
const MAX_RECENT = 5

interface BibleListProps {
    initialQuery?: string
    onClose: () => void
    isInline?: boolean
}

type VerseRow = VerseRowType

export function BibleList({ initialQuery = '', onClose, isInline = false }: BibleListProps) {
    const { trackEvent } = useAnalytics()
    const biblePanelQuery = useAppStore((state) => state.biblePanelQuery)
    const setBiblePanelQuery = useAppStore((state) => state.setBiblePanelQuery)
    const [query, setQuery] = useState(initialQuery || biblePanelQuery || '')
    const [loading, setLoading] = useState(false)
    const [selectedVersion, setSelectedVersion] = useState<string>('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [currentBookIndex, setCurrentBookIndex] = useState<number | null>(null)
    const [currentChapter, setCurrentChapter] = useState<number | null>(null)
    const [currentStartVerse, setCurrentStartVerse] = useState<number | null>(null)
    const [currentEndVerse, setCurrentEndVerse] = useState<number | null>(null)
    const [currentVerses, setCurrentVerses] = useState<BibleVerse[]>([])
    const [neighborVerses, setNeighborVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [hasSearched, setHasSearched] = useState(false)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [focusedIndex, setFocusedIndex] = useState(-1)
    const [activeVerseKey, setActiveVerseKey] = useState<string | null>(null)
    const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const navigatingRef = useRef(false)
    const lastSearchedRef = useRef<{ bookIndex: number; chapter: number; startVerse: number; endVerse: number } | null>(null)
    // Per-command-type debounce so a single utterance that contains
    // both a command and trailing text (e.g. "next verse, and
    // also show me John 3:16") doesn't double-fire the same
    // navigation. Mirrors the pattern the sermon listener uses.
    const lastVoiceCommandAtRef = useRef<Map<string, number>>(new Map())
    // Voice command handler needs `goLiveWithScripture`, which is
    // defined further down in the file. Using a ref breaks the
    // déclaration-order dependency so the voice search hook can
    // be set up at the top of the component.
    const goLiveWithScriptureRef = useRef<
        ((bookIndex: number, chapter: number, verse: number, preText?: string) => Promise<void>) | null
    >(null)
    // Same pattern for `applyVersionChange` — see comment above.
    const applyVersionChangeRef = useRef<
        ((versionId: string) => Promise<boolean>) | null
    >(null)
    // Same pattern for `loadVerseWithNeighbors` — voice commands need
    // to mirror "go live" with the same list-view update that a
    // keyboard search would produce.
    const loadVerseWithNeighborsRef = useRef<
        ((bookIndex: number, chapter: number, verse: number) => Promise<void>) | null
    >(null)
    const [recentVerses, setRecentVerses] = useState<string[]>(() => {
        try {
            const stored = localStorage.getItem(RECENT_VERSES_KEY)
            return stored ? JSON.parse(stored) : []
        } catch { return [] }
    })

    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    // Voice search — streams interim transcripts into the query input,
    // commits the final text on session end so the user can review and
    // edit (e.g. "John 3 16" → "John 3:16") before pressing Enter.
    //
    // Also dispatches voice commands when the transcript contains one.
    // We reuse the sermon listener's `detectVoiceCommands` module —
    // it already handles the "next verse" / "previous verse" /
    // "go to verse 7" / "open Psalm 23" / "switch to NIV" families of
    // commands. The key contextual difference: in the sermon listener,
    // "go to verse 7" means "the 7th verse of the currently-detected
    // passage"; here, it means "the 7th verse of the currently
    // displayed chapter" — which is what the user actually wants
    // when they say "verse 7" while looking at Psalm 23.
    const handleVoiceCommand = useCallback((cmd: VoiceCommand) => {
        // Read goLiveWithScripture through a ref — it lives further
        // down in the file but we need to call it here.
        const goLive = goLiveWithScriptureRef.current
        // Read context through a ref too. The context helper falls
        // back to the live slide when BibleList's own state is
        // empty, so "next verse" / "verse 5" work even when the user
        // has not yet done a typed search.
        const ctx = getLiveBibleContextRef.current()
        console.warn('[bible-list] dispatching voice command:', cmd.type, 'context:', ctx, 'goLiveAvailable:', !!goLive)
        if (!goLive) return
        switch (cmd.type) {
            case 'next_verse': {
                if (ctx) {
                    const nextVerse = ctx.endVerse + 1
                    goLive(ctx.bookIndex, ctx.chapter, nextVerse)
                }
                break
            }
            case 'previous_verse': {
                if (ctx) {
                    const prevVerse = Math.max(1, ctx.startVerse - 1)
                    goLive(ctx.bookIndex, ctx.chapter, prevVerse)
                }
                break
            }
            case 'next_chapter': {
                if (ctx) {
                    // The hook is opinionated about "next" — if we're
                    // already mid-chapter, jump to chapter+1 verse 1.
                    // If we're at chapter 1 verse 1, this still feels
                    // right (advance to chapter 2).
                    goLive(ctx.bookIndex, ctx.chapter + 1, 1)
                }
                break
            }
            case 'previous_chapter': {
                if (ctx && ctx.chapter > 1) {
                    goLive(ctx.bookIndex, ctx.chapter - 1, 1)
                }
                break
            }
            case 'go_to_verse': {
                // Context-aware: "verse 7" while reading Psalm 23
                // means the 7th verse of Psalm 23. If we have any
                // context (live slide or typed search), use it;
                // otherwise drop into the search box so the user
                // can pick a book.
                if (ctx && cmd.targetVerse && cmd.targetVerse >= 1) {
                    goLive(ctx.bookIndex, ctx.chapter, cmd.targetVerse)
                } else if (cmd.targetVerse) {
                    setQuery(`verse ${cmd.targetVerse}`)
                    setShowSuggestions(true)
                }
                break
            }
            case 'go_to_reference': {
                if (cmd.book && cmd.chapter) {
                    const bookIndex =
                        bibleBooks.findIndex(
                            (b) => b.toLowerCase() === cmd.book!.toLowerCase(),
                        ) + 1
                    if (bookIndex > 0) {
                        // Honor the verse the detector captured
                        // ("John 3:16" → verse 16, not 1). Fall back
                        // to verse 1 if the detector only matched
                        // book+chapter (existing behavior).
                        goLive(bookIndex, cmd.chapter, cmd.verse ?? 1)
                    }
                } else if (cmd.book) {
                    setQuery(cmd.book)
                    setShowSuggestions(true)
                }
                break
            }
            case 'change_version': {
                // Mirrors useSermonListener.applyBibleVersionChange:
                // update the local version state, re-fetch the
                // current verse in the new translation, push the
                // updated slide live. The detection module has
                // already resolved nicknames like "King James"
                // → "KJV" before the command reaches us, so
                // cmd.versionId is always the canonical id.
                if (cmd.versionId && applyVersionChangeRef.current) {
                    void applyVersionChangeRef.current(cmd.versionId)
                }
                break
            }
            case 'display': {
                // "display this verse" — no-op here because the
                // currently-displayed verse IS already on screen.
                break
            }
            // The control commands (start_listening, stop_listening)
            // are handled by the hook itself; nothing to do here.
            default:
                break
        }
    }, [])

    const voice = useVoiceSearch({
        onFinal: (text) => {
            // 1) Detect voice commands first. If the transcript is
            //    primarily a command ("next verse", "verse 7",
            //    "open Psalm 23", "switch to NIV"), execute it and
            //    skip the Bible-reference normalization.
            const commands = detectVoiceCommands(text)
            console.warn('[bible-list] voice final transcript:', JSON.stringify(text), 'commands:', commands.map(c => `${c.type}(${c.confidence})`))
            if (commands.length > 0) {
                // The first command wins — same policy as the
                // sermon listener. Strip it from the transcript so
                // any leftover text (e.g. "next verse John") is
                // visible to the user but doesn't pollute the
                // search box.
                const stripped = stripCommandsFromTranscript(text, commands)
                if (stripped) {
                    setQuery(stripped)
                    setShowSuggestions(true)
                } else {
                    setQuery('')
                }
                // Debounce: don't fire the same command type twice
                // within 1.2s (speech recognition can fire the
                // final event twice on slow networks).
                for (const cmd of commands) {
                    const lastRun = lastVoiceCommandAtRef.current.get(cmd.type) ?? 0
                    if (Date.now() - lastRun < 1200) continue
                    lastVoiceCommandAtRef.current.set(cmd.type, Date.now())
                    handleVoiceCommand(cmd)
                }
                return
            }

            // 2) No command — fall through to the original flow.
            //    Speech recognition routinely drops punctuation,
            //    so a spoken "John 3 16" lands as "John 3 16".
            //    Normalize it back to "John 3:16" so the existing
            //    parser matches without the user having to edit.
            const normalized = normalizeBibleReference(text)
            setQuery(normalized)
            setShowSuggestions(true)
            inputRef.current?.focus()
        },
    })

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    // NOTE: there are two setLiveSlide functions in play here.
    //   - useAppStore.setLiveSlide updates ONLY the local store (offline
    //     preview / fallback when no session is connected).
    //   - useLiveSession().setLiveSlide is the broadcast version: it
    //     updates the local store AND pushes the change to Convex so
    //     every other connected device sees the same live slide.
    // The Bible panel must use the broadcast version when a live session
    // is active, otherwise contributors clicking 'Live' on a Bible verse
    // see the slide go live only on their own device.
    const setLiveSlideLocal = useAppStore((s) => s.setLiveSlide)
    const updateActiveSlide = useAppStore((s) => s.updateActiveSlide)
    const defaultBibleVersion = useAppStore((s) => s.settings.defaultBibleVersion)
    const { templates, getTemplatesForSlideType } = useTemplates()
    const bibleTemplates = getTemplatesForSlideType('bible')
    const {
        setLiveSlide: setLiveSlideShared,
        addToQueue: addToSharedQueue,
        isConnected,
        isOperator,
        isOpen,
        isStrict,
    } = useLiveSession()

    // Decide which setLiveSlide to call so the rest of the file reads
    // naturally. When a live session is connected, we go through the
    // broadcast version (which also updates the local store as a side
    // effect). Otherwise we fall back to the local-only setter.
    const setLiveSlide = isConnected ? setLiveSlideShared : setLiveSlideLocal

    const {
        results: semanticResults,
        isSearching: isSemanticSearching,
        hasEmbeddings,
        isEmbedderReady,
        isLoadingEmbedder,
        search: semanticSearch,
        clearResults: clearSemanticResults,
        initEmbedder,
    } = useSemanticVerseSearch({
        threshold: 0.35,
        limit: 8,
        debounceMs: 250,
        minQueryLength: 3,
        version: selectedVersion || undefined,
    })

    useEffect(() => {
        if (!selectedVersion) setSelectedVersion(defaultBibleVersion || 'KJV')
    }, [defaultBibleVersion, selectedVersion])

    // Mirrors useSermonListener's `applyBibleVersionChange` for the
    // voice command. Re-fetches the currently displayed verse in
    // the new version and updates the live slide so the operator's
    // live-output window reflects the new translation. We resolve
    // common nicknames ("KJV" → "King James Version", etc.) the
    // same way the sermon listener does, so voice commands like
    // "switch to King James" and "switch to KJV" both work.
    const applyVersionChange = useCallback(async (versionId: string): Promise<boolean> => {
        // Resolve the id (e.g. "king james" → "KJV") — the detection
        // module returns the canonical id but defensive code here
        // never hurts.
        const resolvedVersionId = versionId || selectedVersion
        if (!resolvedVersionId) return false
        setSelectedVersion(resolvedVersionId)
        // If the user has not searched the Bible panel yet, fall
        // back to whatever verse is currently on the live output.
        // Without this fallback, "switch to NIV" with no prior
        // search would silently update only the dropdown and the
        // live slide would keep rendering the old version.
        const ctx = getLiveBibleContextRef.current()
        if (!ctx) {
            return true
        }
        const label = `${ctx.bookIndex}:${ctx.chapter}:${ctx.startVerse}${ctx.endVerse !== ctx.startVerse ? `-${ctx.endVerse}` : ''
            }`
        const scripture = await fetchScripture(label, resolvedVersionId)
        if (scripture) {
            updateCurrentLiveBibleSlide(scripture)
        }
        return true
    }, [
        selectedVersion,
        fetchScripture,
    ])

    useEffect(() => {
        if (hasEmbeddings && !isEmbedderReady) initEmbedder()
    }, [hasEmbeddings, isEmbedderReady, initEmbedder])

    useEffect(() => { inputRef.current?.focus() }, [])

    useEffect(() => {
        if (biblePanelQuery) { setQuery(biblePanelQuery); setBiblePanelQuery('') }
    }, [biblePanelQuery, setBiblePanelQuery])

    useEffect(() => { setFocusedIndex(-1) }, [semanticResults, currentVerses, neighborVerses])
    useEffect(() => {
        const rows = buildVerseRows()
        if (rows.length === 0 || focusedIndex !== -1) return
        if (hasSearched) {
            const currentIdx = rows.findIndex(r => r.isCurrent)
            setFocusedIndex(currentIdx >= 0 ? currentIdx : 0)
        } else if (semanticResults.length > 0) {
            setFocusedIndex(0)
        }
    })

    const bookSuggestions = useMemo(() => {
        return getBookSuggestionsUtil(query)
    }, [query])

    const parseQuery = useCallback((q: string) => {
        return parseBibleQuery(q)
    }, [])

    const addRecentVerse = useCallback((ref: string) => {
        setRecentVerses(prev => {
            const next = [ref, ...prev.filter(v => v !== ref)].slice(0, MAX_RECENT)
            try { localStorage.setItem(RECENT_VERSES_KEY, JSON.stringify(next)) } catch { }
            return next
        })
    }, [])

    // Single source of truth for 'go live with a Bible verse'. Mirrors
    // the broadcast pattern in LiveOutput.handleSetLiveSlide so that
    // clicking 'Live' on a Bible verse is visible to every other
    // connected device in the live session, not just the clicker's
    // own browser tab.
    const pushBibleSlideLive = useCallback((slide: ReturnType<typeof createBibleSlide>) => {
        if (!slide) return
        // Gate on collaboration mode: in non-open modes a non-operator
        // cannot push to live (they can only queue).
        if (isConnected && !isOperator && !isOpen) return

        appendActiveSlide(slide)
        setLiveSlide(slide.id)
        // Cross-window sync (operator + projection windows) — the same
        // event LiveOutput dispatches when its own controls change the
        // live slide. The handler in AppShell updates the live preview
        // window in real time.
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        return true
    }, [appendActiveSlide, setLiveSlide, isConnected, isOperator, isOpen])

    const goLiveWithScripture = useCallback(async (bookIndex: number, chapter: number, verse: number, preText?: string) => {
        // Reveal the verse in the BibleList view (sets the search
        // box, populates currentVerses / neighbors, etc.) so the
        // operator can see exactly what they just sent live. This
        // also keeps the voice-command context (currentBookIndex /
        // currentChapter) in sync with the live output so the next
        // "next verse" / "verse 5" command has an anchor even
        // without falling back to the live slide.
        if (loadVerseWithNeighborsRef.current) {
            void loadVerseWithNeighborsRef.current(bookIndex, chapter, verse)
        }
        const label = `${bookIndex}:${chapter}:${verse}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            trackEvent(AnalyticsEventType.BIBLE_VERSE_SELECTED, {
                version: selectedVersion,
                book: bookIndex,
                chapter,
                verse,
                source: 'go_live',
            })
            const slide = createBibleSlide(result, { template: selectedTemplate })
            if (pushBibleSlideLive(slide)) {
                addRecentVerse(result.label || '')
            }
            setActiveVerseKey(`${bookIndex}:${chapter}:${verse}`)
        } else if (preText) {
            const bookName = bibleBooks[bookIndex - 1] || 'Reference'
            const fallback: Scripture = {
                label: `${bookName} ${chapter}:${verse}`,
                labelShortFormat: `${bookIndex}:${chapter}:${verse}`,
                version: selectedVersion,
                content: preText,
            }
            trackEvent(AnalyticsEventType.BIBLE_VERSE_SELECTED, {
                version: selectedVersion,
                book: bookIndex,
                chapter,
                verse,
                source: 'go_live_fallback',
            })
            const slide = createBibleSlide(fallback, { template: selectedTemplate })
            if (pushBibleSlideLive(slide)) {
                addRecentVerse(fallback.label)
            }
            setActiveVerseKey(`${bookIndex}:${chapter}:${verse}`)
        }
    }, [fetchScripture, selectedVersion, createBibleSlide, selectedTemplate, pushBibleSlideLive, addRecentVerse, trackEvent])

    // Mirror the function into the ref so the voice command
    // handler (defined higher up) can call it without a TDZ error.
    goLiveWithScriptureRef.current = goLiveWithScripture
    applyVersionChangeRef.current = applyVersionChange
    // (loadVerseWithNeighborsRef is set right after the function
    // is declared further down — see below — to avoid a TDZ error
    // on first render.)

    // Context fallback for voice commands. When the user opens
    // BibleList and says "next verse" or "verse 5" before doing a
    // search, the local `currentBookIndex` / `currentChapter` state
    // is null and navigation commands have no anchor. Fall back to
    // reading context from the currently-live Bible slide (if any)
    // so the voice command is always actionable.
    const getLiveBibleContext = useCallback((): {
        bookIndex: number
        chapter: number
        startVerse: number
        endVerse: number
    } | null => {
        if (currentBookIndex && currentChapter && currentStartVerse) {
            return {
                bookIndex: currentBookIndex,
                chapter: currentChapter,
                startVerse: currentStartVerse,
                endVerse: currentEndVerse ?? currentStartVerse,
            }
        }
        const { activeSlides, liveSlideId } = useAppStore.getState()
        const liveSlide = activeSlides.find((s) => s.id === liveSlideId)
        if (!liveSlide || liveSlide.type !== 'bible') return null
        const data = liveSlide.data as Scripture | undefined
        if (!data?.labelShortFormat) return null
        // labelShortFormat is "bookIndex:chapter:startVerse" or
        // "bookIndex:chapter:startVerse-endVerse".
        const match = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/.exec(data.labelShortFormat)
        if (!match) return null
        return {
            bookIndex: parseInt(match[1], 10),
            chapter: parseInt(match[2], 10),
            startVerse: parseInt(match[3], 10),
            endVerse: match[4] ? parseInt(match[4], 10) : parseInt(match[3], 10),
        }
    }, [currentBookIndex, currentChapter, currentStartVerse, currentEndVerse])

    const getLiveBibleContextRef = useRef(getLiveBibleContext)
    getLiveBibleContextRef.current = getLiveBibleContext

    const updateCurrentLiveBibleSlide = useCallback((scripture: Scripture) => {
        const { activeSlides, liveSlideId } = useAppStore.getState()
        const liveSlide = activeSlides.find((slide) => slide.id === liveSlideId)

        if (!liveSlide || liveSlide.type !== 'bible') return false

        // Recompute font size from the new scripture's own content — a slide
        // that previously held a long, illegible range must not keep that
        // tiny font size after being narrowed to fewer verses.
        const contentString = typeof scripture.content === 'string'
            ? scripture.content
            : Array.isArray(scripture.content)
                ? scripture.content.map((v) => v.scripture).join(' ')
                : ''
        const displayVerseNumbers = Array.isArray(scripture.content)
            ? scripture.content.map((v) => Number(v.verse))
            : undefined

        const updatedSlide = {
            ...liveSlide,
            name: scripture.label || liveSlide.name,
            data: scripture,
            contents: generateSlideContent(liveSlide, scripture),
            displayVerseNumbers,
            slideStyle: {
                ...liveSlide.slideStyle,
                fontSize: Number(calculateScreenFontSize(contentString)),
            },
        }

        updateActiveSlide(updatedSlide)
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))
        return true
    }, [updateActiveSlide])

    const addToQueue = useCallback(async (bookIndex: number, chapter: number, verse: number, preText?: string) => {
        const label = `${bookIndex}:${chapter}:${verse}`
        const result = await fetchScripture(label, selectedVersion)
        let slide = null
        if (result) {
            slide = createBibleSlide(result, { template: selectedTemplate })
        } else if (preText) {
            const bookName = bibleBooks[bookIndex - 1] || 'Reference'
            const fallback: Scripture = {
                label: `${bookName} ${chapter}:${verse}`,
                labelShortFormat: `${bookIndex}:${chapter}:${verse}`,
                version: selectedVersion,
                content: preText,
            }
            slide = createBibleSlide(fallback, { template: selectedTemplate })
        }
        if (slide) {
            appendActiveSlide(slide)
            addRecentVerse(result?.label || `${bookIndex}:${chapter}:${verse}`)
            if (isConnected && !isStrict) {
                try {
                    await addToSharedQueue([slide.id])
                } catch (err) {
                    console.error('[BibleList] Failed to add slide to shared queue:', err)
                }
            }
        }
    }, [fetchScripture, selectedVersion, createBibleSlide, selectedTemplate, appendActiveSlide, addRecentVerse, isConnected, isStrict, addToSharedQueue])

    const loadVerseWithNeighbors = useCallback(async (bookIndex: number, chapter: number, verse: number) => {
        navigatingRef.current = true
        lastSearchedRef.current = { bookIndex, chapter, startVerse: verse, endVerse: verse }
        setLoading(true)
        setHasSearched(true)
        setNeighborVerses({ prev: [], next: [] })
        setFocusedIndex(-1)
        setQuery(`${bibleBooks[bookIndex - 1]} ${chapter}:${verse}`)
        clearSemanticResults()

        const label = `${bookIndex}:${chapter}:${verse}`
        const result = await fetchScripture(label, selectedVersion)
        if (result && Array.isArray(result.content)) {
            setCurrentVerses(result.content as BibleVerse[])
            setCurrentBookIndex(bookIndex)
            setCurrentChapter(chapter)
            setCurrentStartVerse(verse)
            setCurrentEndVerse(verse)
            setActiveVerseKey(`${bookIndex}:${chapter}:${verse}`)
        }
        setLoading(false)
        navigatingRef.current = false

        const prevStart = Math.max(1, verse - 3)
        const prevP = prevStart < verse ? fetchScripture(`${bookIndex}:${chapter}:${prevStart}-${verse - 1}`, selectedVersion) : Promise.resolve(null)
        const nextP = fetchScripture(`${bookIndex}:${chapter}:${verse + 1}-${verse + 3}`, selectedVersion)
        Promise.all([prevP, nextP]).then(([pr, nr]) => {
            setNeighborVerses({
                prev: pr && Array.isArray(pr.content) ? pr.content as BibleVerse[] : [],
                next: nr && Array.isArray(nr.content) ? nr.content as BibleVerse[] : [],
            })
        })
    }, [fetchScripture, selectedVersion, clearSemanticResults])

    // Mirror `loadVerseWithNeighbors` into the ref NOW that the
    // function is defined. Voice commands earlier in the file
    // reach for it through the ref so the TDZ is avoided.
    loadVerseWithNeighborsRef.current = loadVerseWithNeighbors

    const handleSearch = useCallback(async () => {
        const parsed = parseQuery(query)
        if (!parsed) return
        if (lastSearchedRef.current && lastSearchedRef.current.bookIndex === parsed.bookIndex && lastSearchedRef.current.chapter === parsed.chapter && lastSearchedRef.current.startVerse === parsed.startVerse && lastSearchedRef.current.endVerse === parsed.endVerse) return
        lastSearchedRef.current = { bookIndex: parsed.bookIndex, chapter: parsed.chapter, startVerse: parsed.startVerse, endVerse: parsed.endVerse }
        setLoading(true)
        setHasSearched(true)
        setNeighborVerses({ prev: [], next: [] })
        setFocusedIndex(-1)
        trackEvent(AnalyticsEventType.BIBLE_SEARCH_PERFORMED, {
            method: 'text',
            query_length: query.length,
            version: selectedVersion,
        })
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        const result = await fetchScripture(label, selectedVersion)
        if (result && Array.isArray(result.content)) {
            setCurrentVerses(result.content as BibleVerse[])
            setCurrentBookIndex(parsed.bookIndex)
            setCurrentChapter(parsed.chapter)
            setCurrentStartVerse(parsed.startVerse)
            setCurrentEndVerse(parsed.endVerse)
            setActiveVerseKey(`${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}`)
        }
        setLoading(false)
        const { bookIndex, chapter, startVerse, endVerse } = parsed
        const prevStart = Math.max(1, startVerse - 3)
        const prevPromise = prevStart < startVerse
            ? fetchScripture(`${bookIndex}:${chapter}:${prevStart}-${startVerse - 1}`, selectedVersion)
            : Promise.resolve(null)
        const nextPromise = fetchScripture(`${bookIndex}:${chapter}:${endVerse + 1}-${endVerse + 3}`, selectedVersion)
        Promise.all([prevPromise, nextPromise]).then(([prevResult, nextResult]) => {
            setNeighborVerses({
                prev: prevResult && Array.isArray(prevResult.content) ? prevResult.content as BibleVerse[] : [],
                next: nextResult && Array.isArray(nextResult.content) ? nextResult.content as BibleVerse[] : [],
            })
        })
        setShowSuggestions(false)
    }, [query, parseQuery, fetchScripture, selectedVersion, trackEvent])

    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed || !selectedVersion) return
        if (navigatingRef.current) return
        if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current)

        const parsed = parseQuery(trimmed)
        if (parsed) {
            if (lastSearchedRef.current && lastSearchedRef.current.bookIndex === parsed.bookIndex && lastSearchedRef.current.chapter === parsed.chapter && lastSearchedRef.current.startVerse === parsed.startVerse && lastSearchedRef.current.endVerse === parsed.endVerse) return
            autoSearchTimerRef.current = setTimeout(() => {
                if (!navigatingRef.current) handleSearch()
            }, 500)
            // Don't clear semantic results when regex matches — let both display
        } else if (trimmed.length >= 3 && hasEmbeddings && isEmbedderReady) {
            semanticSearch(trimmed)
        } else {
            clearSemanticResults()
        }

        return () => { if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current) }
    }, [query, selectedVersion, hasEmbeddings, semanticSearch, clearSemanticResults, parseQuery, handleSearch])

    const navigateVerse = useCallback(async (direction: 'prev' | 'next') => {
        if (!currentBookIndex || !currentChapter || !currentStartVerse) return
        const range = (currentEndVerse || currentStartVerse) - currentStartVerse + 1
        let newStart: number, newEnd: number
        if (direction === 'prev') {
            newStart = Math.max(1, currentStartVerse - range)
            newEnd = newStart + range - 1
        } else {
            newStart = (currentEndVerse || currentStartVerse) + 1
            newEnd = newStart + range - 1
        }

        navigatingRef.current = true
        lastSearchedRef.current = { bookIndex: currentBookIndex, chapter: currentChapter, startVerse: newStart, endVerse: newEnd }

        setLoading(true)
        setHasSearched(true)
        setNeighborVerses({ prev: [], next: [] })
        setFocusedIndex(-1)

        const label = `${currentBookIndex}:${currentChapter}:${newStart}${newEnd !== newStart ? `-${newEnd}` : ''}`
        const result = await fetchScripture(label, selectedVersion)

        if (result && Array.isArray(result.content)) {
            setCurrentVerses(result.content as BibleVerse[])
            setCurrentStartVerse(newStart)
            setCurrentEndVerse(newEnd)
            setActiveVerseKey(`${currentBookIndex}:${currentChapter}:${newStart}`)

            updateCurrentLiveBibleSlide(result)
        }

        setLoading(false)
        navigatingRef.current = false

        const prevStart = Math.max(1, newStart - 3)
        const prevP = prevStart < newStart ? fetchScripture(`${currentBookIndex}:${currentChapter}:${prevStart}-${newStart - 1}`, selectedVersion) : Promise.resolve(null)
        const nextP = fetchScripture(`${currentBookIndex}:${currentChapter}:${newEnd + 1}-${newEnd + 3}`, selectedVersion)

        Promise.all([prevP, nextP]).then(([pr, nr]) => {
            setNeighborVerses({
                prev: pr && Array.isArray(pr.content) ? pr.content as BibleVerse[] : [],
                next: nr && Array.isArray(nr.content) ? nr.content as BibleVerse[] : [],
            })
        })
    }, [currentBookIndex, currentChapter, currentStartVerse, currentEndVerse, fetchScripture, selectedVersion, updateCurrentLiveBibleSlide])

    const changeVersion = useCallback((newVersion: string) => {
        trackEvent(AnalyticsEventType.BIBLE_VERSION_CHANGED, {
            old_version: selectedVersion,
            new_version: newVersion,
        })
        setSelectedVersion(newVersion)
        if (hasSearched) setTimeout(() => handleSearch(), 0)
    }, [hasSearched, handleSearch, selectedVersion, trackEvent])

    const buildVerseRows = useCallback((): VerseRow[] => {
        return buildVerseRowsUtil(
            hasSearched,
            currentBookIndex,
            currentChapter,
            currentVerses as unknown as BibleVerseLike[],
            {
                prev: neighborVerses.prev as unknown as BibleVerseLike[],
                next: neighborVerses.next as unknown as BibleVerseLike[],
            },
            semanticResults,
        )
    }, [hasSearched, currentBookIndex, currentChapter, currentVerses, neighborVerses, semanticResults])

    const verseRows = useMemo(() => buildVerseRows(), [buildVerseRows])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (focusedIndex >= 0 && verseRows.length > 0) {
                const row = verseRows[focusedIndex]
                if (row.source === 'semantic') {
                    loadVerseWithNeighbors(row.bookIndex, row.chapter, row.verse)
                    if (e.shiftKey) goLiveWithScripture(row.bookIndex, row.chapter, row.verse, row.scripture)
                } else if (e.shiftKey) {
                    goLiveWithScripture(row.bookIndex, row.chapter, row.verse, row.scripture)
                } else {
                    addToQueue(row.bookIndex, row.chapter, row.verse, row.scripture)
                }
            } else if (!hasSearched) {
                handleSearch()
            }
        } else if (e.key === 'ArrowDown') {
            if (verseRows.length > 0) {
                e.preventDefault()
                setFocusedIndex(prev => (prev + 1) % verseRows.length)
            }
        } else if (e.key === 'ArrowUp') {
            if (verseRows.length > 0) {
                e.preventDefault()
                setFocusedIndex(prev => prev <= 0 ? verseRows.length - 1 : prev - 1)
            }
        } else if (e.key === 'Escape') {
            if (hasSearched) {
                setHasSearched(false)
                setCurrentVerses([])
                setNeighborVerses({ prev: [], next: [] })
                setFocusedIndex(-1)
            } else {
                onClose()
            }
        } else if (e.key === 'Tab') {
            e.preventDefault()
            const ci = bibleVersionObjects.findIndex(v => v.id === selectedVersion)
            setSelectedVersion(bibleVersionObjects[(ci + 1) % bibleVersionObjects.length].id)
        }
    }, [focusedIndex, verseRows, hasSearched, handleSearch, goLiveWithScripture, addToQueue, loadVerseWithNeighbors, onClose, selectedVersion])

    const handleRecentVerseClick = useCallback((ref: string) => {
        setQuery(ref)
        setHasSearched(false)
        setCurrentVerses([])
        setNeighborVerses({ prev: [], next: [] })
        setTimeout(() => handleSearch(), 0)
    }, [handleSearch])

    const handleRecentVerseGoLive = useCallback(async (ref: string) => {
        const parsed = parseQuery(ref)
        if (!parsed) return
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            const slide = createBibleSlide(result, { template: null })
            if (pushBibleSlideLive(slide)) {
                addRecentVerse(ref)
            }
        }
    }, [parseQuery, fetchScripture, selectedVersion, createBibleSlide, pushBibleSlideLive, addRecentVerse])

    const downloadedVersions = useMemo(() => bibleVersionObjects.filter(v => v.isDownloaded), [])

    return (
        <div className="h-full flex flex-col bg-[var(--bg-secondary)] rounded-lg">
            {!isInline && (
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ChevronLeft className="w-5 h-5" /></button>
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Display Bible</h2>
                    </div>
                </div>
            )}

            {/* Recent Verses Strip */}
            {recentVerses.length > 0 && (
                <div className="px-3 pt-3 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] shrink-0 mr-0.5">Recent</span>
                    {recentVerses.map((ref) => (
                        <button key={ref} onClick={() => handleRecentVerseClick(ref)} className="group relative px-2 py-0.5 text-[11px] font-medium bg-[var(--bg-tertiary)]/70 hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded-full border border-[var(--border-subtle)] transition-colors">
                            {ref}
                            <span onClick={(e) => { e.stopPropagation(); handleRecentVerseGoLive(ref) }} className="ml-1 inline-flex text-[var(--accent-teal)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="Present">
                                <Zap className="w-2.5 h-2.5" />
                            </span>
                        </button>
                    ))}
                    <button onClick={() => { setRecentVerses([]); try { localStorage.removeItem(RECENT_VERSES_KEY) } catch { } }} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">clear</button>
                </div>
            )}

            {/* Search bar — always visible */}
            <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                <div className="relative flex items-center gap-2">
                    <select value={selectedVersion} onChange={(e) => changeVersion(e.target.value)} className="shrink-0 px-2 py-2.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none appearance-none cursor-pointer">
                        {bibleVersionObjects.map((v) => (<option key={v.id} value={v.id}>{v.id}</option>))}
                    </select>
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] w-4 h-4" />
                        <input ref={inputRef} type="text" value={voice.isListening ? voice.transcript : query} onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); if (hasSearched) { setHasSearched(false); setCurrentVerses([]); setNeighborVerses({ prev: [], next: [] }) } }} onKeyDown={handleKeyDown} onFocus={() => setShowSuggestions(true)} placeholder={voice.isListening ? 'Listening…' : 'e.g. John 3:16 or "God so loved"'} className="w-full pl-9 pr-20 py-2.5 border border-[var(--border-default)] rounded-lg focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-all placeholder:text-[var(--text-muted)]" />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                            {query && (
                                <button
                                    onClick={() => { setQuery(''); setHasSearched(false); setCurrentVerses([]); setNeighborVerses({ prev: [], next: [] }) }}
                                    className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    aria-label="Clear search"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                            <VoiceSearchButton
                                isListening={voice.isListening}
                                isSupported={voice.isSupported}
                                error={voice.error}
                                onClick={() => {
                                    console.warn('[bible-list] mic button clicked, isListening:', voice.isListening, 'isSupported:', voice.isSupported)
                                    if (voice.isListening) voice.stop()
                                    else voice.start()
                                }}
                            />
                        </div>
                    </div>
                </div>

                {showSuggestions && bookSuggestions.length > 0 && !hasSearched && (
                    <div className="relative mt-2">
                        <div className="absolute top-0 left-0 right-0 bg-[var(--bg-elevated)] rounded-lg shadow-lg border border-[var(--border-default)] z-10">
                            {bookSuggestions.map((book) => (<button key={book} onClick={() => { setQuery(book + ' '); inputRef.current?.focus() }} className="w-full text-left px-4 py-2 hover:bg-[var(--accent-teal)]/5 text-[var(--text-primary)] text-sm">{book}</button>))}
                        </div>
                    </div>
                )}

                {/* Voice search error — shown briefly when the recognition session
                    fails to start (no mic, permission denied, etc.). The button
                    tooltip carries the same text for users who don't notice. */}
                {voice.error && (
                    <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                        {voice.error}
                        <button
                            onClick={voice.reset}
                            className="ml-1 underline text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            dismiss
                        </button>
                    </div>
                )}

                {/* Nav controls when verse is loaded */}
                {hasSearched && currentBookIndex && currentChapter && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center gap-1">
                            <button onClick={() => navigateVerse('prev')} className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                            <button onClick={() => navigateVerse('next')} className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronRight className="w-4 h-4" /></button>
                            <span className="text-xs font-semibold text-[var(--text-primary)] ml-1">{bibleBooks[currentBookIndex - 1]} {currentChapter}:{currentStartVerse}{currentEndVerse !== currentStartVerse ? `-${currentEndVerse}` : ''}</span>
                            <span className="text-[10px] text-[var(--accent-teal)] ml-1">{selectedVersion}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {downloadedVersions.slice(0, 4).map((v) => (<button key={v.id} onClick={() => changeVersion(v.id)} className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${selectedVersion === v.id ? 'bg-[var(--accent-teal)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--accent-teal)]/10'}`}>{v.id}</button>))}
                        </div>
                    </div>
                )}

                <details className="group mt-2 text-[10px] text-[var(--text-muted)]">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]">
                        Shortcuts
                        <span className="transition-transform group-open:rotate-90">&gt;</span>
                    </summary>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                        <span>Auto-searches as you type</span>
                        <span>Enter = Add</span>
                        <span>Shift+Enter = Live</span>
                        <span>↑↓ Navigate</span>
                    </div>
                </details>
            </div>

            {/* Detected Verses from Sermon Listener */}
            <DetectedVersesBar />

            {/* Results list — unified for both reference search and semantic search */}
            <div
                className="flex-1 min-h-0 overflow-y-auto"
                ref={scrollRef}
                onMouseLeave={() => setFocusedIndex(-1)}
            >
                {loading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--text-muted)]">
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-teal)]" /> Loading...
                    </div>
                )}

                {verseRows.length > 0 && !loading && (
                    <div className="px-2 py-1 space-y-1">
                        {hasSearched && (
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-teal)] px-1 py-1">
                                {bibleBooks[currentBookIndex! - 1]} {currentChapter}
                            </div>
                        )}
                        {!hasSearched && (
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-teal)] px-1 py-1">Search Results</div>
                        )}
                        {verseRows.map((row, index) => {
                            const verseKey = `${row.bookIndex}:${row.chapter}:${row.verse}`
                            const isActive = activeVerseKey === verseKey
                            const isHovered = focusedIndex === index
                            const handleRowClick = () => loadVerseWithNeighbors(row.bookIndex, row.chapter, row.verse)
                            return (
                                <Fragment key={verseKey}>
                                    {row.showChapterHeader && row.chapterHeaderLabel && (
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-indigo)] px-1 pt-2 pb-0.5 flex items-center gap-1">
                                            <BookOpen className="w-3 h-3" />
                                            {row.chapterHeaderLabel}
                                        </div>
                                    )}
                                    <motion.div
                                        layout
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.02, layout: { duration: 0.2 } }}
                                        className={`group rounded-xl border transition-colors cursor-pointer ${isActive
                                            ? 'bg-[var(--accent-teal)]/12 border-[var(--accent-teal)]/35 ring-1 ring-[var(--accent-teal)]/25'
                                            : row.isCurrent
                                                ? 'bg-[var(--accent-teal)]/8 border-[var(--accent-teal)]/20'
                                                : isHovered
                                                    ? 'bg-[var(--accent-teal)]/5 border-[var(--accent-teal)]/15'
                                                    : 'border-transparent hover:bg-[var(--accent-teal)]/5'
                                            }`}
                                        onClick={handleRowClick}
                                        onMouseEnter={() => setFocusedIndex(index)}
                                    >
                                        <div className="px-3 py-2.5">
                                            <div className="flex items-start gap-2 mb-1">
                                                <span className={`text-sm font-bold shrink-0 leading-5 tabular-nums ${isActive || row.isCurrent ? 'text-[var(--accent-teal)]' : 'text-[var(--text-secondary)]'}`}>
                                                    {row.displayLabel}
                                                </span>
                                                {row.source === 'semantic' && row.score !== undefined && (
                                                    <span className="text-[10px] text-[var(--accent-teal)] font-medium opacity-80">{Math.round(row.score * 100)}% Match</span>
                                                )}
                                                {isActive && (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-[var(--accent-teal)] text-white rounded font-medium">LIVE</span>
                                                )}
                                                {row.isCurrent && !isActive && (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-[var(--accent-teal)]/15 text-[var(--accent-teal)] rounded font-medium">CURRENT</span>
                                                )}
                                                <div className={`ml-auto flex items-center gap-1 shrink-0 ${row.isCurrent || isActive || isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                    } transition-opacity`}>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); addToQueue(row.bookIndex, row.chapter, row.verse, row.scripture) }}
                                                        className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded-md transition-colors"
                                                    >
                                                        <Plus className="w-3 h-3" /> Add
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            goLiveWithScripture(row.bookIndex, row.chapter, row.verse, row.scripture)
                                                            if (row.source === 'semantic') loadVerseWithNeighbors(row.bookIndex, row.chapter, row.verse)
                                                        }}
                                                        className={`flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium rounded transition-all ${isActive
                                                            ? 'bg-red-500 text-white hover:brightness-110'
                                                            : 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white'
                                                            }`}
                                                    >
                                                        <Zap className="w-3 h-3" /> Live
                                                    </button>
                                                </div>
                                            </div>
                                            <p className={`text-xs leading-relaxed ${isActive || row.isCurrent ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                                                {row.scripture}
                                            </p>
                                        </div>
                                    </motion.div>
                                </Fragment>
                            )
                        })}

                        {/* Template Selector */}
                        <TemplateSelector
                            slideType="bible"
                            selectedTemplate={selectedTemplate}
                            onSelect={setSelectedTemplate}
                        />
                    </div>
                )}

                {isSemanticSearching && !loading && verseRows.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-teal)]" /> Searching verses...
                    </div>
                )}

                {isSemanticSearching && !loading && verseRows.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
                        <Loader2 className="w-3 h-3 animate-spin text-[var(--accent-teal)]" /> Finding related verses...
                    </div>
                )}

                {verseRows.length === 0 && !loading && !isSemanticSearching && (
                    <div className="p-4 text-center text-[var(--text-tertiary)]">
                        <BookOpen className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
                        <p className="font-medium text-[var(--text-secondary)]">Quick Bible Search</p>
                        <p className="text-sm mt-1 text-[var(--text-muted)]">Type a verse reference above to get started</p>
                        <div className="mt-4 text-xs text-[var(--text-muted)] space-y-0.5">
                            <p>Examples: John 3:16, Jn 3:16-18, Ps 23:1</p>
                            {hasEmbeddings && isEmbedderReady && <p className="text-[var(--accent-teal)] mt-2">Or search by meaning, e.g. &quot;God so loved the world&quot;</p>}
                            {hasEmbeddings && !isEmbedderReady && (
                                <p className="text-[var(--accent-amber)] mt-2 flex items-center justify-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Warming up semantic search...
                                </p>
                            )}
                            {hasEmbeddings === null && (
                                <p className="text-[var(--text-muted)] mt-2 flex items-center justify-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Checking semantic search availability...
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
