import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { DEFAULT_SONG_TRACKING, type SongTrackingStep, type SongTrackingStatus } from '../store/appStore'
import { useSermonListenerContext } from '../components/sermon-listener/SermonListenerContext'
import { SongPositionTracker, type TrackerUpdate } from '../services/sermon-listener/songTracker'
import type { Slide, Song } from '../types'
import { sectionsForSong } from '../lib/songSections'

/**
 * Live wiring for the predictive song-lyric tracker (Phase 2 + 3).
 *
 * Consumes the sermon listener's transcript stream and, for the song currently
 * on the live output, drives the projector ahead of the singers by calling
 * `setLiveSlide`. Mounted once (see AppShell) so it runs for the whole session.
 *
 * Safety model (Phase 3):
 *  - The tracker always runs so the operator sees a live confidence + position
 *    readout, but it only moves the live slide when auto-advance is enabled and
 *    not locked.
 *  - Manual slide changes are never fought. When the operator clicks a slide or
 *    uses the clicker/keyboard, we detect the external live-slide change and
 *    re-seat the tracker to that section (`seekToSection`) so it follows the
 *    operator instead of yanking back.
 *
 * Two mechanisms hide transcription latency, both driven from data the
 * pipeline already produces:
 *
 *  - **Interim transcripts.** Finalized segments only exist once an utterance
 *    has *ended* and been transcribed. The listener also surfaces live partial
 *    text (`native-stream-text` on desktop, interim results on web) 1-3 s
 *    earlier, which is fed to the tracker to move the cursor. See
 *    `TrackerChunk.interim` for what partial text is and isn't allowed to do.
 *  - **Predictive advance.** The tracker measures how long a line takes to sing;
 *    this hook measures how far behind the transcript runs. Together those say
 *    when the current section will actually end, so the next one can be put up
 *    on a timer rather than waiting for text matching the last line — which for
 *    a two-line chorus arrives well after the singers have moved on.
 */

/** Put the next section up this long before the current one is predicted to
 *  end, so it is already on screen when the singers reach it. */
const LEAD_SAFETY_MS = 600
/** Sanity bound on the measured transcript lag. */
const MAX_LAG_MS = 8000

export function useSongTracker() {
    const listener = useSermonListenerContext()
    const isListening = listener?.isListening ?? false
    const transcriptSegments = listener?.transcriptSegments
    const interimTranscript = listener?.interimTranscript ?? ''

    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const enabled = useAppStore((s) => s.songTracking.enabled)
    const locked = useAppStore((s) => s.songTracking.locked)
    const setStatus = useAppStore((s) => s.setSongTrackingStatus)

    const trackerRef = useRef<SongPositionTracker | null>(null)
    const trackedSongIdRef = useRef<string | null>(null)
    const processedCountRef = useRef(0)
    // The live slide the tracker itself last drove — used to tell tracker-driven
    // changes apart from manual operator changes.
    const trackerDrivenSlideRef = useRef<string | null>(null)
    const segmentsRef = useRef<typeof transcriptSegments>(transcriptSegments)
    const lastInterimRef = useRef('')
    const leadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Transcript lag estimation. Segment timestamps are sermon-relative (ms
    // since capture started) while scheduling happens in wall-clock time, so we
    // need the wall-clock instant that sermon time zero corresponds to.
    //
    // The anchor is when the listener started, which is within a few hundred ms
    // of the capture loop's own zero. It cannot be recovered from the segments
    // themselves: `received - endMs` equals the origin plus that segment's lag,
    // and a lag that is *systematic* — which transcription lag is — is exactly
    // the case where taking the minimum over many segments still leaves the
    // whole lag folded into the estimate, reporting zero. Segments only refine
    // the anchor downward, guarding against a start timestamp recorded late.
    const wallOriginRef = useRef<number | null>(null)
    const lagMsRef = useRef(0)

    // Anchor on the rising edge of `isListening`. Slightly early if anything
    // (device open, model load) sits between this flag and the capture loop's
    // first sample, which biases the lag *up* — the safe direction here, since
    // an overstated lag only means the next section goes up a touch early.
    useEffect(() => {
        if (!isListening) {
            wallOriginRef.current = null
            lagMsRef.current = 0
            return
        }
        wallOriginRef.current = Date.now()
    }, [isListening])

    // Keep the latest segment list in a ref so the rebuild effect can seed its
    // cursor without listing it as a dependency. Declared first so it runs
    // before the rebuild/seed/feed effects each render.
    useEffect(() => {
        segmentsRef.current = transcriptSegments
    })

    /**
     * Resolve the song currently on the live output and the maps needed to
     * project arrangement steps onto real slides. The tracked song owns the live
     * slide, else it's the first song present.
     */
    const { trackedSong, songKey, stepToSlide, slideToSection, sectionLabels, arrangement } =
        useMemo(() => {
            const empty = {
                trackedSong: null as Song | null,
                songKey: null as string | null,
                stepToSlide: new Map<number, string>(),
                slideToSection: new Map<string, string>(),
                sectionLabels: new Map<string, string>(),
                arrangement: [] as SongTrackingStep[],
            }
            // Sections are derived when a song does not store them. Requiring
            // stored sections here meant a song added from search — most of the
            // library — produced no tracked song at all: `status.songId` stayed
            // null, so SongTrackingControl rendered nothing and the operator
            // saw a live song with no auto-advance and no reason given.
            const songSlides = activeSlides.filter(
                (s): s is Slide =>
                    s.type === 'song' && sectionsForSong((s.data ?? {}) as Song).length > 0,
            )
            if (songSlides.length === 0) return empty

            const owningLive = songSlides.find((s) => s.id === liveSlideId)
            const key = (owningLive ?? songSlides[0]).songId ?? null
            const group = songSlides.filter((s) => (s.songId ?? null) === key)
            const stored = group[0].data as Song
            // One normalized object, so every consumer below and the tracker
            // itself agree on the same section list and indices.
            const song: Song = { ...stored, sections: sectionsForSong(stored) }

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
            // Step -> slide, not section -> slide: a repeated section is several
            // steps sharing one slide, and the tracker speaks in steps.
            const stepToSlide = new Map<number, string>()
            for (const sectionId of order) {
                const section = song.sections?.find((s) => s.id === sectionId)
                if (!section || !section.lines.some((l) => l.trim())) continue
                const stepIndex = arrangement.length
                const slideId = sectionToSlide.get(sectionId) ?? null
                if (slideId) stepToSlide.set(stepIndex, slideId)
                arrangement.push({
                    stepIndex,
                    sectionId,
                    label: sectionLabels.get(sectionId) ?? sectionId,
                    slideId,
                })
            }

            return { trackedSong: song, songKey: key, stepToSlide, slideToSection, sectionLabels, arrangement }
        }, [activeSlides, liveSlideId])

    // Latest values the timer callback needs, without making it a dependency of
    // every effect that schedules one.
    const applyDepsRef = useRef({ stepToSlide, arrangement, sectionLabels, songKey, trackedSong, setLiveSlide, setStatus })
    useEffect(() => {
        applyDepsRef.current = { stepToSlide, arrangement, sectionLabels, songKey, trackedSong, setLiveSlide, setStatus }
    })

    const clearLeadTimer = useCallback(() => {
        if (leadTimerRef.current !== null) {
            clearTimeout(leadTimerRef.current)
            leadTimerRef.current = null
        }
    }, [])

    /** Publish a tracker update to the operator readout and, when allowed, move
     *  the live slide to the step the tracker wants shown. */
    const apply = useCallback((u: TrackerUpdate) => {
        const deps = applyDepsRef.current
        const status: SongTrackingStatus = {
            songId: deps.songKey,
            songTitle: deps.trackedSong?.title ?? null,
            phase: u.phase,
            confidence: u.confidence,
            displaySectionId: u.displaySectionId,
            displayStepIndex: u.displayStepIndex,
            singerSectionId: u.singer?.sectionId ?? null,
            singerStepIndex: u.singer?.stepIndex ?? null,
            singerLabel: u.singer?.sectionId ? deps.sectionLabels.get(u.singer.sectionId) ?? null : null,
            arrangement: deps.arrangement,
        }
        deps.setStatus(status)

        const { enabled: on, locked: frozen } = useAppStore.getState().songTracking
        if (!on || frozen || u.displayStepIndex === null) return
        const slideId = deps.stepToSlide.get(u.displayStepIndex)
        if (!slideId || slideId === useAppStore.getState().liveSlideId) return
        trackerDrivenSlideRef.current = slideId
        deps.setLiveSlide(slideId)
    }, [])

    /**
     * Schedule the predictive advance for the section the singer is in.
     *
     * Re-armed on every accepted match, so the estimate is always the freshest
     * one. Does nothing until the tracker has timed enough lines to have an
     * opinion, which keeps early-song behaviour identical to the trailing-edge
     * rule it supplements.
     */
    const scheduleLead = useCallback((u: TrackerUpdate) => {
        clearLeadTimer()
        const tracker = trackerRef.current
        if (!tracker) return
        if (u.phase !== 'tracking' || u.singer === null) return
        if (u.estimatedLineMs === null) return
        // Already led (by the trailing-edge rule or a previous timer) — the
        // tracker refuses to lead twice, so there's nothing to schedule.
        if (u.displayStepIndex !== u.singer.stepIndex) return
        if (u.singer.stepIndex + 1 >= tracker.steps.length) return

        const fire = () => {
            leadTimerRef.current = null
            const t = trackerRef.current
            if (!t) return
            apply(t.leadDisplay())
        }

        // Time until the section ends, from now: what's left of it on the audio
        // timeline, minus how far behind that timeline we are, minus the lead.
        const delay = u.linesRemaining * u.estimatedLineMs - lagMsRef.current - LEAD_SAFETY_MS
        if (delay <= 0) {
            // The transcript is already later than the section has left to run —
            // this is the short-section case the trailing-edge rule can never
            // win, so lead now rather than at a moment already past.
            fire()
            return
        }
        leadTimerRef.current = setTimeout(fire, delay)
    }, [apply, clearLeadTimer])

    // (Re)build the tracker when the tracked song changes.
    useEffect(() => {
        if (songKey === trackedSongIdRef.current) return
        trackedSongIdRef.current = songKey
        trackerDrivenSlideRef.current = null
        lastInterimRef.current = ''
        clearLeadTimer()

        if (trackedSong) {
            const tracker = new SongPositionTracker(trackedSong, trackedSong.defaultArrangement)
            tracker.start()
            trackerRef.current = tracker
            processedCountRef.current = segmentsRef.current?.length ?? 0
            apply(tracker.getState())
        } else {
            trackerRef.current = null
            processedCountRef.current = 0
            setStatus({ ...DEFAULT_SONG_TRACKING.status })
        }
        // setStatus intentionally omitted — this runs on song change only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songKey, trackedSong, apply, clearLeadTimer])

    // Follow manual operator changes: if the live slide moved to a section of
    // the tracked song and we didn't drive it, re-seat the tracker there.
    useEffect(() => {
        const tracker = trackerRef.current
        if (!tracker || !liveSlideId) return
        if (liveSlideId === trackerDrivenSlideRef.current) return
        const sectionId = slideToSection.get(liveSlideId)
        if (!sectionId) return
        clearLeadTimer()
        trackerDrivenSlideRef.current = liveSlideId
        // `seekToSection` picks the occurrence nearest the current cursor, so
        // clicking a repeated chorus mid-song doesn't rewind to the first one.
        apply(tracker.seekToSection(sectionId))
    }, [liveSlideId, slideToSection, apply, clearLeadTimer])

    // Feed newly-finalized transcript segments into the tracker and apply its
    // decision. Runs when the segment list grows (not on every audio frame).
    useEffect(() => {
        const tracker = trackerRef.current
        const segs = transcriptSegments
        if (!tracker || !isListening || !segs) return

        if (segs.length < processedCountRef.current) {
            // A fresh capture session — sermon time restarted, so the origin
            // anchored to the previous one is meaningless.
            processedCountRef.current = 0
            wallOriginRef.current = Date.now()
            lagMsRef.current = 0
        }
        if (segs.length === processedCountRef.current) return

        let last: TrackerUpdate | null = null
        for (let i = processedCountRef.current; i < segs.length; i++) {
            const seg = segs[i]
            if (!seg?.text) continue
            last = tracker.ingest({ text: seg.text, timeMs: seg.startMs })
        }
        processedCountRef.current = segs.length
        // A final for this utterance supersedes whatever interim text we last
        // fed, so the next interim (even if textually identical) is new again.
        lastInterimRef.current = ''
        if (!last) return

        // Update the lag estimate from the newest segment before scheduling.
        const newest = segs[segs.length - 1]
        if (newest && typeof newest.endMs === 'number') {
            const receivedAt = Date.now()
            // A segment can never arrive before the audio it covers, so
            // `received - endMs` is an upper bound on the origin; use it if the
            // anchor above turned out to be later than that.
            const bound = receivedAt - newest.endMs
            wallOriginRef.current =
                wallOriginRef.current === null ? bound : Math.min(wallOriginRef.current, bound)
            const lag = receivedAt - (wallOriginRef.current + newest.endMs)
            lagMsRef.current = Math.max(0, Math.min(MAX_LAG_MS, lag))
        }

        apply(last)
        scheduleLead(last)
    }, [transcriptSegments, isListening, enabled, locked, stepToSlide, apply, scheduleLead])

    // Feed live partial text. This is the same utterance re-sent as it grows, so
    // it only ever nudges the cursor along the path the tracker already expects
    // (see `TrackerChunk.interim`); the finalized segment above remains the
    // authority on everything else.
    useEffect(() => {
        const tracker = trackerRef.current
        if (!tracker || !isListening) return
        const text = interimTranscript.trim()
        if (!text || text === lastInterimRef.current) return
        lastInterimRef.current = text
        const u = tracker.ingest({ text, interim: true })
        // Reasons the tracker declined to act on this revision — nothing moved,
        // so republishing would only churn the operator readout.
        const ignored =
            u.reason === 'interim-not-tracking' ||
            u.reason === 'interim-miss' ||
            u.reason === 'interim-jump-ignored'
        if (ignored) return
        apply(u)
    }, [interimTranscript, isListening, apply])

    // Never leave a timer armed past unmount.
    useEffect(() => clearLeadTimer, [clearLeadTimer])
}
