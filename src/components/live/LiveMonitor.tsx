import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor, Play, Pause, Volume2, VolumeX, RotateCcw, Repeat } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useAnalytics } from '../../hooks/useAnalytics'
import { useLiveOutputSettings } from '../../hooks/useLiveSync'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useLocalMediaBlobUrl } from '../../hooks/useLocalMediaBlobUrl'
import { AnalyticsEventType } from '../../services/analytics/types'
import type { Slide, SlideStyle } from '../../types'
import { slideTypes, backgroundTypes } from '../../types'
import {
    countdownDurationSeconds,
    formatCountdownTime,
    isCountdownPaused,
    pauseCountdown,
    resumeCountdown,
    useCountdownSeconds,
} from '../../utils/countdown'
import { SlideView } from './SlideView'
import type { MediaProgress } from './MediaContent'

interface LiveMonitorProps {
    liveSlide: Slide | undefined
    /**
     * Fit the picture inside whatever box the panel has, at 16:9. Without it
     * the monitor takes the full width, capped by the viewport's height.
     */
    fit?: boolean
}

/**
 * The picture on air, exactly as the projector draws it, with the controls
 * that belong to it: pause/resume for a countdown and the transport for a
 * playing video. Renders as siblings (feed, then transport) so the parent's
 * column lays them out.
 */
export function LiveMonitor({ liveSlide, fit = false }: LiveMonitorProps) {
    const { trackEvent } = useAnalytics()
    const { isDesktop, sendSlideToLive } = useNativeMultiMonitor()
    // Exactly what the projector is sent, so the monitor draws what it draws.
    const outputSettings = useLiveOutputSettings()

    const fileUrl = useFileUrl(liveSlide?.backgroundStorageId || null)
    const localBg = useLocalBackground(liveSlide?.background, liveSlide?.localFilePath)
    const localMediaBlobUrl = useLocalMediaBlobUrl(liveSlide?.localMediaId)
    const backgroundUrl = fileUrl || localBg || localMediaBlobUrl

    // Self-reported by the monitor's own muted player, to drive the seek bar.
    // Not synced across windows; only explicit operator actions are.
    const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null)
    // Drop the last slide's progress when another goes on air (adjusted
    // during render, not in an effect).
    const [progressFor, setProgressFor] = useState(liveSlide?.id)
    if (progressFor !== liveSlide?.id) {
        setProgressFor(liveSlide?.id)
        setMediaProgress(null)
    }

    // The countdown on air, from the slide's own clock (utils/countdown) —
    // the same one the projector reads.
    const countdownSeconds = useCountdownSeconds(liveSlide)
    const countdownPaused = !!liveSlide && isCountdownPaused(liveSlide)

    // Analytics: a countdown going live, and reaching zero (once each).
    const countdownTrackedRef = useRef<{ started?: string; completed?: string }>({})
    useEffect(() => {
        if (liveSlide?.type !== 'countdown' || countdownTrackedRef.current.started === liveSlide.id) return
        countdownTrackedRef.current = { started: liveSlide.id }
        trackEvent(AnalyticsEventType.COUNTDOWN_STARTED, {
            slide_id: liveSlide.id,
            duration_seconds: countdownDurationSeconds(liveSlide),
        })
    }, [liveSlide, trackEvent])
    useEffect(() => {
        if (liveSlide?.type !== 'countdown' || countdownSeconds > 0) return
        if (countdownTrackedRef.current.completed === liveSlide.id) return
        countdownTrackedRef.current.completed = liveSlide.id
        trackEvent(AnalyticsEventType.COUNTDOWN_COMPLETED, {
            slide_id: liveSlide.id,
            duration_seconds: countdownDurationSeconds(liveSlide),
        })
    }, [liveSlide, countdownSeconds, trackEvent])

    // Pause/resume changes the slide's clock, which reaches the projector
    // (and a live session) the way any slide edit does.
    const handleToggleCountdown = useCallback(() => {
        if (!liveSlide || liveSlide.type !== 'countdown') return
        const now = Date.now()
        const updated = isCountdownPaused(liveSlide) ? resumeCountdown(liveSlide, now) : pauseCountdown(liveSlide, now)
        useAppStore.getState().updateActiveSlide(updated)
    }, [liveSlide])

    // Push a media transport change (play/pause/seek/mute/loop) to the output
    // window, through the same mutate-and-push channel as every live edit.
    const handleMediaTransportChange = useCallback((patch: Partial<SlideStyle>) => {
        if (!liveSlide) return
        const updatedSlide = {
            ...liveSlide,
            slideStyle: { ...liveSlide.slideStyle, ...patch },
        }
        useAppStore.getState().updateActiveSlide(updatedSlide)
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))
        if (isDesktop) {
            void sendSlideToLive(liveSlide.id, updatedSlide as unknown as Record<string, unknown>)
        }
    }, [liveSlide, isDesktop, sendSlideToLive])

    const monitor = (
        <div className={`studio-live-monitor ${fit ? '' : 'flex-1 min-h-0'} ${liveSlide ? 'is-live' : ''}`}>
            {liveSlide ? (
                <SlideView
                    slide={liveSlide}
                    settings={outputSettings}
                    backgroundUrl={backgroundUrl}
                    muted
                    showMissingMedia
                    onMediaProgress={setMediaProgress}
                    className="w-full h-full"
                >
                    {liveSlide.type === 'countdown' && (
                        <button
                            type="button"
                            onClick={handleToggleCountdown}
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-medium hover:bg-black/80 transition-colors"
                            aria-label={countdownPaused ? 'Resume countdown' : 'Pause countdown'}
                        >
                            {countdownPaused ? '▶ Resume' : '⏸ Pause'}
                        </button>
                    )}
                </SlideView>
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
                    <div className="w-16 h-16 rounded-full bg-[var(--accent-teal)]/5 flex items-center justify-center border border-[var(--accent-teal)]/10">
                        <Monitor className="w-8 h-8 text-[var(--accent-teal)]/20" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-semibold text-[var(--text-primary)] opacity-40">Selah</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">Nothing is live yet</p>
                    </div>
                </div>
            )}
        </div>
    )

    const isPlayableMedia = liveSlide?.type === slideTypes.media &&
        (liveSlide.backgroundType === backgroundTypes.video || liveSlide.backgroundType === backgroundTypes.external)

    return (
        <>
            {/* Fitted, the picture keeps its minimum height: a short panel
                scrolls rather than drawing it over the controls below. */}
            <div className={`relative group flex-1 flex flex-col ${fit ? '' : 'min-h-0'}`}>
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-red-500 uppercase tracking-[0.18em] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        On air
                    </div>
                    <div className="text-[10px] font-medium text-[var(--text-muted)] truncate ml-2">
                        {liveSlide ? liveSlide.name : 'No slide on air'}
                    </div>
                </div>
                {fit ? <div className="live-monitor-box">{monitor}</div> : monitor}
            </div>

            {/* Media transport — only when a video (local or embedded) is on air */}
            {liveSlide && isPlayableMedia && (
                <div className="flex-shrink-0">
                    <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.18em] mb-2">Media Controls</div>
                    <div className="rounded-xl p-2.5 border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/45 flex items-center gap-2">
                        <button
                            onClick={() => handleMediaTransportChange({ isMediaPlaying: liveSlide.slideStyle?.isMediaPlaying === false })}
                            className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                            title={liveSlide.slideStyle?.isMediaPlaying === false ? 'Play' : 'Pause'}
                        >
                            {liveSlide.slideStyle?.isMediaPlaying === false
                                ? <Play className="w-4 h-4" />
                                : <Pause className="w-4 h-4" />}
                        </button>

                        {liveSlide.backgroundType === backgroundTypes.video && (
                            <>
                                <button
                                    onClick={() => handleMediaTransportChange({ mediaSeekPosition: 0, mediaSeekNonce: Date.now(), isMediaPlaying: true })}
                                    className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                                    title="Restart"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <input
                                    type="range"
                                    min={0}
                                    max={mediaProgress?.duration || 0}
                                    step={0.1}
                                    value={mediaProgress?.currentTime || 0}
                                    onChange={(e) => handleMediaTransportChange({ mediaSeekPosition: Number(e.target.value), mediaSeekNonce: Date.now() })}
                                    className="flex-1 accent-[var(--accent-teal)] min-w-0"
                                    aria-label="Seek"
                                />
                                <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums flex-shrink-0 w-20 text-right">
                                    {formatCountdownTime(Math.floor(mediaProgress?.currentTime || 0))} / {formatCountdownTime(Math.floor(mediaProgress?.duration || 0))}
                                </span>
                                <button
                                    onClick={() => handleMediaTransportChange({ repeatMedia: !(liveSlide.slideStyle?.repeatMedia ?? false) })}
                                    className={`p-2 rounded-lg flex-shrink-0 hover:brightness-110 ${liveSlide.slideStyle?.repeatMedia ? 'bg-[var(--accent-teal)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}
                                    title="Loop"
                                >
                                    <Repeat className="w-4 h-4" />
                                </button>
                            </>
                        )}

                        <button
                            onClick={() => handleMediaTransportChange({ isMediaMuted: !(liveSlide.slideStyle?.isMediaMuted ?? false) })}
                            className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                            title={liveSlide.slideStyle?.isMediaMuted ? 'Unmute' : 'Mute'}
                        >
                            {liveSlide.slideStyle?.isMediaMuted
                                ? <VolumeX className="w-4 h-4" />
                                : <Volume2 className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
