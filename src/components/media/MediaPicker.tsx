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
    isOpen: boolean
    onClose: () => void
    onSelect: (media: MediaItem) => void
    allowUpload?: boolean
    mediaType?: 'image' | 'video' | 'all'
}

export function MediaPicker({
    isOpen,
    onClose,
    onSelect,
    allowUpload = true,
    mediaType = 'all',
}: MediaPickerProps) {
    const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library')
    const [searchQuery, setSearchQuery] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [mediaItems, setMediaItems] = useState<MediaItem[]>([])

    useEffect(() => {
        if (isOpen) {
            loadMedia()
        }
    }, [isOpen])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }
        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onClose])

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
            onSelect(selectedMedia)
            onClose()
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-4xl h-[80vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
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

                {/* Content */}
                <div className="flex-1 overflow-hidden">
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
                                        className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                    />
                                </div>
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
                            </div>

                            {/* Media Grid/List */}
                            <div className="flex-1 overflow-y-auto p-4">
                                {isLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                                    </div>
                                ) : filteredMedia.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                                        <Image className="w-16 h-16 mb-4 opacity-50" />
                                        <p className="font-medium">No media found</p>
                                        <p className="text-sm mt-1">
                                            {searchQuery ? 'Try a different search' : 'Upload some media to get started'}
                                        </p>
                                    </div>
                                ) : viewMode === 'grid' ? (
                                    <div className="grid grid-cols-4 gap-4">
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
                                                        <Film className="w-8 h-8 text-white" />
                                                    </div>
                                                )}
                                                {selectedMedia?.id === item.id && (
                                                    <div className="absolute top-2 right-2 w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                                        <Check className="w-4 h-4 text-white" />
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
                                                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${selectedMedia?.id === item.id
                                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                            >
                                                <img
                                                    src={item.thumbnail || item.url}
                                                    alt={item.name}
                                                    className="w-16 h-12 object-cover rounded"
                                                />
                                                <div className="flex-1">
                                                    <p className="font-medium text-gray-900 dark:text-white">
                                                        {item.name}
                                                    </p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        {item.type} • {item.createdAt}
                                                    </p>
                                                </div>
                                                {selectedMedia?.id === item.id && (
                                                    <Check className="w-5 h-5 text-primary-500" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="p-6">
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
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {selectedMedia ? `Selected: ${selectedMedia.name}` : 'Select a media item'}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSelect}
                                disabled={!selectedMedia}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Use Selected
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
