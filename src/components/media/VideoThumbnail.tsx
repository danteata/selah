import { useRef } from 'react'

interface VideoThumbnailProps {
    src: string
    className?: string
    style?: React.CSSProperties
}

/**
 * Renders a video's first frame as a static preview — no playback, no
 * sound, no loop. Just pointing a `<video>` at a src without `autoplay`
 * doesn't reliably paint a frame in every browser (some show black until
 * something forces a seek), so a tiny nudge to `currentTime` once metadata
 * is available guarantees a real frame renders.
 */
export function VideoThumbnail({ src, className, style }: VideoThumbnailProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null)

    return (
        <video
            ref={videoRef}
            src={src}
            className={className}
            style={style}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
                const video = e.currentTarget
                if (video.currentTime === 0) {
                    video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
                }
            }}
        />
    )
}
