import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Slide, ExternalVideo } from '../../types'
import { backgroundTypes } from '../../types'
import { getEmbedUrl } from '../../utils/externalVideo'
import { getObjectFit } from '../../utils/mediaFit'

export interface MediaProgress {
    currentTime: number
    duration: number
    paused: boolean
}

interface MediaContentProps {
    slide: Slide
    /** Resolved local image/video URL — unused for external (YouTube/Vimeo) slides. */
    src?: string
    /** Forces silence regardless of `slide.slideStyle.isMediaMuted` — used by operator preview panels. */
    muted?: boolean
    className?: string
    style?: React.CSSProperties
    onProgress?: (state: MediaProgress) => void
}

/**
 * Full-bleed renderer for `media`-type slide content (as opposed to
 * `VideoBackground`, which is a muted/looping backdrop behind text). Each
 * instance (operator preview, real output window) plays its own decode
 * session independently — they are only nudged back in sync when the
 * operator explicitly acts (play/pause/seek/mute/loop), via the normal
 * `slide.slideStyle` sync channel already used for every other live mutation.
 */
function MediaContentImpl({ slide, src, muted, className, style, onProgress }: MediaContentProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    // Which source failed to load, so a new one gets a fresh chance.
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    const failed = !!src && failedSrc === src
    const lastAppliedSeekRef = useRef<number | undefined>(undefined)

    const isPlaying = slide.slideStyle?.isMediaPlaying ?? true
    const isMuted = muted ?? slide.slideStyle?.isMediaMuted ?? false
    const loop = slide.slideStyle?.repeatMedia ?? false
    const seekPosition = slide.slideStyle?.mediaSeekPosition
    // Older slides carry no nonce; fall back to the position itself.
    const seekToken = slide.slideStyle?.mediaSeekNonce ?? seekPosition

    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        if (isPlaying) {
            video.play().catch(() => {
                // Autoplay with sound is blocked in a window nobody has clicked
                // (the output, usually), which left the projector's copy frozen
                // while the operator's muted preview played on. Silent beats
                // stuck; the operator can see the output isn't making sound.
                if (video.muted) return
                console.warn('[MediaContent] autoplay with sound was blocked; playing muted')
                video.muted = true
                video.play().catch(() => { /* still blocked: nothing more to try */ })
            })
        } else {
            video.pause()
        }
    }, [isPlaying])

    // A seek is a one-shot command, not a continuous position feed — applied
    // once per command. Keyed on the position alone, a second Restart (0 again)
    // matched the last one and did nothing.
    useEffect(() => {
        const video = videoRef.current
        if (!video || seekPosition === undefined) return
        if (lastAppliedSeekRef.current === seekToken) return
        lastAppliedSeekRef.current = seekToken
        video.currentTime = seekPosition
    }, [seekPosition, seekToken])

    useEffect(() => {
        lastAppliedSeekRef.current = undefined
    }, [slide.id])

    if (slide.backgroundType === backgroundTypes.external) {
        const external = slide.data as ExternalVideo | undefined
        if (!external) return null
        return (
            <ExternalVideoPlayer
                // One player per video; play/pause/mute/seek are commands to it.
                key={`${slide.id}:${external.url}`}
                video={external}
                isPlaying={isPlaying}
                isMuted={isMuted}
                seekPosition={seekPosition}
                seekToken={seekToken}
                className={className}
                style={style}
                title={slide.name || 'External video'}
            />
        )
    }

    // A missing or revoked file used to be plain black everywhere, with nothing
    // to tell the operator. Their preview (the `muted` panels) now says so;
    // the projector stays black rather than show an error to the room.
    if (failed) {
        return muted ? (
            <div className={`${className ?? ''} flex items-center justify-center bg-black text-xs text-white/70`} style={style}>
                Couldn't load this media
            </div>
        ) : null
    }

    if (slide.backgroundType === backgroundTypes.video && src) {
        return (
            <video
                ref={videoRef}
                src={src}
                className={className}
                style={{ objectFit: getObjectFit(slide.slideStyle?.backgroundFillType), ...style }}
                autoPlay={isPlaying}
                muted={isMuted}
                loop={loop}
                playsInline
                onTimeUpdate={(e) => {
                    const v = e.currentTarget
                    onProgress?.({ currentTime: v.currentTime, duration: v.duration || 0, paused: v.paused })
                }}
                onLoadedMetadata={(e) => {
                    const v = e.currentTarget
                    onProgress?.({ currentTime: v.currentTime, duration: v.duration || 0, paused: v.paused })
                }}
                onEnded={(e) => {
                    const v = e.currentTarget
                    onProgress?.({ currentTime: v.currentTime, duration: v.duration || 0, paused: true })
                }}
                onError={() => {
                    console.warn('[MediaContent] video failed to load:', src)
                    setFailedSrc(src)
                }}
            />
        )
    }

    if (src) {
        return (
            <img
                src={src}
                className={className}
                style={{ objectFit: getObjectFit(slide.slideStyle?.backgroundFillType), ...style }}
                alt={slide.name || 'Media'}
                onError={() => {
                    console.warn('[MediaContent] image failed to load:', src)
                    setFailedSrc(src)
                }}
            />
        )
    }

    return null
}

/**
 * A YouTube/Vimeo embed, driven through the players' postMessage APIs.
 *
 * The iframe used to be keyed on its URL, which encodes autoplay and mute, so
 * pausing or muting reloaded the player and restarted the video from 0:00 in
 * front of the room. The URL is now fixed at mount (from the state at that
 * moment) and later changes are sent to the running player.
 */
function ExternalVideoPlayer({
    video,
    isPlaying,
    isMuted,
    seekPosition,
    seekToken,
    className,
    style,
    title,
}: {
    video: ExternalVideo
    isPlaying: boolean
    isMuted: boolean
    seekPosition: number | undefined
    seekToken: number | undefined
    className?: string
    style?: React.CSSProperties
    title: string
}) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [embedUrl] = useState(() => getEmbedUrl(video, isMuted, isPlaying))
    const initialSeekToken = useRef(seekToken)

    const send = useCallback((command: 'play' | 'pause' | 'mute' | 'unmute' | 'seek', seconds = 0) => {
        const target = iframeRef.current?.contentWindow
        if (!target) return
        if (video.type === 'youtube') {
            const call = {
                play: ['playVideo', []],
                pause: ['pauseVideo', []],
                mute: ['mute', []],
                unmute: ['unMute', []],
                seek: ['seekTo', [seconds, true]],
            }[command] as [string, unknown[]]
            target.postMessage(JSON.stringify({ event: 'command', func: call[0], args: call[1] }), 'https://www.youtube.com')
        } else if (video.type === 'vimeo') {
            const message = {
                play: { method: 'play' },
                pause: { method: 'pause' },
                mute: { method: 'setVolume', value: 0 },
                unmute: { method: 'setVolume', value: 1 },
                seek: { method: 'setCurrentTime', value: seconds },
            }[command]
            target.postMessage(JSON.stringify(message), 'https://player.vimeo.com')
        }
    }, [video.type])

    // Skip the first run of each: the URL already carries the initial state.
    const firstPlay = useRef(true)
    useEffect(() => {
        if (firstPlay.current) { firstPlay.current = false; return }
        send(isPlaying ? 'play' : 'pause')
    }, [isPlaying, send])

    const firstMute = useRef(true)
    useEffect(() => {
        if (firstMute.current) { firstMute.current = false; return }
        send(isMuted ? 'mute' : 'unmute')
    }, [isMuted, send])

    useEffect(() => {
        if (seekPosition === undefined || seekToken === initialSeekToken.current) return
        initialSeekToken.current = seekToken
        send('seek', seekPosition)
    }, [seekPosition, seekToken, send])

    if (!embedUrl) return null
    return (
        <iframe
            ref={iframeRef}
            src={embedUrl}
            className={className}
            style={{ border: 0, ...style }}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title={title}
        />
    )
}

export const MediaContent = memo(MediaContentImpl)
