import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, X, ChevronLeft, Music } from 'lucide-react'
import { buildMusicIndex, searchMusicIndex } from '../../lib/search/musicSearch'
import { useHymn, useSlideCreation, useAnalytics } from '../../hooks'
import { AnalyticsEventType } from '../../services/analytics/types'
import { useVoiceSearch } from '../../hooks/useVoiceSearch'
import { VoiceSearchButton } from '../common/VoiceSearchButton'
import { useAppStore } from '../../store/appStore'
import { TemplateSelector } from '../templates/TemplateSelector'
import { type TemplateItem } from '../../hooks/useTemplates'
import type { Hymn } from '../../types'

interface HymnListProps {
    onClose: () => void
    isInline?: boolean
}

export function HymnList({ onClose, isInline = false }: HymnListProps) {
    const [query, setQuery] = useState('')
    const [hymns, setHymns] = useState<Hymn[]>([])
    const [selectedHymn, setSelectedHymn] = useState<Hymn | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)

    const { getAllHymns } = useHymn()
    const { createHymnSlides } = useSlideCreation()
    const { trackEvent } = useAnalytics()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)

    const voice = useVoiceSearch({
        onFinal: (text) => setQuery(text),
    })

    // Load hymns
    useEffect(() => {
        const loadHymns = async () => {
            const allHymns = await getAllHymns()
            setHymns(allHymns)
            setLoading(false)
        }
        loadHymns()
    }, [getAllHymns])

    // BM25 index over title/number/author + lyrics (chorus + verses). The
    // number goes in the subtitle field so a numeric lookup ("123") still
    // works; digits survive normalizeText.
    const hymnIndex = useMemo(
        () => buildMusicIndex(
            hymns.map((h) => ({
                id: h.number,
                title: h.title,
                subtitle: `${h.author ?? ''} ${h.number}`.trim(),
                body: `${h.chorus ?? ''}\n${(h.verses ?? []).join('\n')}`,
            })),
        ),
        [hymns],
    )

    // Ranked, typo/punctuation/whitespace-tolerant search, so a half-remembered
    // line finds the hymn even without its title/number. Empty query browses all.
    const filteredHymns = useMemo(() => {
        const q = query.trim()
        if (!q) return hymns
        const byId = new Map(hymns.map((h) => [h.number, h]))
        return searchMusicIndex(hymnIndex, q, 50)
            .map((r) => byId.get(r.item.id))
            .filter((h): h is Hymn => !!h)
    }, [hymns, hymnIndex, query])

    const handleCreateSlides = useCallback(() => {
        if (selectedHymn) {
            const slides = createHymnSlides(selectedHymn as any, { template: selectedTemplate })
            slides.forEach(slide => {
                appendActiveSlide(slide)
            })
            trackEvent(AnalyticsEventType.HYMN_VIEWED, {
                hymn_number: selectedHymn.number,
                title: selectedHymn.title,
                slide_count: slides.length,
                has_template: !!selectedTemplate,
            })
            onClose()
        }
    }, [selectedHymn, createHymnSlides, appendActiveSlide, onClose, selectedTemplate, trackEvent])

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg">
            {/* Header - Hidden when inline */}
            {!isInline && (
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <h2 className="text-lg font-semibold">Display Hymns</h2>
                    </div>
                </div>
            )}

            {/* Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        value={voice.isListening ? voice.transcript : query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={voice.isListening ? 'Listening…' : 'Search hymns by number or title…'}
                        className="w-full pl-10 pr-10 py-2 border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <VoiceSearchButton
                            isListening={voice.isListening}
                            isSupported={voice.isSupported}
                            error={voice.error}
                            onClick={voice.isListening ? voice.stop : voice.start}
                        />
                    </div>
                </div>
            </div>

            {/* Hymn List */}
            {!selectedHymn ? (
                <div className="flex-1 overflow-y-auto">
                    {filteredHymns.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>No hymns found</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-200 dark:divide-gray-800">
                            {filteredHymns.map((hymn) => (
                                <button
                                    key={hymn.number}
                                    onClick={() => setSelectedHymn(hymn)}
                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="w-10 h-10 flex items-center justify-center bg-primary-100 text-primary-600 rounded-full text-sm font-medium">
                                            {hymn.number}
                                        </span>
                                        <div>
                                            <h3 className="font-medium text-gray-900 dark:text-white">
                                                {hymn.title}
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                                {hymn.verses.length} verses
                                                {hymn.chorus && ' + chorus'}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                /* Hymn Detail */
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-semibold text-lg">{selectedHymn.title}</h3>
                                <p className="text-sm text-gray-500">Hymn #{selectedHymn.number}</p>
                            </div>
                            <button
                                onClick={() => setSelectedHymn(null)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Verses */}
                        <div className="space-y-4">
                            {selectedHymn.verses.map((verse, index) => (
                                <div key={index}>
                                    <h4 className="text-sm font-medium text-primary-600 mb-1">
                                        Verse {index + 1}
                                    </h4>
                                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                        {verse}
                                    </p>
                                </div>
                            ))}

                            {/* Chorus */}
                            {selectedHymn.chorus && selectedHymn.chorus !== 'false' && (
                                <div className="bg-primary-50 dark:bg-primary-900/20 p-3 rounded-lg">
                                    <h4 className="text-sm font-medium text-primary-600 mb-1">Chorus</h4>
                                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                        {selectedHymn.chorus}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Template Selector */}
                    <TemplateSelector
                        slideType="hymn"
                        selectedTemplate={selectedTemplate}
                        onSelect={setSelectedTemplate}
                    />

                    <div className="flex justify-end gap-2 mt-4">
                        <button
                            onClick={() => setSelectedHymn(null)}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            Back
                        </button>
                        <button
                            onClick={handleCreateSlides}
                            className="px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm font-medium"
                        >
                            Create Slides ({selectedHymn.verses.length + (selectedHymn.chorus && selectedHymn.chorus !== 'false' ? 1 : 0)} verses)
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
