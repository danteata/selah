import { useState, useEffect } from 'react'
import { X, Search, Upload, Image, Film, Grid, List, Check, Loader2, Link2, Trash2, CloudUpload, CloudCheck } from 'lucide-react'
import { MediaUpload, type UploadedFile } from './MediaUpload'
import { detectExternalVideoPlatform, getExternalVideoThumbnail } from '../../utils/externalVideo'
import { useMediaLibrary, type MediaLibraryItem } from '../../hooks/useMediaLibrary'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalMediaBlobUrl } from '../../hooks/useLocalMediaBlobUrl'
import { resolveLocalUrl } from '../../hooks/useLocalBackground'
import { VideoThumbnail } from './VideoThumbnail'
import { useEntitlements } from '../../providers/LicenseProvider'
import { ProUpsell } from '../licensing/ProGate'

export interface MediaItem {
    id: string
    name: string
    type: 'image' | 'video'
    url: string
    thumbnail?: string
    createdAt: string
    /** Set when this item is a YouTube/Vimeo link rather than an uploaded file. */
    isExternal?: boolean
    externalType?: 'youtube' | 'vimeo'
    /** Desktop: on-disk path for a locally-stored (not cloud-synced) item. */
    localFilePath?: string
    /** Web: IndexedDB blob id for a locally-stored (not cloud-synced) item. */
    localMediaId?: string
    /** Convex storage id, when this item is cloud-synced (pro) or pure-remote. */
    storageId?: string
}

interface MediaPickerProps {
    isOpen?: boolean
    onClose?: () => void
    onSelect?: (media: MediaItem) => void
    allowUpload?: boolean
    mediaType?: 'image' | 'video' | 'all'
    isInline?: boolean
}

export function MediaPicker({
    isOpen = true,
    onClose,
    onSelect,
    allowUpload = true,
    mediaType = 'all',
    isInline = false
}: MediaPickerProps) {
    const [activeTab, setActiveTab] = useState<'library' | 'upload' | 'link'>('library')
    const [searchQuery, setSearchQuery] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
    const [linkUrl, setLinkUrl] = useState('')
    const [linkName, setLinkName] = useState('')
    const [uploadError, setUploadError] = useState<string | null>(null)

    const { items, isLoading, uploadFile, syncToCloud, addExternalVideo, deleteItem } = useMediaLibrary()

    useEffect(() => {
        if (isInline) return

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose?.()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }
        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onClose, isInline])

    const handleUpload = async (files: UploadedFile[]) => {
        setUploadError(null)
        setActiveTab('library')

        const results = await Promise.allSettled(files.map((f) => uploadFile(f.file)))
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed.length > 0) {
            failed.forEach((f) => console.error('[MediaPicker] Upload failed:', f.reason))
            const firstReason = failed[0].reason instanceof Error ? failed[0].reason.message : null
            const detail = firstReason ? ` (${firstReason})` : ''
            setUploadError(
                failed.length === files.length
                    ? `Upload failed${detail}.`
                    : `${failed.length} of ${files.length} files failed to upload${detail}.`
            )
        }
    }

    const filteredMedia = (items || []).filter((item) => {
        if (mediaType !== 'all' && item.type !== mediaType) return false
        if (searchQuery) {
            return item.name.toLowerCase().includes(searchQuery.toLowerCase())
        }
        return true
    })

    const handleSelect = () => {
        if (selectedMedia) {
            onSelect?.(selectedMedia)
            onClose?.()
        }
    }

    const allowLink = allowUpload && mediaType !== 'image'

    const handleLinkSubmit = async () => {
        const trimmedUrl = linkUrl.trim()
        const platform = detectExternalVideoPlatform(trimmedUrl)
        if (!platform) return

        const name = linkName.trim() || `${platform === 'youtube' ? 'YouTube' : 'Vimeo'} Video`
        setUploadError(null)

        try {
            await addExternalVideo(platform, trimmedUrl, name)
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : 'Failed to add video link.')
            return
        }

        onSelect?.({
            id: `external_${Date.now()}`,
            name,
            type: 'video',
            url: trimmedUrl,
            createdAt: new Date().toISOString(),
            isExternal: true,
            externalType: platform,
        })
        setLinkUrl('')
        setLinkName('')
        onClose?.()
    }

    if (!isOpen && !isInline) return null

    const content = (
        <div className={`${isInline ? 'h-full' : 'w-full max-w-4xl h-[80vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl'} flex flex-col overflow-hidden`}>
            {/* Header. Non-inline shows a title + close button; inline (ContextPanel
                has its own header/close) shows just the tab switcher, compact. */}
            {(allowUpload || allowLink || !isInline) && (
                <div className={`flex items-center ${isInline ? 'justify-start px-3 py-2' : 'justify-between px-4 py-3'} border-b border-gray-200 dark:border-gray-800`}>
                    <div className="flex items-center gap-4">
                        {!isInline && (
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Select Media
                            </h2>
                        )}
                        {(allowUpload || allowLink) && (
                            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                <button
                                    onClick={() => setActiveTab('library')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded ${activeTab === 'library'
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    Library
                                </button>
                                {allowUpload && (
                                    <button
                                        onClick={() => setActiveTab('upload')}
                                        className={`px-3 py-1.5 text-sm font-medium rounded ${activeTab === 'upload'
                                            ? 'bg-white dark:bg-gray-700 shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400'
                                            }`}
                                    >
                                        Upload
                                    </button>
                                )}
                                {allowLink && (
                                    <button
                                        onClick={() => setActiveTab('link')}
                                        className={`px-3 py-1.5 text-sm font-medium rounded ${activeTab === 'link'
                                            ? 'bg-white dark:bg-gray-700 shadow-sm'
                                            : 'text-gray-600 dark:text-gray-400'
                                            }`}
                                    >
                                        Link
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {!isInline && (
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>
            )}

            {uploadError && (
                <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/40">
                    <span>{uploadError}</span>
                    <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-600 dark:hover:text-red-200">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'library' ? (
                    <div className="h-full flex flex-col">
                        {/* Search & View Toggle */}
                        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search media..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-[var(--border-default)] rounded-lg bg-[var(--bg-tertiary)] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                                />
                            </div>
                            {!isInline && (
                                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setViewMode('grid')}
                                        className={`p-2 rounded ${viewMode === 'grid'
                                            ? 'bg-white dark:bg-gray-700 shadow-sm'
                                            : 'text-gray-500'
                                            }`}
                                    >
                                        <Grid className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => setViewMode('list')}
                                        className={`p-2 rounded ${viewMode === 'list'
                                            ? 'bg-white dark:bg-gray-700 shadow-sm'
                                            : 'text-gray-500'
                                            }`}
                                    >
                                        <List className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Media Grid/List */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {isLoading ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                                </div>
                            ) : filteredMedia.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                                    <Image className="w-12 h-12 mb-4 opacity-50" />
                                    <p className="text-sm font-medium">No media found</p>
                                </div>
                            ) : viewMode === 'grid' ? (
                                <div className={`grid ${isInline ? 'grid-cols-2' : 'grid-cols-4'} gap-4`}>
                                    {filteredMedia.map((item) => (
                                        <MediaTile
                                            key={item.id}
                                            item={item}
                                            variant="grid"
                                            selected={selectedMedia?.id === item.id}
                                            onSelect={setSelectedMedia}
                                            onDelete={deleteItem}
                                            onSyncToCloud={syncToCloud}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredMedia.map((item) => (
                                        <MediaTile
                                            key={item.id}
                                            item={item}
                                            variant="list"
                                            selected={selectedMedia?.id === item.id}
                                            onSelect={setSelectedMedia}
                                            onDelete={deleteItem}
                                            onSyncToCloud={syncToCloud}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : activeTab === 'upload' ? (
                    <div className="p-4">
                        <MediaUpload
                            onUpload={handleUpload}
                            onCancel={() => setActiveTab('library')}
                            accept={
                                mediaType === 'image' ? 'image/*' :
                                    mediaType === 'video' ? 'video/*' :
                                        'image/*,video/*'
                            }
                        />
                    </div>
                ) : (
                    <div className="p-4 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                YouTube or Vimeo link
                            </label>
                            <div className="relative">
                                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="url"
                                    value={linkUrl}
                                    onChange={(e) => setLinkUrl(e.target.value)}
                                    placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-[var(--border-default)] rounded-lg bg-[var(--bg-tertiary)] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                                />
                            </div>
                            {linkUrl.trim().length > 0 && !detectExternalVideoPlatform(linkUrl.trim()) && (
                                <p className="text-xs text-red-500 mt-1">That doesn't look like a YouTube or Vimeo link.</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Title <span className="text-gray-400">(optional)</span>
                            </label>
                            <input
                                type="text"
                                value={linkName}
                                onChange={(e) => setLinkName(e.target.value)}
                                placeholder="Sunday announcement..."
                                className="w-full px-3 py-2 text-sm border border-[var(--border-default)] rounded-lg bg-[var(--bg-tertiary)] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleLinkSubmit}
                            disabled={!detectExternalVideoPlatform(linkUrl.trim())}
                            className="w-full px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg disabled:opacity-50 transition-all shadow-sm"
                        >
                            Add Video
                        </button>
                    </div>
                )}
            </div>

            {/* Footer */}
            {activeTab === 'library' && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                    <div className="flex-1 min-w-0 mr-4">
                        {selectedMedia && (
                            <p className="text-xs font-medium text-primary-500 truncate">
                                Selected: {selectedMedia.name}
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {isInline ? (
                            <button
                                onClick={handleSelect}
                                disabled={!selectedMedia}
                                className="px-4 py-2 text-xs font-bold bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 transition-all shadow-sm"
                            >
                                USE MEDIA
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSelect}
                                    disabled={!selectedMedia}
                                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg disabled:opacity-50 transition-all shadow-sm"
                                >
                                    Use Selected
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )

    if (isInline) return content

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
            {content}
        </div>
    )
}

interface MediaTileProps {
    item: MediaLibraryItem
    variant: 'grid' | 'list'
    selected: boolean
    onSelect: (media: MediaItem) => void
    onDelete: (item: MediaLibraryItem) => void
    onSyncToCloud: (item: MediaLibraryItem) => Promise<void>
}

/**
 * A single library entry. Resolves its own playable URL local-first (on-disk
 * path on desktop, IndexedDB blob on web) and only falls back to Convex's
 * `storageId` for pure-remote items — those are hooks, hence a dedicated
 * component rather than inlining this in a `.map()`.
 */
function MediaTile({ item, variant, selected, onSelect, onDelete, onSyncToCloud }: MediaTileProps) {
    const { isPro } = useEntitlements()
    const [showUpsell, setShowUpsell] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [syncError, setSyncError] = useState<string | null>(null)

    const localUrl = item.localFilePath ? resolveLocalUrl(item.localFilePath, item.localFilePath) : null
    const blobUrl = useLocalMediaBlobUrl(item.hasBlob ? item.id : null)
    const remoteUrl = useFileUrl(!localUrl && !item.hasBlob ? item.storageId || null : null)
    const resolvedUrl = localUrl || blobUrl || remoteUrl

    const externalThumb = item.isExternal && item.externalType && item.url
        ? getExternalVideoThumbnail({ url: item.url, type: item.externalType })
        : null
    const thumbnailUrl = item.type === 'image' ? resolvedUrl : externalThumb
    // A local (uploaded, not external-link) video's own file can be shown
    // as a static first-frame preview — see VideoThumbnail.
    const videoFileUrl = item.type === 'video' && !item.isExternal ? resolvedUrl : null
    const isReady = item.isExternal ? !!item.url : !!resolvedUrl
    const isLocal = !!item.localFilePath || !!item.hasBlob
    const isSynced = !!item.storageId

    const handleSelect = () => {
        if (!isReady) return
        onSelect({
            id: item.id,
            name: item.name,
            type: item.type,
            url: item.isExternal ? (item.url || '') : (resolvedUrl || ''),
            thumbnail: thumbnailUrl || undefined,
            createdAt: item.createdAt,
            isExternal: item.isExternal,
            externalType: item.externalType,
            localFilePath: item.localFilePath,
            localMediaId: item.hasBlob ? item.id : undefined,
            storageId: item.storageId,
        })
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleSelect()
        }
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        onDelete(item)
    }

    const handleSyncClick = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!isPro) {
            setShowUpsell(true)
            return
        }
        setSyncing(true)
        setSyncError(null)
        try {
            await onSyncToCloud(item)
        } catch (error) {
            setSyncError(error instanceof Error ? error.message : 'Sync failed.')
        } finally {
            setSyncing(false)
        }
    }

    const syncButton = isLocal && !item.isExternal && (
        <button
            onClick={handleSyncClick}
            disabled={syncing}
            className={`p-1.5 rounded-full transition-opacity ${isSynced
                ? 'bg-[var(--accent-teal)]/90 text-white opacity-100'
                : 'bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80'
                }`}
            title={isSynced ? 'Synced to cloud' : 'Sync to cloud (Pro)'}
        >
            {syncing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : isSynced
                    ? <CloudCheck className="w-3.5 h-3.5" />
                    : <CloudUpload className="w-3.5 h-3.5" />}
        </button>
    )

    const upsellOverlay = showUpsell && (
        <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-2"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="relative w-full">
                <button
                    onClick={() => setShowUpsell(false)}
                    className="absolute -top-1 -right-1 p-1 rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                    <X className="w-3 h-3" />
                </button>
                <ProUpsell feature="Cloud media sync" />
            </div>
        </div>
    )

    if (variant === 'grid') {
        return (
            <div
                role="button"
                tabIndex={isReady ? 0 : -1}
                onClick={handleSelect}
                onKeyDown={handleKeyDown}
                aria-disabled={!isReady}
                className={`group relative aspect-video rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${!isReady ? 'opacity-50 pointer-events-none' : ''} ${selected
                    ? 'border-primary-500 ring-2 ring-primary-500/30'
                    : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
            >
                {videoFileUrl ? (
                    <VideoThumbnail src={videoFileUrl} className="w-full h-full object-contain bg-gray-100 dark:bg-gray-800" />
                ) : thumbnailUrl ? (
                    <img src={thumbnailUrl} alt={item.name} className="w-full h-full object-contain bg-gray-100 dark:bg-gray-800" />
                ) : (
                    <div className="w-full h-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                        {item.type === 'video' && <Film className="w-6 h-6 text-gray-400" />}
                    </div>
                )}
                {item.type === 'video' && (videoFileUrl || thumbnailUrl) && (
                    <div className="absolute bottom-2 right-2 p-1 rounded bg-black/60">
                        <Film className="w-3 h-3 text-white" />
                    </div>
                )}
                {selected && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                    </div>
                )}
                <button
                    onClick={handleDelete}
                    className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity"
                    title="Remove from library"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
                {syncButton && (
                    <div className="absolute bottom-2 left-2">{syncButton}</div>
                )}
                {syncError && (
                    <div className="absolute inset-x-1 bottom-1 text-[9px] text-red-300 bg-black/70 rounded px-1 py-0.5 truncate">
                        {syncError}
                    </div>
                )}
                {upsellOverlay}
            </div>
        )
    }

    return (
        <div
            role="button"
            tabIndex={isReady ? 0 : -1}
            onClick={handleSelect}
            onKeyDown={handleKeyDown}
            aria-disabled={!isReady}
            className={`group relative w-full flex items-center gap-3 p-2 rounded-lg border-2 transition-all text-left cursor-pointer ${!isReady ? 'opacity-50 pointer-events-none' : ''} ${selected
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
        >
            {videoFileUrl ? (
                <VideoThumbnail src={videoFileUrl} className="w-12 h-10 object-contain bg-gray-100 dark:bg-gray-800 rounded flex-shrink-0" />
            ) : thumbnailUrl ? (
                <img src={thumbnailUrl} alt={item.name} className="w-12 h-10 object-contain bg-gray-100 dark:bg-gray-800 rounded flex-shrink-0" />
            ) : (
                <div className="w-12 h-10 flex-shrink-0 rounded bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                    <Film className="w-4 h-4 text-gray-400" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                    {item.name}
                </p>
                {syncError && <p className="text-[10px] text-red-500 truncate">{syncError}</p>}
            </div>
            {selected && <Check className="w-4 h-4 text-primary-500 flex-shrink-0" />}
            {syncButton && <div className="flex-shrink-0">{syncButton}</div>}
            <button
                onClick={handleDelete}
                className="p-1.5 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-opacity flex-shrink-0"
                title="Remove from library"
            >
                <Trash2 className="w-4 h-4" />
            </button>
            {upsellOverlay}
        </div>
    )
}
