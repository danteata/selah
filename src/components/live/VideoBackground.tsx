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
 *
 * Deliberately no cleanup effect here: an imperative teardown (pause +
 * removeAttribute('src') + load()) is unsafe under React 18 Strict Mode's
 * double-invoked effects — the synthetic mount/cleanup/mount cycle doesn't
 * actually remove this DOM node, and since `src` hasn't changed across that
 * cycle, React's reconciler never reapplies the attribute the cleanup just
 * stripped, permanently breaking playback. Let the browser reclaim the old
 * decode session when the `src` attribute itself changes or the node is
 * actually removed from the DOM.
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
