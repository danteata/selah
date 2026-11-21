import { useMemo } from 'react'
import type { Slide } from '../../types'
import { useLiveOutputSettings } from '../../hooks/useLiveSync'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useLocalMediaBlobUrl } from '../../hooks/useLocalMediaBlobUrl'
import { SlideView } from './SlideView'

interface OutputThumbnailProps {
    slide: Slide | undefined
    /** Shown in the frame when there is no slide. */
    emptyText: string
    className?: string
}

/**
 * A 16:9 thumbnail of how a slide will look on the projector: the same
 * renderer and output settings, with no motion, the screen never shown
 * cleared, and text kept readable at this size.
 */
export function OutputThumbnail({ slide, emptyText, className = '' }: OutputThumbnailProps) {
    const outputSettings = useLiveOutputSettings()
    const settings = useMemo(
        () => ({ ...outputSettings, visualizerEnabled: false, liveOutputBlanked: false }),
        [outputSettings]
    )
    const fileUrl = useFileUrl(slide?.backgroundStorageId || null)
    const localBg = useLocalBackground(slide?.background, slide?.localFilePath)
    const localMediaBlobUrl = useLocalMediaBlobUrl(slide?.localMediaId)
    const backgroundUrl = fileUrl || localBg || localMediaBlobUrl

    return (
        <div className={`aspect-video rounded-xl overflow-hidden relative border border-[var(--border-subtle)] bg-black/30 shadow-sm ${className}`}>
            {slide ? (
                <SlideView
                    slide={slide}
                    settings={settings}
                    backgroundUrl={backgroundUrl}
                    animate={false}
                    clock={false}
                    muted
                    showMissingMedia
                    minTextPx={10}
                    className="w-full h-full"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-black/30 text-[var(--text-muted)] italic text-[10px] text-center leading-tight px-2">
                    {emptyText}
                </div>
            )}
        </div>
    )
}
