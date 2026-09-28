import type { Slide } from '../types'
import { useFileUrl } from './useTemplates'
import { useLocalBackground } from './useLocalBackground'
import { useLocalMediaBlobUrl } from './useLocalMediaBlobUrl'

/** A slide's background URL, from cloud storage, a desktop file or IndexedDB. */
export function useSlideBackgroundUrl(slide: Slide | null | undefined): string | null {
    const fileUrl = useFileUrl(slide?.backgroundStorageId || null)
    const localBg = useLocalBackground(slide?.background, slide?.localFilePath)
    const localMediaBlobUrl = useLocalMediaBlobUrl(slide?.localMediaId)
    // An object URL only works in the tab that made it; when the slide names
    // its local media library item, that is what every window should load.
    const staleObjectUrl = !!slide?.localMediaId && localBg.startsWith('blob:')
    return fileUrl || localMediaBlobUrl || (staleObjectUrl ? null : localBg) || null
}
