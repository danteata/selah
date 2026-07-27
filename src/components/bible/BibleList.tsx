import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { Search, ChevronLeft, ChevronRight, BookOpen, Zap, Plus, X, Loader2, AlignJustify } from 'lucide-react'
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
import { parseBibleQuery, getRankedBookSuggestions, buildVerseRows as buildVerseRowsUtil, normalizeBibleReference, type BibleVerseLike, type ParsedBibleQuery } from '../../utils/bibleReference'
import type { VerseRow as VerseRowType } from '../../utils/bibleReference'
import { BookAutocomplete } from './BookAutocomplete'
import { ReferenceEditor, type ReferenceEditorHandle } from './ReferenceEditor'

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
    const [showShortcuts, setShowShortcuts] = useState(false)
    const [showRecent, setShowRecent] = useState(false)
    // Imperative handle to the book/chapter/verse steppers, so Tab (from the
    // search input) and the ` shortcut can jump straight into fast editing.
    const refEditorRef = useRef<ReferenceEditorHandle | null>(null)
    // Result density (comfortable = full verse text; compact = clamped rows),
    // persisted like the slide-queue density.
    const [density, setDensity] = useState<'comfortable' | 'compact'>(() =>
        (typeof window !== 'undefined' && localStorage.getItem('selah-bible-density') === 'compact') ? 'compact' : 'comfortable'
    )
    useEffect(() => { localStorage.setItem('selah-bible-density', density) }, [density])
    const compact = density === 'compact'
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [suggestionIndex, setSuggestionIndex] = useState(0)
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
    // Same pattern for `addToQueue` — Shift+Enter on the reference editor queues.
    const addToQueueRef = useRef<
        ((bookIndex: number, chapter: number, verse: number, preText?: string) => Promise<void>) | null
    >(null)
    const [recentVerses, setRecentVerses] = useState<string[]>(() => {
        try {
            const stored = localStorage.getItem(RECENT_VERSES_KEY)
            return stored ? JSON.parse(stored) : []
        } catch { return [] }
    })

    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const activeRowRef = useRef<HTMLDivElement>(null)

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
        // Whenever result rows are on screen, focus one by default so Enter
        // presents it and ↑/↓ navigate immediately — no throwaway "search"
        // keystroke first. Prefer the looked-up verse when we have one.
        if (rows.length === 0 || focusedIndex !== -1) return
        const currentIdx = rows.findIndex(r => r.isCurrent)
        setFocusedIndex(currentIdx >= 0 ? currentIdx : 0)
    })

    // Only offer book autocomplete while the user is still typing the book
    // portion (no chapter/verse yet) and hasn't run a search — otherwise the
    // input is in reference or semantic mode and suggestions would be noise.
    const bookSuggestions = useMemo(() => {
        if (hasSearched) return []
        const trimmed = query.trim()
        if (!trimmed || /\d/.test(trimmed)) return []
        return getRankedBookSuggestions(trimmed)
    }, [query, hasSearched])
    const suggestionsOpen = showSuggestions && bookSuggestions.length > 0 && !hasSearched

    // Inline ghost-text completion: the un-typed tail of the top suggestion,
    // shown faintly after the caret. Tab/→ accepts it (see handleKeyDown).
    const ghostCompletion = useMemo(() => {
        if (!suggestionsOpen) return ''
        const top = bookSuggestions[suggestionIndex] ?? bookSuggestions[0]
        // Match against the raw query (not trimmed) so the invisible spacer
        // in the overlay lines the ghost up exactly with the typed text.
        if (top && top.book.toLowerCase().startsWith(query.toLowerCase()) && top.book.length > query.length) {
            return top.book.slice(query.length)
        }
        return ''
    }, [suggestionsOpen, bookSuggestions, suggestionIndex, query])

    // Normalize loose/colon-less input ("John 3 16", "John 3, 16") before
    // parsing, so the docked panel matches the voice path — the raw parser
    // only accepts the canonical "Book C:V" form. `normalizeBibleReference`
    // is a no-op on free text, so semantic queries are unaffected.
    const parseQuery = useCallback((q: string) => {
        return parseBibleQuery(normalizeBibleReference(q))
    }, [])

    // Accept a book from the autocomplete: drop in "Book " and keep typing
    // the chapter/verse. Clears semantic results so the two modes don't mix.
    const acceptBookSuggestion = useCallback((bookName: string) => {
        setQuery(bookName + ' ')
        setSuggestionIndex(0)
        clearSemanticResults()
        inputRef.current?.focus()
    }, [clearSemanticResults])

    // Apply a reference produced by the inline stepper chips — reuses the
    // same single-verse load path as clicking a result row.
    const applyEditedReference = useCallback((next: ParsedBibleQuery, opts?: { submit?: boolean; queue?: boolean }) => {
        // Mirror the search box: Enter presents live, Shift+Enter adds to queue,
        // a plain edit just loads the verse into the view. (goLiveWithScripture
        // reveals the verse itself; the queue path reveals it explicitly.)
        if (opts?.submit && opts.queue) {
            loadVerseWithNeighborsRef.current?.(next.bookIndex, next.chapter, next.startVerse)
            void addToQueueRef.current?.(next.bookIndex, next.chapter, next.startVerse)
        } else if (opts?.submit) {
            void goLiveWithScriptureRef.current?.(next.bookIndex, next.chapter, next.startVerse)
        } else {
            loadVerseWithNeighborsRef.current?.(next.bookIndex, next.chapter, next.startVerse)
        }
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
    addToQueueRef.current = addToQueue

    const loadVerseWithNeighbors = useCallback(async (bookIndex: number, chapter: number, verseArg: number) => {
        // Callers reach this through refs, voice commands and row data whose
        // `verse` is a string ("17") in the Bible JSON, so the declared
        // `number` isn't enforced at every entry. Left uncoerced, the
        // neighbour labels below do string concatenation instead of
        // arithmetic: verse "17" + 1 built "51:3:171-173", the lookup missed,
        // and a verse sent live during a service came back blank.
        const verse = Number(verseArg)
        if (!Number.isFinite(verse)) return

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

    // Highest verse we've actually loaded for the current chapter — used to
    // clamp the verse stepper's upper bound (there's no static verse-count
    // table). Neighbors can spill into adjacent chapters, so filter by chapter.
    const maxVerseInChapter = useMemo(() => {
        if (!currentChapter) return undefined
        const inChapter = (v: BibleVerse) => Number(v.chapter) === currentChapter
        const nums = [
            ...currentVerses.map(v => Number(v.verse)),
            ...neighborVerses.prev.filter(inChapter).map(v => Number(v.verse)),
            ...neighborVerses.next.filter(inChapter).map(v => Number(v.verse)),
        ].filter(n => Number.isFinite(n))
        return nums.length ? Math.max(...nums) : undefined
    }, [currentVerses, neighborVerses, currentChapter])

    // Bring the just-searched/active verse into view so "the verse you looked
    // up" is visibly highlighted and centered, not buried among neighbors.
    useEffect(() => {
        if (activeVerseKey && activeRowRef.current) {
            activeRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
    }, [activeVerseKey, verseRows])

    // What the input will do on Enter right now — surfaced as a subtle hint so
    // the shared field's reference-vs-meaning behavior isn't a guess.
    const inputMode = useMemo<'book' | 'reference' | 'meaning' | null>(() => {
        if (hasSearched) return null
        const trimmed = query.trim()
        if (!trimmed) return null
        if (suggestionsOpen) return 'book'
        if (parseBibleQuery(normalizeBibleReference(trimmed))) return 'reference'
        if (trimmed.length >= 3 && hasEmbeddings) return 'meaning'
        return null
    }, [hasSearched, query, suggestionsOpen, hasEmbeddings])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Backtick jumps straight into the book/chapter/verse steppers, even
        // from inside the search box — no Bible query ever contains a `, so we
        // swallow it here rather than making the operator escape the field first.
        if (e.key === '`') {
            e.preventDefault()
            // Stop the event before the global ` listener also fires (it would
            // see focus already inside the editor and cycle a second time).
            e.stopPropagation()
            if (refEditorRef.current) refEditorRef.current.cycle()
            return
        }
        // While the book autocomplete is open, ↑/↓/Tab/Enter drive the
        // suggestions (not the result rows or version cycling). Tab and
        // ArrowRight also accept the inline ghost completion.
        if (suggestionsOpen) {
            if (e.key === 'ArrowDown') {
                e.preventDefault(); setSuggestionIndex(i => (i + 1) % bookSuggestions.length); return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault(); setSuggestionIndex(i => i <= 0 ? bookSuggestions.length - 1 : i - 1); return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                const s = bookSuggestions[suggestionIndex] ?? bookSuggestions[0]
                if (s) { e.preventDefault(); acceptBookSuggestion(s.book); return }
            }
            if (e.key === 'ArrowRight' && ghostCompletion) {
                const s = bookSuggestions[suggestionIndex] ?? bookSuggestions[0]
                if (s) { e.preventDefault(); acceptBookSuggestion(s.book); return }
            }
            if (e.key === 'Escape') {
                e.preventDefault(); setShowSuggestions(false); return
            }
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            if (verseRows.length > 0) {
                // Act on the focused row, defaulting to the first when nothing has
                // been explicitly focused yet (rows are shown with one highlighted).
                const row = verseRows[focusedIndex >= 0 ? focusedIndex : 0]
                // Contract: Enter = present now, Shift+Enter = add to queue.
                // goLiveWithScripture already reveals the verse + neighbors, so
                // a semantic row needs no separate load step here.
                if (e.shiftKey) {
                    addToQueue(row.bookIndex, row.chapter, row.verse, row.scripture)
                } else {
                    goLiveWithScripture(row.bookIndex, row.chapter, row.verse, row.scripture)
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
        }
        // Tab is left to the browser's normal focus traversal — use the `
        // backtick shortcut to jump into the book/chapter/verse steppers instead.
    }, [focusedIndex, verseRows, hasSearched, handleSearch, goLiveWithScripture, addToQueue, onClose, suggestionsOpen, bookSuggestions, suggestionIndex, acceptBookSuggestion, ghostCompletion])

    // Global ` shortcut — jump into the book/chapter/verse steppers, advancing
    // book → chapter → verse on each press, even when the search box isn't focused
    // (but not while typing in some OTHER field — the editor's own numeric steppers
    // strip the char, so firing from inside them is safe). Version switching lives
    // on the live verse navigator (v / ⇧V there) to avoid two owners of the key.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '`' || e.metaKey || e.ctrlKey || e.altKey) return
            const editor = refEditorRef.current
            if (!editor) return
            const t = e.target as (HTMLElement & Node) | null
            const inEditor = editor.contains(t)
            if (!inEditor && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
            e.preventDefault()
            editor.cycle()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])

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

            {/* Recent Verses — collapsed to a single toggle by default; expands
                to a one-line scroll strip so it never wraps into several rows. */}
            {recentVerses.length > 0 && (
                <div className="px-3 pt-1.5 pb-0.5">
                    <button
                        onClick={() => setShowRecent((s) => !s)}
                        aria-expanded={showRecent}
                        className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                        Recent ({recentVerses.length})
                        <span className={`transition-transform ${showRecent ? 'rotate-90' : ''}`}>&rsaquo;</span>
                    </button>
                    {showRecent && (
                        <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                            {recentVerses.map((ref) => (
                                <button key={ref} onClick={() => handleRecentVerseClick(ref)} className="group relative shrink-0 px-2 py-0.5 text-[11px] font-medium bg-[var(--bg-tertiary)]/70 hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded-full border border-[var(--border-subtle)] transition-colors">
                                    {ref}
                                    <span onClick={(e) => { e.stopPropagation(); handleRecentVerseGoLive(ref) }} className="ml-1 inline-flex text-[var(--accent-teal)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="Present">
                                        <Zap className="w-2.5 h-2.5" />
                                    </span>
                                </button>
                            ))}
                            <button onClick={() => { setRecentVerses([]); try { localStorage.removeItem(RECENT_VERSES_KEY) } catch { } }} className="shrink-0 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">clear</button>
                        </div>
                    )}
                </div>
            )}

            {/* Search bar — always visible */}
            <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70">
                <div className="relative flex items-stretch gap-2">
                    {/* Version switcher with a small "shortcuts" toggle beneath it —
                        together they match the input height without stealing its
                        width; the help text collapses in/out below the row. */}
                    <div className="shrink-0 flex flex-col justify-between">
                        <select value={selectedVersion} onChange={(e) => changeVersion(e.target.value)} className="px-2 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none appearance-none cursor-pointer">
                            {bibleVersionObjects.map((v) => (<option key={v.id} value={v.id}>{v.id}</option>))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setShowShortcuts((s) => !s)}
                            aria-expanded={showShortcuts}
                            className={`inline-flex items-center justify-center gap-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${showShortcuts ? 'text-[var(--accent-teal)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                        >
                            shortcuts
                            <span className={`transition-transform ${showShortcuts ? 'rotate-90' : ''}`}>&rsaquo;</span>
                        </button>
                    </div>
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] w-4 h-4" />
                        <input ref={inputRef} type="text" value={voice.isListening ? voice.transcript : query} onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); setSuggestionIndex(0); if (hasSearched) { setHasSearched(false); setCurrentVerses([]); setNeighborVerses({ prev: [], next: [] }); setCurrentBookIndex(null); setCurrentChapter(null); setCurrentStartVerse(null); setCurrentEndVerse(null); setActiveVerseKey(null); lastSearchedRef.current = null } }} onKeyDown={handleKeyDown} onFocus={() => setShowSuggestions(true)} placeholder={voice.isListening ? 'Listening…' : 'e.g. John 3:16 or "God so loved"'} className="w-full pl-9 pr-20 py-2.5 border border-[var(--border-default)] rounded-lg focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-all placeholder:text-[var(--text-muted)]" />
                        {ghostCompletion && !voice.isListening && (
                            <div aria-hidden className="pointer-events-none absolute inset-0 pl-9 pr-20 py-2.5 flex items-center overflow-hidden">
                                <span className="whitespace-pre invisible">{query}</span>
                                <span className="whitespace-pre text-[var(--text-muted)]">{ghostCompletion}</span>
                            </div>
                        )}
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

                {showShortcuts && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--text-muted)]">
                        <span>Auto-searches as you type</span>
                        <span>Enter = Present</span>
                        <span>Shift+Enter = Add to queue</span>
                        <span>↑↓ Navigate</span>
                        <span>` = edit book·chapter·verse</span>
                    </div>
                )}

                {suggestionsOpen && (
                    <div className="relative mt-2">
                        <div className="absolute top-0 left-0 right-0 z-10">
                            <BookAutocomplete
                                suggestions={bookSuggestions}
                                activeIndex={suggestionIndex}
                                onSelect={(_bi, bookName) => acceptBookSuggestion(bookName)}
                                onHoverIndex={setSuggestionIndex}
                            />
                        </div>
                    </div>
                )}

                {/* Mode hint — tells the operator how the shared input will
                    interpret what they've typed (reference vs. meaning search). */}
                {inputMode && (
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        {inputMode === 'book' && <><BookOpen className="w-3 h-3" /> Pick a book — Tab to complete</>}
                        {inputMode === 'reference' && <><BookOpen className="w-3 h-3 text-[var(--accent-teal)]" /> Reference — Enter to present</>}
                        {inputMode === 'meaning' && <><Search className="w-3 h-3" /> Searching by meaning</>}
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

                {/* Nav controls when verse is loaded — prev/next range shift plus
                    the inline stepper chips for editing book / chapter / verse. */}
                {hasSearched && currentBookIndex && currentChapter && currentStartVerse && currentVerses.length > 0 && (
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <button onClick={() => navigateVerse('prev')} title="Previous verses" className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                            <button onClick={() => navigateVerse('next')} title="Next verses" className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronRight className="w-4 h-4" /></button>
                            <ReferenceEditor
                                ref={refEditorRef}
                                bookIndex={currentBookIndex}
                                chapter={currentChapter}
                                startVerse={currentStartVerse}
                                endVerse={currentEndVerse ?? currentStartVerse}
                                maxVerse={maxVerseInChapter}
                                onChange={applyEditedReference}
                            />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {downloadedVersions.slice(0, 4).map((v) => (<button key={v.id} onClick={() => changeVersion(v.id)} className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${selectedVersion === v.id ? 'bg-[var(--accent-teal)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--accent-teal)]/10'}`}>{v.id}</button>))}
                        </div>
                    </div>
                )}

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
                    /* Skeleton verse rows while a search / fetch runs — steadier
                       than a spinner and matches the result rows' shape. */
                    <div className="px-2 py-2 space-y-1.5">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="px-1 py-1.5 space-y-1.5">
                                <div className="h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" style={{ width: `${28 + (i % 3) * 12}%` }} />
                                <div className="h-2.5 rounded bg-[var(--bg-tertiary)]/70 animate-pulse" style={{ width: `${88 - (i % 4) * 9}%` }} />
                            </div>
                        ))}
                    </div>
                )}

                {verseRows.length > 0 && !loading && (
                    <div className="px-2 py-1 space-y-1">
                        <div className="flex items-center justify-between px-1 py-1">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-teal)]">
                                {hasSearched ? `${bibleBooks[currentBookIndex! - 1]} ${currentChapter}` : 'Search Results'}
                            </div>
                            <button
                                onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                                title={compact ? 'Comfortable rows' : 'Compact rows'}
                                aria-label="Toggle result density"
                                className={`p-1 rounded transition-colors ${compact
                                    ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                            >
                                <AlignJustify className="w-3.5 h-3.5" />
                            </button>
                        </div>
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
                                        ref={isActive ? activeRowRef : undefined}
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
                                        <div className={compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'}>
                                            <div className={`flex items-start gap-2 ${compact ? 'mb-0.5' : 'mb-1'}`}>
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
                                            <p className={`text-xs ${compact ? 'leading-snug line-clamp-2' : 'leading-relaxed'} ${isActive || row.isCurrent ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
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

                {/* Valid reference that returned no verse (e.g. a chapter/verse
                    out of range like "Malachi 7:8") — tell the user rather than
                    showing the generic getting-started prompt. */}
                {hasSearched && verseRows.length === 0 && !loading && !isSemanticSearching && parseQuery(query) && (
                    <div className="p-4 text-center text-[var(--text-tertiary)]">
                        <BookOpen className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
                        <p className="font-medium text-[var(--text-secondary)]">No verse found</p>
                        <p className="text-sm mt-1 text-[var(--text-muted)]">&ldquo;{query.trim()}&rdquo; isn&rsquo;t a valid reference in {selectedVersion}. Check the chapter and verse.</p>
                    </div>
                )}

                {verseRows.length === 0 && !loading && !isSemanticSearching && !(hasSearched && parseQuery(query)) && (
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
