import { useState, useMemo } from 'react'
import { Search, Trash2, Plus, FolderOpen, BookOpen, Music, FileText } from 'lucide-react'
import { useLibrary } from '../../hooks/useLibrary'
import { useConfirmDialog } from '../modals/ConfirmDialog'

interface LibraryContentProps {
    compact?: boolean
}

export function LibraryContent({ compact = false }: LibraryContentProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

    const {
        librarySlides,
        removeFromLibrary,
        useSlide,
        getSlidesByCategory,
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

    return (
        <div className="flex flex-col h-full bg-[var(--bg-primary)]">
            {/* Search & Categories */}
            <div className={`p-4 border-b border-[var(--border-subtle)] space-y-3 ${compact ? 'p-2' : ''}`}>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search library..."
                        className="w-full pl-9 pr-4 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent-teal)] outline-none"
                    />
                </div>

                <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                    {categories.map((cat) => (
                        <button
                            key={cat.id || 'all'}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${selectedCategory === cat.id
                                ? 'bg-[var(--accent-teal)] text-white'
                                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                }`}
                        >
                            <cat.icon className="w-3 h-3" />
                            {cat.label}
                            <span className="opacity-60">({cat.count})</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Slides List */}
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {filteredSlides.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center opacity-40 py-8">
                        <FolderOpen className="w-10 h-10 mb-2" />
                        <p className="text-xs font-medium">No slides found</p>
                    </div>
                ) : (
                    <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                        {filteredSlides.map((slide) => (
                            <div
                                key={slide.id}
                                className="group relative bg-[var(--bg-secondary)] rounded-lg overflow-hidden border border-[var(--border-default)] hover:border-[var(--accent-teal)]/50 transition-all"
                            >
                                {/* Slide Preview */}
                                <div
                                    className="aspect-video flex items-center justify-center p-3 text-center cursor-pointer"
                                    style={{
                                        background: slide.background || 'var(--bg-tertiary)',
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                    onClick={() => handleUseSlide(slide)}
                                >
                                    <span className="text-white text-[10px] font-medium line-clamp-3 drop-shadow-md">
                                        {slide.contents?.[0] || slide.name}
                                    </span>
                                    
                                    {/* Action Overlay */}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleUseSlide(slide);
                                            }}
                                            className="p-1.5 bg-[var(--accent-teal)] text-white rounded-md shadow-lg hover:scale-110 transition-transform"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSlide(slide.id, slide.name);
                                            }}
                                            className="p-1.5 bg-red-500 text-white rounded-md shadow-lg hover:scale-110 transition-transform"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="px-2 py-1.5 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)]">
                                    <h4 className="text-[10px] font-medium text-[var(--text-primary)] truncate">
                                        {slide.name}
                                    </h4>
                                    <p className="text-[9px] text-[var(--text-muted)] capitalize">
                                        {slide.category}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <ConfirmDialog />
        </div>
    )
}
