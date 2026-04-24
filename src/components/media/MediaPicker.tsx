import { useState, useEffect } from 'react'
import { X, Search, Upload, Image, Film, Grid, List, Check, Loader2 } from 'lucide-react'
import { MediaUpload, type UploadedFile } from './MediaUpload'

interface MediaItem {
    id: string
    name: string
    type: 'image' | 'video'
    url: string
    thumbnail?: string
    createdAt: string
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
    const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library')
    const [searchQuery, setSearchQuery] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [mediaItems, setMediaItems] = useState<MediaItem[]>([])

    useEffect(() => {
        if (isOpen || isInline) {
            loadMedia()
        }
    }, [isOpen, isInline])

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

    const loadMedia = async () => {
        setIsLoading(true)
        // TODO: Load from Convex or cloud storage
        // Simulating with sample data
        await new Promise((resolve) => setTimeout(resolve, 500))
        setMediaItems([
            {
                id: '1',
                name: 'Church Background',
                type: 'image',
                url: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=800',
                thumbnail: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=200',
                createdAt: '2024-01-15',
            },
            {
                id: '2',
                name: 'Worship Night',
                type: 'image',
                url: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
                thumbnail: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=200',
                createdAt: '2024-01-14',
            },
            {
                id: '3',
                name: 'Cross Sunset',
                type: 'image',
                url: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=800',
                thumbnail: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=200',
                createdAt: '2024-01-13',
            },
        ])
        setIsLoading(false)
    }

    const handleUpload = (files: UploadedFile[]) => {
        const newItems: MediaItem[] = files.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type as 'image' | 'video',
            url: f.url,
            createdAt: new Date().toISOString(),
        }))
        setMediaItems((prev) => [...newItems, ...prev])
        setActiveTab('library')
    }

    const filteredMedia = mediaItems.filter((item) => {
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

    if (!isOpen && !isInline) return null

    const content = (
        <div className={`${isInline ? 'h-full' : 'w-full max-w-4xl h-[80vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl'} flex flex-col overflow-hidden`}>
            {/* Header - Only show if not inline (ContextPanel has its own header) */}
            {!isInline && (
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            Select Media
                        </h2>
                        {allowUpload && (
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
                                <button
                                    onClick={() => setActiveTab('upload')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded ${activeTab === 'upload'
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400'
                                        }`}
                                >
                                    Upload
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
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
                                        <button
                                            key={item.id}
                                            onClick={() => setSelectedMedia(item)}
                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${selectedMedia?.id === item.id
                                                ? 'border-primary-500 ring-2 ring-primary-500/30'
                                                : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <img
                                                src={item.thumbnail || item.url}
                                                alt={item.name}
                                                className="w-full h-full object-cover"
                                            />
                                            {item.type === 'video' && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                    <Film className="w-6 h-6 text-white" />
                                                </div>
                                            )}
                                            {selectedMedia?.id === item.id && (
                                                <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                                                    <Check className="w-3 h-3 text-white" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredMedia.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => setSelectedMedia(item)}
                                            className={`w-full flex items-center gap-3 p-2 rounded-lg border-2 transition-all text-left ${selectedMedia?.id === item.id
                                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <img
                                                src={item.thumbnail || item.url}
                                                alt={item.name}
                                                className="w-12 h-10 object-cover rounded"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                                    {item.name}
                                                </p>
                                            </div>
                                            {selectedMedia?.id === item.id && (
                                                <Check className="w-4 h-4 text-primary-500" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
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
