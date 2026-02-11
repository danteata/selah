import { useState, useMemo } from 'react'
import { Library, Search, Trash2, Plus, FolderOpen, BookOpen, Music, FileText, X } from 'lucide-react'
import { useLibrary } from '../../hooks/useLibrary'
import { useConfirmDialog } from '../modals/ConfirmDialog'

interface LibraryPanelProps {
    isOpen: boolean
    onClose: () => void
}

export function LibraryPanel({ isOpen, onClose }: LibraryPanelProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

    const {
        librarySlides,
        removeFromLibrary,
        useSlide,
        getSlidesByCategory,
        searchLibrary,
        libraryCount,
    } = useLibrary()

    const { confirm, ConfirmDialog } = useConfirmDialog()

    const categories = [
        { id: null, label: 'All', icon: FolderOpen, count: libraryCount },
        { id: 'scripture', label: 'Scripture', icon: BookOpen, count: getSlidesByCategory('scripture').length },
        { id: 'song', label: 'Songs', icon: Music, count: getSlidesByCategory('song').length },
        { id: 'hymn', label: 'Hymns', icon: Music, count: getSlidesByCategory('hymn').length },
        { id: 'custom', label: 'Custom', icon: FileText, count: getSlidesByCategory('custom').length },
    ]

    const filteredSlides = useMemo(() => {
        let slides = librarySlides

        if (selectedCategory) {
            slides = slides.filter((s) => s.category === selectedCategory)
        }

        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase()
            slides = slides.filter(
                (s) =>
                    s.name.toLowerCase().includes(lowerQuery) ||
                    s.contents.some((c) => c.toLowerCase().includes(lowerQuery))
            )
        }

        return slides
    }, [librarySlides, selectedCategory, searchQuery])

    const handleUseSlide = (slide: any) => {
        useSlide(slide)
        // Optionally close the panel or show a confirmation
    }

    const handleDeleteSlide = async (slideId: string, slideName: string) => {
        const confirmed = await confirm({
            title: 'Remove from Library',
            message: `Are you sure you want to remove "${slideName}" from your library?`,
            type: 'danger',
            confirmText: 'Remove',
        })

        if (confirmed) {
            removeFromLibrary(slideId)
        }
    }

    if (!isOpen) return null

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-white dark:bg-gray-900 shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                    <Library className="w-5 h-5 text-primary-600" />
                    <h2 className="font-semibold text-gray-900 dark:text-white flex-1">
                        My Library
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        {libraryCount} slides
                    </span>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search library..."
                            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* Categories */}
                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex gap-1 overflow-x-auto">
                        {categories.map((cat) => (
                            <button
                                key={cat.id || 'all'}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${selectedCategory === cat.id
                                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                            >
                                <cat.icon className="w-3 h-3" />
                                {cat.label}
                                <span className="ml-1 text-[10px] opacity-60">({cat.count})</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Slides List */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredSlides.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                            <Library className="w-12 h-12 mb-3 opacity-50" />
                            <p className="font-medium">No slides found</p>
                            <p className="text-sm mt-1">
                                {searchQuery
                                    ? 'Try a different search term'
                                    : 'Save slides to your library for quick access'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredSlides.map((slide) => (
                                <div
                                    key={slide.id}
                                    className="group relative bg-gray-50 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
                                >
                                    {/* Slide Preview */}
                                    <div
                                        className="aspect-video flex items-center justify-center p-3 text-center"
                                        style={{
                                            background:
                                                slide.background ||
                                                'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                        }}
                                    >
                                        <span className="text-white text-xs font-medium line-clamp-2">
                                            {slide.contents?.[0] || slide.name}
                                        </span>
                                    </div>

                                    {/* Info */}
                                    <div className="p-3">
                                        <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                            {slide.name}
                                        </h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 capitalize">
                                            {slide.category}
                                        </p>
                                    </div>

                                    {/* Actions */}
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleUseSlide(slide)}
                                            className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                            title="Use this slide"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSlide(slide.id, slide.name)}
                                            className="p-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700"
                                            title="Remove from library"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <ConfirmDialog />
        </>
    )
}
