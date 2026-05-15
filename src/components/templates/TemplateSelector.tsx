import { useState, useEffect } from 'react'
import { LayoutTemplate, ChevronDown, X } from 'lucide-react'
import { useTemplates, type TemplateItem, type SlideType } from '../../hooks/useTemplates'

const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
    bible: 'Bible',
    song: 'Song',
    hymn: 'Hymn',
    text: 'Text',
    media: 'Media',
    announcement: 'Announcement',
    countdown: 'Countdown',
    any: 'Any',
}

const CATEGORY_COLORS: Record<string, string> = {
    announcement: '#3B82F6',
    worship: '#F59E0B',
    sermon: '#F97316',
    prayer: '#10B981',
    general: '#6B7280',
}

interface TemplateSelectorProps {
    slideType: SlideType
    selectedTemplate: TemplateItem | null
    onSelect: (template: TemplateItem | null) => void
    maxVisible?: number
}

export function TemplateSelector({ slideType, selectedTemplate, onSelect, maxVisible = 4 }: TemplateSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const { getTemplatesForSlideType, isLoading } = useTemplates()

    const templates = getTemplatesForSlideType(slideType)

    if (templates.length === 0 && !isLoading) return null

    return (
        <div className="pt-3 mt-3 border-t border-[var(--border-subtle)]">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    <LayoutTemplate className="w-3 h-3" />
                    Template
                </div>
                {selectedTemplate && (
                    <button
                        onClick={() => onSelect(null)}
                        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                        title="Clear template"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>

            {isLoading ? (
                <div className="flex gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-6 w-16 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {templates.slice(0, isOpen ? undefined : maxVisible).map(template => {
                        const isSelected = selectedTemplate?._id === template._id
                        const dotColor = CATEGORY_COLORS[template.category] || '#6B7280'
                        return (
                            <button
                                key={template._id}
                                onClick={() => onSelect(isSelected ? null : template)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full transition-all ${
                                    isSelected
                                        ? 'bg-[var(--accent-teal)] text-white shadow-sm'
                                        : 'bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)]'
                                }`}
                                title={template.description || template.name}
                            >
                                {!isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
                                )}
                                {template.name}
                            </button>
                        )
                    })}
                    {templates.length > maxVisible && (
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            {isOpen ? 'Less' : `+${templates.length - maxVisible}`}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}