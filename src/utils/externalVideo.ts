import type { ExternalVideo } from '../types'

function extractYouTubeId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/)
    return match ? match[1] : null
}

function extractVimeoId(url: string): string | null {
    const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    return match ? match[1] : null
}

/** Detects whether a pasted link is a YouTube or Vimeo video URL, or neither. */
export function detectExternalVideoPlatform(url: string): 'youtube' | 'vimeo' | null {
    if (extractYouTubeId(url)) return 'youtube'
    if (extractVimeoId(url)) return 'vimeo'
    return null
}

/**
 * Cheap, no-network thumbnail for a library preview. YouTube's `img.youtube.com`
 * thumbnails are predictable from the video ID alone; Vimeo has no equivalent
 * without an oEmbed round-trip, so callers fall back to a generic icon for it.
 */
export function getExternalVideoThumbnail(video: ExternalVideo): string | null {
    if (video.type === 'youtube') {
        const id = extractYouTubeId(video.url)
        return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
    }
    return null
}

/**
 * Builds a YouTube/Vimeo iframe embed URL, encoding autoplay/mute as query
 * params. Both platforms only support play/pause and mute via a src reload
 * (rather than their postMessage JS APIs), so callers that need to change
 * playback state should remount the iframe with a new `src` — real scrubbing
 * is not supported this way.
 */
export function getEmbedUrl(video: ExternalVideo, muted: boolean, playing: boolean): string | null {
    const autoplay = playing ? 1 : 0
    const mute = muted ? 1 : 0

    if (video.type === 'youtube') {
        const id = extractYouTubeId(video.url)
        if (!id) return null
        return `https://www.youtube.com/embed/${id}?autoplay=${autoplay}&mute=${mute}&playsinline=1&rel=0`
    }

    if (video.type === 'vimeo') {
        const id = extractVimeoId(video.url)
        if (!id) return null
        return `https://player.vimeo.com/video/${id}?autoplay=${autoplay}&muted=${mute}`
    }

    return null
}
