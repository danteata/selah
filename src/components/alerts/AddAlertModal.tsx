import { useState, useEffect } from 'react'
import { X, Bell, Plus } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Alert, Slide } from '../../types'
import { BackgroundPicker, type BackgroundSelection } from '../utils/BackgroundPicker'

interface AddAlertModalProps {
    isOpen?: boolean
    onClose?: () => void
    editingSlide?: Slide | null
    isInline?: boolean
}

const DEFAULT_BG: BackgroundSelection = {
    label: 'Midnight',
    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    backgroundType: 'gradient',
}

const ALERT_STYLES = [
    {
        id: 'fullscreen',
        label: 'Full Screen',
        desc: 'Slide',
        icon: '⬛',
    },
    {
        id: 'banner',
        label: 'Banner',
        desc: 'Overlay',
        icon: '▬',
    },
]

export function AddAlertModal({ isOpen = true, onClose, editingSlide, isInline = false }: AddAlertModalProps) {
    const [content, setContent] = useState('')
    const [title, setTitle] = useState('')
    const [duration, setDuration] = useState(5)
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
    const [alertStyle, setAlertStyle] = useState<'banner' | 'fullscreen'>('fullscreen')
    const [selectedBg, setSelectedBg] = useState<BackgroundSelection>(DEFAULT_BG)

    const setAlerts = useAppStore((state) => state.setAlerts)
    const alerts = useAppStore((state) => state.alerts)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const updateActiveSlide = useAppStore((state) => state.updateActiveSlide)
    const activeSchedule = useAppStore((state) => state.activeSchedule)

    // Pre-populate form when editing an existing slide
    useEffect(() => {
        if (editingSlide && editingSlide.type === 'alert') {
            // Parse title and content from contents array
            const contents = editingSlide.contents || []
            if (contents.length >= 2) {
                // Has title and content
                const titleHtml = contents[0] || ''
                const contentHtml = contents[1] || ''
                setTitle(titleHtml.replace(/<[^>]*>/g, '').trim())
                setContent(contentHtml.replace(/<[^>]*>/g, '').trim())
            } else if (contents.length === 1) {
                // Only content, no title
                setTitle('')
                setContent(contents[0].replace(/<[^>]*>/g, '').trim())
            }
            // Set alert style based on layout
            setAlertStyle(editingSlide.layout === 'lower-third' ? 'banner' : 'fullscreen')
            // Set background
            if (editingSlide.background) {
                setSelectedBg({
                    background: editingSlide.background,
                    backgroundType: editingSlide.backgroundType || 'gradient',
                    backgroundStorageId: editingSlide.backgroundStorageId,
                })
            }
        } else {
            // Reset to defaults for new alert
            setContent('')
            setTitle('')
            setDuration(5)
            setPriority('medium')
            setAlertStyle('fullscreen')
            setSelectedBg(DEFAULT_BG)
        }
    }, [editingSlide, isOpen, isInline])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!content.trim()) return

        const newAlert: Alert = {
            id: editingSlide?.id || `alert_${Date.now()}`,
            title: title.trim() || undefined,
            content: content.trim(),
            duration,
            priority,
            createdAt: new Date().toISOString(),
        }

        // Always add to alerts store (for overlay/banner system)
        setAlerts([...alerts, newAlert])

        // Create or update the slide
        const slide: Slide = {
            id: editingSlide?.id || `slide_alert_${Date.now()}`,
            index: editingSlide?.index ?? 0,
            name: title.trim() || `Alert: ${content.trim().slice(0, 30)}${content.length > 30 ? '…' : ''}`,
            type: 'alert',
            layout: alertStyle === 'banner' ? 'lower-third' : 'full-text',
            contents: title.trim()
                ? [`<p style="font-size:1.4em;font-weight:700;">${title.trim()}</p>`, `<p>${content.trim()}</p>`]
                : [`<p>${content.trim()}</p>`],
            userId: editingSlide?.userId || '',
            churchId: editingSlide?.churchId || '',
            scheduleId: editingSlide?.scheduleId || activeSchedule?._id || '',
            background: selectedBg.background,
            backgroundType: selectedBg.backgroundType,
            backgroundStorageId: selectedBg.backgroundStorageId ?? null,
            slideStyle: {
                fontSize: alertStyle === 'banner' ? 3.5 : 5,
                alignment: 'center',
                brightness: 80,
                blur: 0,
                ...(alertStyle === 'banner' && {
                    lowerThirdStyle: 'standard',
                    lowerThirdPosition: 'center',
                }),
            },
        }

        if (editingSlide) {
            updateActiveSlide(slide)
        } else {
            appendActiveSlide(slide)
        }

        if (!isInline) {
            // Reset
            setContent('')
            setTitle('')
            setDuration(5)
            setPriority('medium')
            setAlertStyle('fullscreen')
            setSelectedBg(DEFAULT_BG)
            onClose?.()
        }
    }

    if (!isOpen && !isInline) return null

    const contentArea = (
        <div className={`${isInline ? 'h-full bg-transparent' : 'w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-h-[90vh]'} flex flex-col overflow-hidden`}>
            {/* Header */}
            {!isInline && (
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                    <div className="p-2 bg-[var(--accent-teal)]/10 rounded-lg">
                        <AlertCircle className="w-5 h-5 text-[var(--accent-teal)]" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        {editingSlide ? 'Edit Alert' : 'Create Alert'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className={`${isInline ? 'p-3' : 'p-4'} space-y-4 overflow-y-auto flex-1 custom-scrollbar`}>

                    {/* Alert Style */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Display Style
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {ALERT_STYLES.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setAlertStyle(s.id as 'banner' | 'fullscreen')}
                                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all ${alertStyle === s.id
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                                        }`}
                                >
                                    <span className="text-2xl">{s.icon}</span>
                                    <span className="text-sm font-medium">{s.label}</span>
                                    <span className="text-[11px] text-center opacity-70">{s.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Title (optional) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Title <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Announcement"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                        />
                    </div>

                    {/* Content */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Message <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Enter your announcement..."
                            rows={3}
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                        />
                    </div>

                    {/* Background Picker */}
                    <BackgroundPicker
                        value={selectedBg}
                        onChange={setSelectedBg}
                        previewChildren={
                            <div className="text-center px-3">
                                {title && (
                                    <p className="text-white font-semibold text-sm leading-tight drop-shadow">{title}</p>
                                )}
                                {content && (
                                    <p className="text-white/80 text-xs mt-0.5 line-clamp-2">{content}</p>
                                )}
                                {!title && !content && (
                                    <p className="text-white/50 text-xs">Alert preview</p>
                                )}
                            </div>
                        }
                    />

                    {/* Duration */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Banner Duration <span className="text-gray-400 font-normal">(when shown as overlay)</span>
                        </label>
                        <div className="flex gap-2">
                            {[3, 5, 10, 15, 30].map((d) => (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => setDuration(d)}
                                    className={`flex-1 py-2 text-sm rounded-lg transition-colors ${duration === d
                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    {d}s
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Priority */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Priority
                        </label>
                        <div className="flex gap-2">
                            {[
                                { id: 'low', label: 'Low', color: 'bg-green-500' },
                                { id: 'medium', label: 'Medium', color: 'bg-yellow-500' },
                                { id: 'high', label: 'High', color: 'bg-red-500' },
                            ].map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPriority(p.id as 'low' | 'medium' | 'high')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg transition-colors ${priority === p.id
                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${p.color}`} />
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-2">
                        {!isInline && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="submit"
                            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg transition-all shadow-sm w-full"
                        >
                            <Plus className="w-4 h-4" />
                            {editingSlide ? 'UPDATE ALERT' : 'ADD ALERT'}
                        </button>
                    </div>
                </form>
            </div>
    )

    if (isInline) return contentArea

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
            {contentArea}
        </div>
    )
}
