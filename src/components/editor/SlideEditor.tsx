import { useState, useEffect, useRef } from 'react'
import {
    AlignLeft, AlignCenter, AlignRight,
    Bold, Italic, Type, ImageIcon, Palette,
    ZoomIn, ZoomOut, RotateCcw, Trash2, Save, X
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Slide, SlideStyle } from '../../types'
import { TipTapEditor } from './TipTapEditor'

interface SlideEditorProps {
    slide: Slide | null
    isOpen: boolean
    onClose: () => void
    onSave: (slide: Slide) => void
}

export function SlideEditor({ slide, isOpen, onClose, onSave }: SlideEditorProps) {
    const [editedSlide, setEditedSlide] = useState<Slide | null>(null)
    const [activeContentIndex, setActiveContentIndex] = useState(0)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const settings = useAppStore((state) => state.settings)

    useEffect(() => {
        if (slide) {
            setEditedSlide({ ...slide })
            setActiveContentIndex(0)
        }
    }, [slide])

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

    if (!isOpen || !editedSlide) return null

    const updateContent = (index: number, value: string) => {
        const newContents = [...editedSlide.contents]
        newContents[index] = value
        setEditedSlide({ ...editedSlide, contents: newContents })
    }

    const updateStyle = (updates: Partial<SlideStyle>) => {
        setEditedSlide({
            ...editedSlide,
            slideStyle: { ...editedSlide.slideStyle, ...updates }
        })
    }

    const addContentBlock = () => {
        setEditedSlide({
            ...editedSlide,
            contents: [...editedSlide.contents, '']
        })
        setActiveContentIndex(editedSlide.contents.length)
    }

    const removeContentBlock = (index: number) => {
        if (editedSlide.contents.length <= 1) return
        const newContents = editedSlide.contents.filter((_, i) => i !== index)
        setEditedSlide({ ...editedSlide, contents: newContents })
        setActiveContentIndex(Math.max(0, index - 1))
    }

    const handleSave = () => {
        if (editedSlide) {
            onSave(editedSlide)
            onClose()
        }
    }

    const alignmentOptions = [
        { value: 'left', icon: AlignLeft },
        { value: 'center', icon: AlignCenter },
        { value: 'right', icon: AlignRight },
    ]

    const fontOptions = [
        'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
        'Source Sans Pro', 'Poppins', 'Nunito', 'Georgia', 'Playfair Display'
    ]

    return (
        <div
            className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex-1 flex flex-col m-4 bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <Type className="w-5 h-5 text-primary-600" />
                        <input
                            type="text"
                            value={editedSlide.name}
                            onChange={(e) => setEditedSlide({ ...editedSlide, name: e.target.value })}
                            className="text-lg font-semibold bg-transparent border-none focus:outline-none text-gray-900 dark:text-white"
                            placeholder="Slide Name"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                        >
                            <Save className="w-4 h-4" />
                            Save Changes
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Editor Panel */}
                    <div className="w-1/2 flex flex-col border-r border-gray-200 dark:border-gray-800">
                        {/* Toolbar */}
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                            {/* Font Selection */}
                            <select
                                value={editedSlide.slideStyle?.font || settings.defaultFont}
                                onChange={(e) => updateStyle({ font: e.target.value })}
                                className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            >
                                {fontOptions.map((font) => (
                                    <option key={font} value={font}>{font}</option>
                                ))}
                            </select>

                            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                            {/* Alignment */}
                            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                                {alignmentOptions.map(({ value, icon: Icon }) => (
                                    <button
                                        key={value}
                                        onClick={() => updateStyle({ alignment: value })}
                                        className={`p-1.5 rounded ${(editedSlide.slideStyle?.alignment || 'center') === value
                                            ? 'bg-white dark:bg-gray-600 shadow-sm'
                                            : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                    </button>
                                ))}
                            </div>

                            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                            {/* Font Size */}
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => updateStyle({
                                        fontSizePercent: Math.max(50, (editedSlide.slideStyle?.fontSizePercent || 100) - 10)
                                    })}
                                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    <ZoomOut className="w-4 h-4" />
                                </button>
                                <span className="text-sm text-gray-600 dark:text-gray-400 w-12 text-center">
                                    {editedSlide.slideStyle?.fontSizePercent || 100}%
                                </span>
                                <button
                                    onClick={() => updateStyle({
                                        fontSizePercent: Math.min(200, (editedSlide.slideStyle?.fontSizePercent || 100) + 10)
                                    })}
                                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    <ZoomIn className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Content Blocks */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {editedSlide.contents.map((content, index) => (
                                <div
                                    key={index}
                                    className={`relative group rounded-lg border-2 transition-colors ${activeContentIndex === index
                                        ? 'border-primary-500'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                >
                                    <TipTapEditor
                                        content={content}
                                        onChange={(html) => updateContent(index, html)}
                                        onFocus={() => setActiveContentIndex(index)}
                                        placeholder={`Content block ${index + 1}...`}
                                        font={editedSlide.slideStyle?.font || settings.defaultFont}
                                        alignment={(editedSlide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center'}
                                    />
                                    {editedSlide.contents.length > 1 && (
                                        <button
                                            onClick={() => removeContentBlock(index)}
                                            className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                onClick={addContentBlock}
                                className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-500 hover:border-primary-500 hover:text-primary-600 transition-colors"
                            >
                                + Add Content Block
                            </button>
                        </div>
                    </div>

                    {/* Preview Panel */}
                    <div className="w-1/2 flex flex-col bg-gray-100 dark:bg-gray-800">
                        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">Live Preview</h4>
                        </div>
                        <div className="flex-1 flex items-center justify-center p-6">
                            <div
                                className="w-full max-w-lg aspect-video rounded-lg shadow-xl overflow-hidden flex items-center justify-center p-8"
                                style={{
                                    background: editedSlide.background || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    fontFamily: editedSlide.slideStyle?.font || settings.defaultFont,
                                    textAlign: (editedSlide.slideStyle?.alignment as any) || 'center',
                                }}
                            >
                                <div
                                    className="text-white tiptap-preview"
                                    style={{
                                        fontSize: `${(editedSlide.slideStyle?.fontSizePercent || 100) / 100 * 1.5}rem`,
                                    }}
                                >
                                    {editedSlide.contents.map((content, index) => (
                                        <div
                                            key={index}
                                            className="mb-2 last:mb-0"
                                            dangerouslySetInnerHTML={{ __html: content || '<p>(Empty)</p>' }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
