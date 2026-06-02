import { memo } from 'react'

interface VideoBackgroundProps {
    src: string
    className?: string
    style?: React.CSSProperties
}

/**
 * Memoized video background. Renders a single `<video>` element and is
 * shielded from parent re-renders: as long as `src` is the same string,
 * the underlying DOM element is not touched and the AVPlayer/MediaSource
 * streaming session is not restarted.
 *
 * The host component is responsible for sourcing `src` from a stable
 * value (typically `useLocalBackground` or `useFileUrl`). This component
 * intentionally does no fetching, no re-resolution, and no remount logic
 * of its own — the goal is to keep the video element on the DOM across
 * arbitrary parent re-renders.
 */
function VideoBackgroundImpl({ src, className, style }: VideoBackgroundProps) {
    return (
        <video
            src={src}
            className={className}
            style={style}
            autoPlay
            loop
            muted
            playsInline
        />
    )
}

export const VideoBackground = memo(VideoBackgroundImpl)
