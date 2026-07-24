import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { useSermonListenerContext } from '../components/sermon-listener/SermonListenerContext'
import { useSlideCreation } from './useSlideCreation'
import { getIndexedDB } from './useIndexedDB'
import { notifySongsChanged } from './useSongs'
import { buildSongIndex, identifySong, type SongIndex } from '../services/sermon-listener/songIdentification'
import { looksLikeSinging } from '../services/sermon-listener/singingDetection'
import { SongConfirmationTracker } from '../services/sermon-listener/songConfirmation'
import { resolveExternalSong } from '../services/sermon-listener/externalLyrics'
import { isLlmConfigured } from '../services/sermon-listener/llmClient'
import type { Song } from '../types'

/**
 * Automatic song detection (Phase 2 "Searching").
 *
 * When no song is on the live output and the congregation starts singing, this
 * listens to the transcript, identifies which library song it is, and pulls it
 * up automatically — the counterpart to how sermon scripture is auto-displayed.
 * Once a song is live, {@link useSongTracker} takes over advancing it.
 *
 * Mounted once (see SongTrackerBridge). Guarded so it only acts when
 * auto-detect is enabled, the listener is running, and a song isn't already
 * displayed. A song is loaded once its soft-evidence posterior (see
 * {@link SongConfirmationTracker}) clears a threshold — evidence accumulates
 * from each window's own match confidence and decays over real time rather
 * than needing the exact same songId on exactly two consecutive windows, so a
 * strong match confirms fast, weak/coincidental matches need more
 * corroboration, and a single unlucky in-between window doesn't wipe progress.
 *
 * Set-list scoping: if the operator already queued songs on the active output
 * (their planned service), those are searched FIRST against a small index of
 * just those songs — a candidate pool of 4-8 songs is far harder for ordinary
 * sermon speech to coincidentally clear than the whole library, which is where
 * most surviving false positives come from. Only if nothing in that pool
 * matches does it fall back to the full library, so an unplanned/spontaneous
 * song is still found, just less precisely gated.
 */

// Library index, built once per session (the seeder populates the library at
// startup, so it's stable). Module-scoped so remounts don't rebuild it.
let cachedIndex: SongIndex | null = null
let cachedSongs: Map<string, Song> | null = null
let building: Promise<void> | null = null

async function ensureIndex(): Promise<void> {
    if (cachedIndex && cachedSongs) return
    if (!building) {
        building = (async () => {
            const db = getIndexedDB()
            const items = await db.library.where('type').equals('song').toArray()
            const songs = items
                .map((i) => i.content as Song)
                .filter((s) => s && Array.isArray(s.sections) && s.sections.length > 0)
            cachedIndex = buildSongIndex(songs)
            cachedSongs = new Map(songs.map((s) => [s._id || s.id, s]))
        })()
    }
    await building
}

const MATCH_WINDOW_WORDS = 14
// Consecutive full unmatched windows of singing before trying an online lookup.
const EXTERNAL_UNMATCHED_THRESHOLD = 3

/** Invalidate the module index cache so a newly-imported song is picked up. */
function invalidateIndexCache() {
    cachedIndex = null
    cachedSongs = null
    building = null
}

export function useSongAutoDetect() {
    const listener = useSermonListenerContext()
    const isListening = listener?.isListening ?? false
    const transcriptSegments = listener?.transcriptSegments

    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const autoDetect = useAppStore((s) => s.songTracking.autoDetect)
    const externalLyrics = useAppStore((s) => s.songTracking.externalLyrics)
    // The tracker's phase for the displayed song. 'lost' means the singing no
    // longer matches it — the cue that a *different* song may have started.
    const trackerPhase = useAppStore((s) => s.songTracking.status.phase)
    const { createSongSlides } = useSlideCreation()

    const processedCountRef = useRef(0)
    const bufferRef = useRef<string[]>([])
    // Monotonic count of all words ever seen — the window position fed to the
    // confirmation tracker so overlapping re-scores of one phrase aren't
    // mistaken for independent corroboration (see songConfirmation.ts).
    const wordsSeenRef = useRef(0)
    // Soft-posterior evidence accumulator — see songConfirmation.ts. One
    // instance for the hook's lifetime; `reset()` is called (not replaced)
    // whenever search stops or a song is confirmed.
    const confirmationRef = useRef(new SongConfirmationTracker())
    // Online-fallback throttling: count sustained unmatched windows, guard
    // against concurrent lookups, and never retry the same snippet.
    const unmatchedRef = useRef(0)
    const externalBusyRef = useRef(false)
    const lastExternalSnippetRef = useRef<string | null>(null)
    const createSongSlidesRef = useRef(createSongSlides)
    useEffect(() => {
        createSongSlidesRef.current = createSongSlides
    })
    // Cache of the small set-list-scoped index, rebuilt only when the set of
    // queued song ids actually changes (not on every transcript window).
    const scopedIndexRef = useRef<{ key: string; index: SongIndex } | null>(null)

    // The song currently displayed (its library id), if any. While it's being
    // tracked well, the tracker owns advancing verses within it and we stay
    // quiet; we only (re)search when nothing is up or the tracker is 'lost'.
    const liveSongKey = useMemo(() => {
        const s = activeSlides.find((sl) => sl.id === liveSlideId)
        return s && s.type === 'song' ? s.songId ?? null : null
    }, [activeSlides, liveSlideId])

    // Songs the operator already queued on the active output (their planned
    // service) — the set-list scoping pool. Order-independent identity so this
    // only changes (and the effect below only reruns) when the actual set of
    // queued songs changes, not on every slide reorder/edit.
    const scopedSongIds = useMemo(() => {
        const ids = new Set<string>()
        for (const sl of activeSlides) {
            if (sl.type === 'song' && sl.songId) ids.add(sl.songId)
        }
        return Array.from(ids).sort()
    }, [activeSlides])
    const scopedSongIdsKey = scopedSongIds.join('|')

    useEffect(() => {
        if (!autoDetect || !isListening) return
        const segs = transcriptSegments
        if (!segs) return

        if (segs.length < processedCountRef.current) processedCountRef.current = 0
        if (segs.length === processedCountRef.current) return

        for (let i = processedCountRef.current; i < segs.length; i++) {
            const text = (segs[i]?.text || '').trim()
            if (text) {
                const words = text.split(/\s+/)
                bufferRef.current.push(...words)
                wordsSeenRef.current += words.length
            }
        }
        processedCountRef.current = segs.length
        if (bufferRef.current.length > MATCH_WINDOW_WORDS * 2) {
            bufferRef.current = bufferRef.current.slice(-MATCH_WINDOW_WORDS * 2)
        }

        // Only (re)search for a song when nothing is displayed, or when the
        // tracker has *lost* the displayed one (a new song likely started). While
        // the current song is tracking fine, stay quiet — the tracker is busy
        // finding the right verse within it, and we must not fight that.
        const shouldSearch = !liveSongKey || trackerPhase === 'lost'
        if (!shouldSearch) {
            confirmationRef.current.reset()
            unmatchedRef.current = 0
            return
        }

        const query = bufferRef.current.slice(-MATCH_WINDOW_WORDS).join(' ')

        // Pre-gate: don't even attempt song matching (local or external) against
        // text that reads like spoken sermon narrative rather than sung lyrics.
        // Ordinary preaching is long and varied enough that some window of it
        // will eventually clear the matcher's thresholds by coincidence — this
        // stops that before it starts, instead of relying solely on tightening
        // those thresholds forever. See singingDetection.ts.
        //
        // Still ticks the confirmation tracker forward with no evidence (pure
        // decay, no reset) — this window simply wasn't attempted, it isn't
        // evidence of "no match". A single ASR-boundary window that trips the
        // pre-gate (e.g. a stray transcription artifact) shouldn't discard an
        // otherwise-real, in-progress confirmation, but real time has still
        // passed and lingering evidence should fade accordingly.
        if (!looksLikeSinging(query)) {
            confirmationRef.current.update(Date.now(), null)
            return
        }

        /** Display an identified song: reuse existing deck slides if present,
         *  else create + append them, then make the matched section live. Reads
         *  store state at call time to avoid acting on a stale snapshot. */
        const loadAndDisplay = (song: Song, sectionId: string) => {
            const store = useAppStore.getState()
            const songKey = song._id || song.id
            const sectionIndex = (song.sections ?? []).findIndex((s) => s.id === sectionId)

            const existing = store.activeSlides.filter(
                (s) => s.type === 'song' && (s.songId ?? '') === songKey,
            )
            if (existing.length > 0) {
                const target = existing.find((s) => s.verseIndex === sectionIndex) ?? existing[0]
                store.setLiveSlide(target.id)
                return
            }

            const slides = createSongSlidesRef.current(song)
            if (slides.length === 0) return
            store.appendActiveSlides(slides)
            const target = slides.find((s) => s.verseIndex === sectionIndex) ?? slides[0]
            if (target) store.setLiveSlide(target.id)
        }

        void (async () => {
            await ensureIndex()
            if (!cachedIndex || !cachedSongs) return

            // Set-list scoping: search the operator's already-queued songs
            // first, against a small dedicated index — a 4-8 song candidate
            // pool is far harder for sermon speech to coincidentally clear
            // than the whole library. Fall back to the full library only if
            // nothing in that pool matches, so an unplanned song still gets
            // found (just without the extra precision).
            let match = null
            if (scopedSongIds.length > 0) {
                if (scopedIndexRef.current?.key !== scopedSongIdsKey) {
                    const scopedSongs = scopedSongIds
                        .map((id) => cachedSongs!.get(id))
                        .filter((s): s is Song => !!s)
                    scopedIndexRef.current = { key: scopedSongIdsKey, index: buildSongIndex(scopedSongs) }
                }
                match = identifySong(query, scopedIndexRef.current.index)
            }
            if (!match) match = identifySong(query, cachedIndex)

            if (match) {
                unmatchedRef.current = 0
                // Same song that's already up (tracker briefly went 'lost' on a
                // hard passage) — let the tracker re-acquire it; don't reload.
                if (match.songId === liveSongKey) {
                    confirmationRef.current.reset()
                    return
                }
                const confirmed = confirmationRef.current.update(Date.now(), {
                    songId: match.songId,
                    confidence: match.confidence,
                    windowId: wordsSeenRef.current,
                })
                if (!confirmed) return

                const song = cachedSongs.get(confirmed)
                if (song) loadAndDisplay(song, match.sectionId)
                return
            }

            // No library match this window — still ticks the tracker forward
            // (decay only, see above).
            confirmationRef.current.update(Date.now(), null)

            // Optionally look the song up online after a
            // sustained run of unmatched singing (see externalLyrics.ts).
            if (!externalLyrics || externalBusyRef.current) return
            if (query.split(' ').filter(Boolean).length < MATCH_WINDOW_WORDS) return
            unmatchedRef.current++
            if (unmatchedRef.current < EXTERNAL_UNMATCHED_THRESHOLD) return
            if (lastExternalSnippetRef.current === query) return

            const llm = useAppStore.getState().settings.llm
            if (!isLlmConfigured(llm)) return

            externalBusyRef.current = true
            lastExternalSnippetRef.current = query
            try {
                const now = new Date().toISOString()
                const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                const song = await resolveExternalSong(query, llm, id, now)
                if (song && song.sections && song.sections.length > 0) {
                    // Persist to the local library so it's an instant match next
                    // time, then invalidate the index cache to include it.
                    const db = getIndexedDB()
                    await db.library.put({ id: song.id, type: 'song', content: song, createdAt: now, updatedAt: now })
                    invalidateIndexCache()
                    notifySongsChanged()
                    loadAndDisplay(song, song.sections[0].id)
                }
            } catch {
                // best-effort; ignore network/LLM failures
            } finally {
                externalBusyRef.current = false
                unmatchedRef.current = 0 // throttle: re-accumulate before next try
            }
        })()
    }, [transcriptSegments, autoDetect, isListening, liveSongKey, trackerPhase, externalLyrics, scopedSongIds, scopedSongIdsKey])
}
