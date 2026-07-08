import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { DEFAULT_SONG_TRACKING, type SongTrackingStep, type SongTrackingStatus } from '../store/appStore'
import { useSermonListenerContext } from '../components/sermon-listener/SermonListenerContext'
import { SongPositionTracker, type TrackerUpdate } from '../services/sermon-listener/songTracker'
import type { Slide, Song } from '../types'

/**
 * Live wiring for the predictive song-lyric tracker (Phase 2 + 3).
 *
 * Consumes the sermon listener's transcript stream + audio level and, for the
 * song currently on the live output, drives the projector ahead of the singers
 * by calling `setLiveSlide`. Mounted once (see AppShell) so it runs for the
 * whole session.
 *
 * Safety model (Phase 3):
 *  - The tracker always runs so the operator sees a live confidence + position
 *    readout, but it only moves the live slide when auto-advance is enabled and
 *    not locked.
 *  - Manual slide changes are never fought. When the operator clicks a slide or
 *    uses the clicker/keyboard, we detect the external live-slide change and
 *    re-seat the tracker to that section (`seekToSection`) so it follows the
 *    operator instead of yanking back.
 */
export function useSongTracker() {
    const listener = useSermonListenerContext()
    const isListening = listener?.isListening ?? false
    const transcriptSegments = listener?.transcriptSegments
    const audioLevel = listener?.audioLevel ?? 0

    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const enabled = useAppStore((s) => s.songTracking.enabled)
    const locked = useAppStore((s) => s.songTracking.locked)
    const setStatus = useAppStore((s) => s.setSongTrackingStatus)

    const trackerRef = useRef<SongPositionTracker | null>(null)
    const trackedSongIdRef = useRef<string | null>(null)
    const processedCountRef = useRef(0)
    const audioLevelRef = useRef(0)
    // The live slide the tracker itself last drove — used to tell tracker-driven
    // changes apart from manual operator changes.
    const trackerDrivenSlideRef = useRef<string | null>(null)
    const segmentsRef = useRef<typeof transcriptSegments>(transcriptSegments)

    // Keep latest high-frequency values in refs (audioLevel updates ~60fps) so
    // the feed effect need not list them as deps. Declared first so it runs
    // before the rebuild/seed/feed effects each render.
    useEffect(() => {
        audioLevelRef.current = audioLevel
        segmentsRef.current = transcriptSegments
    })

    /**
     * Resolve the song currently on the live output and the maps needed to
     * project sections onto real slides. The tracked song owns the live slide,
     * else it's the first song present.
     */
    const { trackedSong, songKey, sectionToSlide, slideToSection, sectionLabels, arrangement } =
        useMemo(() => {
            const empty = {
                trackedSong: null as Song | null,
                songKey: null as string | null,
                sectionToSlide: new Map<string, string>(),
                slideToSection: new Map<string, string>(),
                sectionLabels: new Map<string, string>(),
                arrangement: [] as SongTrackingStep[],
            }
            const songSlides = activeSlides.filter(
                (s): s is Slide =>
                    s.type === 'song' && !!(s.data as Song | undefined)?.sections?.length,
            )
            if (songSlides.length === 0) return empty

            const owningLive = songSlides.find((s) => s.id === liveSlideId)
            const key = (owningLive ?? songSlides[0]).songId ?? null
            const group = songSlides.filter((s) => (s.songId ?? null) === key)
            const song = group[0].data as Song

            const sectionToSlide = new Map<string, string>()
            const slideToSection = new Map<string, string>()
            for (const sl of group) {
                if (sl.verseIndex == null) continue
                const section = song.sections?.[sl.verseIndex]
                if (!section) continue
                sectionToSlide.set(section.id, sl.id)
                slideToSection.set(sl.id, section.id)
            }
            const sectionLabels = new Map<string, string>()
            for (const section of song.sections ?? []) {
                sectionLabels.set(section.id, section.label ?? section.id)
            }

            // Expand the arrangement the same way the tracker does, so chip
            // step indices line up with the tracker's steps.
            const order =
                song.defaultArrangement && song.defaultArrangement.length > 0
                    ? song.defaultArrangement
                    : (song.sections ?? []).map((s) => s.id)
            const arrangement: SongTrackingStep[] = []
            for (const sectionId of order) {
                const section = song.sections?.find((s) => s.id === sectionId)
                if (!section || !section.lines.some((l) => l.trim())) continue
                arrangement.push({
                    stepIndex: arrangement.length,
                    sectionId,
                    label: sectionLabels.get(sectionId) ?? sectionId,
                    slideId: sectionToSlide.get(sectionId) ?? null,
                })
            }

            return { trackedSong: song, songKey: key, sectionToSlide, slideToSection, sectionLabels, arrangement }
        }, [activeSlides, liveSlideId])

    // Compose a full status object from a tracker update + the current maps.
    const publish = (u: Pick<TrackerUpdate, 'phase' | 'confidence' | 'displaySectionId'> & {
        singerSectionId: string | null
    }) => {
        const status: SongTrackingStatus = {
            songId: songKey,
            songTitle: trackedSong?.title ?? null,
            phase: u.phase,
            confidence: u.confidence,
            displaySectionId: u.displaySectionId,
            singerSectionId: u.singerSectionId,
            singerLabel: u.singerSectionId ? sectionLabels.get(u.singerSectionId) ?? null : null,
            arrangement,
        }
        setStatus(status)
    }

    // (Re)build the tracker when the tracked song changes.
    useEffect(() => {
        if (songKey === trackedSongIdRef.current) return
        trackedSongIdRef.current = songKey
        trackerDrivenSlideRef.current = null

        if (trackedSong) {
            const tracker = new SongPositionTracker(trackedSong, trackedSong.defaultArrangement)
            tracker.start()
            trackerRef.current = tracker
            processedCountRef.current = segmentsRef.current?.length ?? 0
            publish({ phase: 'searching', confidence: 0, displaySectionId: null, singerSectionId: null })
        } else {
            trackerRef.current = null
            processedCountRef.current = 0
            setStatus({ ...DEFAULT_SONG_TRACKING.status })
        }
        // publish/setStatus intentionally omitted — this runs on song change only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songKey, trackedSong])

    // Follow manual operator changes: if the live slide moved to a section of
    // the tracked song and we didn't drive it, re-seat the tracker there.
    useEffect(() => {
        const tracker = trackerRef.current
        if (!tracker || !liveSlideId) return
        if (liveSlideId === trackerDrivenSlideRef.current) return
        const sectionId = slideToSection.get(liveSlideId)
        if (!sectionId) return
        const u = tracker.seekToSection(sectionId)
        trackerDrivenSlideRef.current = liveSlideId
        publish({
            phase: u.phase,
            confidence: u.confidence,
            displaySectionId: u.displaySectionId,
            singerSectionId: u.singer?.sectionId ?? null,
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveSlideId, slideToSection])

    // Feed newly-finalized transcript segments into the tracker and apply its
    // decision. Runs when the segment list grows (not on every audio frame).
    useEffect(() => {
        const tracker = trackerRef.current
        const segs = transcriptSegments
        if (!tracker || !isListening || !segs) return

        if (segs.length < processedCountRef.current) processedCountRef.current = 0
        if (segs.length === processedCountRef.current) return

        const energy = audioLevelRef.current > 1 ? audioLevelRef.current / 100 : audioLevelRef.current
        let last: TrackerUpdate | null = null
        for (let i = processedCountRef.current; i < segs.length; i++) {
            const seg = segs[i]
            if (!seg?.text) continue
            last = tracker.ingest({ text: seg.text, timeMs: seg.startMs, audioEnergy: energy })
        }
        processedCountRef.current = segs.length
        if (!last) return

        publish({
            phase: last.phase,
            confidence: last.confidence,
            displaySectionId: last.displaySectionId,
            singerSectionId: last.singer?.sectionId ?? null,
        })

        if (enabled && !locked && last.displaySectionId) {
            const slideId = sectionToSlide.get(last.displaySectionId)
            if (slideId && slideId !== liveSlideId) {
                trackerDrivenSlideRef.current = slideId
                setLiveSlide(slideId)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transcriptSegments, isListening, enabled, locked, sectionToSlide, liveSlideId])
}
