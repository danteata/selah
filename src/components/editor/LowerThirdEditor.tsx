import { useState, useEffect } from 'react'
import {
    AlignLeft, AlignCenter, AlignRight,
    Palette, Save, X, PanelBottom
} from 'lucide-react'
import type { Slide, SlideStyle } from '../../types'

interface LowerThirdEditorProps {
    slide: Slide | null
    isOpen: boolean
    onClose: () => void
    onSave: (slide: Slide) => void
}

const STYLE_OPTIONS: { value: NonNullable<SlideStyle['lowerThirdStyle']>; label: string; desc: string }[] = [
    { value: 'standard', label: 'Standard', desc: 'Dark semi-transparent bar' },
    { value: 'minimalist', label: 'Minimalist', desc: 'Clean text, no bar' },
    { value: 'accent-bar', label: 'Accent Bar', desc: 'Colored left stripe' },
    { value: 'gradient-bar', label: 'Gradient', desc: 'Gradient background bar' },
]

const POSITION_OPTIONS: { value: NonNullable<SlideStyle['lowerThirdPosition']>; icon: typeof AlignLeft }[] = [
    { value: 'left', icon: AlignLeft },
    { value: 'center', icon: AlignCenter },
    { value: 'right', icon: AlignRight },
]

const ACCENT_PRESETS = [
    '#0d9488', // teal
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // emerald
    '#ec4899', // pink
    '#6366f1', // indigo
]

export function LowerThirdEditor({ slide, isOpen, onClose, onSave }: LowerThirdEditorProps) {
    const [title, setTitle] = useState('')
    const [subtitle, setSubtitle] = useState('')
    const [ltStyle, setLtStyle] = useState<NonNullable<SlideStyle['lowerThirdStyle']>>('standard')
    const [position, setPosition] = useState<NonNullable<SlideStyle['lowerThirdPosition']>>('left')
    const [accentColor, setAccentColor] = useState('#0d9488')

    // Initialize state when slide changes
    useEffect(() => {
        if (slide) {
            // Parse title from contents
            const rawTitle = slide.contents?.[0] || ''
            const stripped = rawTitle.replace(/<[^>]*>/g, '').trim()
            setTitle(stripped || slide.name || '')
            setSubtitle(slide.slideStyle?.lowerThirdSubtitle || '')
            setLtStyle(slide.slideStyle?.lowerThirdStyle || 'standard')
            setPosition(slide.slideStyle?.lowerThirdPosition || 'left')
            setAccentColor(slide.slideStyle?.lowerThirdAccentColor || '#0d9488')
        }
    }, [slide])

    // Keyboard shortcut to close
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            window.addEventListener('keydown', handleEscape)
            return () => window.removeEventListener('keydown', handleEscape)
        }
    }, [isOpen, onClose])

    if (!isOpen || !slide) return null

    const handleSave = () => {
        const updatedSlide: Slide = {
            ...slide,
            name: title || 'Lower Third',
            contents: [`<p>${title}</p>`],
            slideStyle: {
                ...slide.slideStyle,
                lowerThirdStyle: ltStyle,
                lowerThirdPosition: position,
                lowerThirdAccentColor: accentColor,
                lowerThirdSubtitle: subtitle,
            },
        }
        onSave(updatedSlide)
        onClose()
    }

    // Build preview styles based on selected options
    const previewBarStyle = (): React.CSSProperties => {
        const base: React.CSSProperties = {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
        }

        const align = position === 'center' ? 'center' : position === 'right' ? 'flex-end' : 'flex-start'
        base.alignItems = align

        switch (ltStyle) {
            case 'standard':
                base.background = 'rgba(0, 0, 0, 0.75)'
                base.backdropFilter = 'blur(8px)'
                break
            case 'minimalist':
                base.background = 'transparent'
                break
            case 'accent-bar':
                base.background = 'rgba(0, 0, 0, 0.75)'
                base.backdropFilter = 'blur(8px)'
                base.borderLeft = `4px solid ${accentColor}`
                break
            case 'gradient-bar':
                base.background = `linear-gradient(135deg, ${accentColor}ee, ${accentColor}88)`
                base.backdropFilter = 'blur(8px)'
                break
        }

        return base
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <PanelBottom className="w-5 h-5 text-teal-500" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Lower Third</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Live Preview */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Preview
                        </label>
                        <div
                            className="aspect-video rounded-xl overflow-hidden relative bg-gray-800"
                            style={{
                                backgroundImage: slide.background ? `url(${slide.background})` : undefined,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            }}
                        >
                            {/* Dim background overlay for preview */}
                            <div className="absolute inset-0 bg-black/20" />

                            {/* Lower third bar */}
                            <div style={previewBarStyle()}>
                                <span
                                    className="text-white font-semibold drop-shadow-lg"
                                    style={{ fontSize: '14px' }}
                                >
                                    {title || 'Speaker Name'}
                                </span>
                                {subtitle && (
                                    <span
                                        className="text-white/80 drop-shadow-lg"
                                        style={{ fontSize: '11px', marginTop: '2px' }}
                                    >
                                        {subtitle}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Title Input */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Title
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Pastor John Smith"
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 transition-all"
                        />
                    </div>

                    {/* Subtitle Input */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Subtitle
                        </label>
                        <input
                            type="text"
                            value={subtitle}
                            onChange={(e) => setSubtitle(e.target.value)}
                            placeholder="e.g. Senior Pastor · Grace Community Church"
                            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 transition-all"
                        />
                    </div>

                    {/* Style Selector */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Style
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {STYLE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => setLtStyle(opt.value)}
                                    className={`px-4 py-3 rounded-xl border-2 text-left transition-all ${ltStyle === opt.value
                                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                >
                                    <span className={`block text-sm font-medium ${ltStyle === opt.value ? 'text-teal-700 dark:text-teal-300' : 'text-gray-900 dark:text-white'
                                        }`}>
                                        {opt.label}
                                    </span>
                                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                        {opt.desc}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Position Selector */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Position
                        </label>
                        <div className="flex gap-2">
                            {POSITION_OPTIONS.map((opt) => {
                                const Icon = opt.icon
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => setPosition(opt.value)}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all ${position === opt.value
                                            ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                                            }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        <span className="text-sm font-medium capitalize">{opt.value}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Accent Color */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            <Palette className="w-3.5 h-3.5 inline mr-1.5" />
                            Accent Color
                        </label>
                        <div className="flex items-center gap-3">
                            <div className="flex gap-2 flex-wrap">
                                {ACCENT_PRESETS.map((color) => (
                                    <button
                                        key={color}
                                        onClick={() => setAccentColor(color)}
                                        className={`w-8 h-8 rounded-lg transition-all ${accentColor === color ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110' : 'hover:scale-105'
                                            }`}
                                        style={{
                                            backgroundColor: color,
                                            outline: accentColor === color ? `2px solid ${color}` : undefined,
                                            outlineOffset: accentColor === color ? '2px' : undefined,
                                        }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            <div className="flex items-center gap-2 ml-2">
                                <input
                                    type="color"
                                    value={accentColor}
                                    onChange={(e) => setAccentColor(e.target.value)}
                                    className="w-8 h-8 rounded-lg border-0 cursor-pointer"
                                />
                                <span className="text-xs text-gray-500 font-mono">{accentColor}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90"
                        style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}
                    >
                        <Save className="w-4 h-4" />
                        Save
                    </button>
                </div>
            </div>
        </div>
    )
}
