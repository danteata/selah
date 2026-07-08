import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { useSermonListenerContext } from '../components/sermon-listener/SermonListenerContext'
import { useSlideCreation } from './useSlideCreation'
import { getIndexedDB } from './useIndexedDB'
import { notifySongsChanged } from './useSongs'
import { buildSongIndex, identifySong, type SongIndex } from '../services/sermon-listener/songIdentification'
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
 * displayed. A song must be confirmed across two consecutive transcript windows
 * before it's loaded, which (with the identifier's high threshold) keeps sermon
 * speech from triggering false pop-ups.
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
const CONFIRMATIONS_REQUIRED = 2
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
    const pendingRef = useRef<{ songId: string; count: number } | null>(null)
    // Online-fallback throttling: count sustained unmatched windows, guard
    // against concurrent lookups, and never retry the same snippet.
    const unmatchedRef = useRef(0)
    const externalBusyRef = useRef(false)
    const lastExternalSnippetRef = useRef<string | null>(null)
    const createSongSlidesRef = useRef(createSongSlides)
    useEffect(() => {
        createSongSlidesRef.current = createSongSlides
    })

    // The song currently displayed (its library id), if any. While it's being
    // tracked well, the tracker owns advancing verses within it and we stay
    // quiet; we only (re)search when nothing is up or the tracker is 'lost'.
    const liveSongKey = useMemo(() => {
        const s = activeSlides.find((sl) => sl.id === liveSlideId)
        return s && s.type === 'song' ? s.songId ?? null : null
    }, [activeSlides, liveSlideId])

    useEffect(() => {
        if (!autoDetect || !isListening) return
        const segs = transcriptSegments
        if (!segs) return

        if (segs.length < processedCountRef.current) processedCountRef.current = 0
        if (segs.length === processedCountRef.current) return

        for (let i = processedCountRef.current; i < segs.length; i++) {
            const text = (segs[i]?.text || '').trim()
            if (text) bufferRef.current.push(...text.split(/\s+/))
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
            pendingRef.current = null
            unmatchedRef.current = 0
            return
        }

        const query = bufferRef.current.slice(-MATCH_WINDOW_WORDS).join(' ')

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

            const match = identifySong(query, cachedIndex)
            if (match) {
                unmatchedRef.current = 0
                // Same song that's already up (tracker briefly went 'lost' on a
                // hard passage) — let the tracker re-acquire it; don't reload.
                if (match.songId === liveSongKey) {
                    pendingRef.current = null
                    return
                }
                // Require the same (new) song on two consecutive windows before switching.
                if (pendingRef.current?.songId === match.songId) {
                    pendingRef.current.count++
                } else {
                    pendingRef.current = { songId: match.songId, count: 1 }
                }
                if (pendingRef.current.count < CONFIRMATIONS_REQUIRED) return
                pendingRef.current = null

                const song = cachedSongs.get(match.songId)
                if (song) loadAndDisplay(song, match.sectionId)
                return
            }

            // No library match. Optionally look the song up online after a
            // sustained run of unmatched singing (see externalLyrics.ts).
            pendingRef.current = null
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
    }, [transcriptSegments, autoDetect, isListening, liveSongKey, trackerPhase, externalLyrics])
}
