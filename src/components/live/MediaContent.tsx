import { memo, useEffect, useRef } from 'react'
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
    const lastAppliedSeekRef = useRef<number | undefined>(undefined)

    const isPlaying = slide.slideStyle?.isMediaPlaying ?? true
    const isMuted = muted ?? slide.slideStyle?.isMediaMuted ?? false
    const loop = slide.slideStyle?.repeatMedia ?? false
    const seekPosition = slide.slideStyle?.mediaSeekPosition

    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        if (isPlaying) {
            video.play().catch(() => { /* blocked autoplay/permission errors are non-fatal */ })
        } else {
            video.pause()
        }
    }, [isPlaying])

    // `mediaSeekPosition` is a one-shot seek command, not a continuous
    // position feed — only re-apply it when the operator sets a new value.
    useEffect(() => {
        const video = videoRef.current
        if (!video || seekPosition === undefined) return
        if (lastAppliedSeekRef.current === seekPosition) return
        lastAppliedSeekRef.current = seekPosition
        video.currentTime = seekPosition
    }, [seekPosition])

    useEffect(() => {
        lastAppliedSeekRef.current = undefined
    }, [slide.id])

    if (slide.backgroundType === backgroundTypes.external) {
        const external = slide.data as ExternalVideo | undefined
        const embedUrl = external ? getEmbedUrl(external, isMuted, isPlaying) : null
        if (!embedUrl) return null
        return (
            <iframe
                key={embedUrl}
                src={embedUrl}
                className={className}
                style={{ border: 0, ...style }}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={slide.name || 'External video'}
            />
        )
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
            />
        )
    }

    return null
}

export const MediaContent = memo(MediaContentImpl)
