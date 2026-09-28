import { useState } from 'react'
import {
    AlignLeft, AlignCenter, AlignRight,
    Bold, Italic, Underline, Type,
    ZoomIn, ZoomOut, RotateCcw, Save, X,
    ArrowUpToLine, ArrowDownToLine
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Slide, SlideStyle } from '../../types'
import { TipTapEditor } from './TipTapEditor'
import { BackgroundPicker, type BackgroundSelection } from '../utils/BackgroundPicker'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useGuardedClose } from '../../hooks/useGuardedClose'
import { Modal } from '../modals/Modal'

const REF_STYLE_COLOR_PRESETS = ['#ffffff', '#f59e0b', '#0d9488', '#3b82f6', '#ef4444']

interface SlideEditorProps {
    slide: Slide | null
    isOpen: boolean
    onClose: () => void
    onSave: (slide: Slide) => void
}

export function SlideEditor({ slide, isOpen, onClose, onSave }: SlideEditorProps) {
    const [editedSlide, setEditedSlide] = useState<Slide | null>(null)
    const isDirty = !!slide && !!editedSlide && JSON.stringify(editedSlide) !== JSON.stringify(slide)
    const requestClose = useGuardedClose(isDirty, onClose)
    const [activeContentIndex, setActiveContentIndex] = useState(0)

    // Re-seed the working copy whenever a new slide comes in (adjusted
    // during render rather than in an effect).
    const [prevSlide, setPrevSlide] = useState<Slide | null>(null)
    if (slide !== prevSlide) {
        setPrevSlide(slide)
        if (slide) {
            setEditedSlide({ ...slide })
            setActiveContentIndex(0)
        }
    }

    const settings = useAppStore((state) => state.settings)
    const resolvedBg = useLocalBackground(editedSlide?.background, editedSlide?.localFilePath)

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

    const handleBackgroundChange = (selection: BackgroundSelection) => {
        setEditedSlide({
            ...editedSlide,
            background: selection.background,
            backgroundType: selection.backgroundType,
            backgroundStorageId: selection.backgroundStorageId,
            localFilePath: selection.localFilePath,
            localMediaId: selection.localMediaId,
        })
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
        // Escape and a backdrop click go through the unsaved-changes guard; a
        // colour picker or menu inside that handles Escape prevents it first.
        <Modal
            isOpen={isOpen}
            onClose={requestClose}
            ariaLabel="Slide editor"
            overlayClassName="bg-black/60 backdrop-blur-sm"
            className="w-full h-full flex flex-col bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-2xl"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                    <Type className="w-5 h-5 text-[var(--accent-teal)]" />
                    <input
                        type="text"
                        value={editedSlide.name}
                        onChange={(e) => setEditedSlide({ ...editedSlide, name: e.target.value })}
                        className="text-lg font-semibold bg-transparent border-none focus:outline-none text-[var(--text-primary)]"
                        placeholder="Slide Name"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg transition-all shadow-sm"
                    >
                        <Save className="w-4 h-4" />
                        Save Changes
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Editor Panel */}
                <div className="w-1/2 flex flex-col border-r border-[var(--border-subtle)]">
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                        {/* Font Selection */}
                        <select
                            value={editedSlide.slideStyle?.font || settings.defaultFont}
                            onChange={(e) => updateStyle({ font: e.target.value })}
                            className="px-2 py-1 text-sm border border-[var(--border-default)] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]"
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
                                className="p-1.5 rounded hover:bg-[var(--bg-tertiary)]"
                            >
                                <ZoomOut className="w-4 h-4" />
                            </button>
                            <span className="text-sm text-[var(--text-secondary)] w-12 text-center">
                                {editedSlide.slideStyle?.fontSizePercent || 100}%
                            </span>
                            <button
                                onClick={() => updateStyle({
                                    fontSizePercent: Math.min(200, (editedSlide.slideStyle?.fontSizePercent || 100) + 10)
                                })}
                                className="p-1.5 rounded hover:bg-[var(--bg-tertiary)]"
                            >
                                <ZoomIn className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Verse reference position — bible slides only.
                            Tri-state: Default (uses global setting), Above, Below. */}
                        {editedSlide.type === 'bible' && (() => {
                            const slideRefPos = editedSlide.slideStyle?.verseRefPosition // undefined | 'top' | 'bottom'
                            const globalRefPos = settings.slideStyles?.verseRefPosition ?? 'bottom'
                            const usingDefault = slideRefPos === undefined
                            return (
                                <>
                                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                                    <div className="flex items-center gap-1.5" title={`Verse reference position (global default: ${globalRefPos === 'top' ? 'Above' : 'Below'})`}>
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                            Ref
                                        </span>
                                        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                                            <button
                                                onClick={() => updateStyle({ verseRefPosition: undefined })}
                                                title={`Use global default (${globalRefPos === 'top' ? 'Above' : 'Below'})`}
                                                className={`px-2 py-1 rounded text-xs ${
                                                    usingDefault
                                                        ? 'bg-white dark:bg-gray-600 shadow-sm text-[var(--text-primary)]'
                                                        : 'text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                            >
                                                Default
                                            </button>
                                            <button
                                                onClick={() => updateStyle({ verseRefPosition: 'top' })}
                                                title="Reference above body (override)"
                                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                                                    slideRefPos === 'top'
                                                        ? 'bg-white dark:bg-gray-600 shadow-sm text-[var(--text-primary)]'
                                                        : 'text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                            >
                                                <ArrowUpToLine className="w-3.5 h-3.5" />
                                                Above
                                            </button>
                                            <button
                                                onClick={() => updateStyle({ verseRefPosition: 'bottom' })}
                                                title="Reference below body (override)"
                                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                                                    slideRefPos === 'bottom'
                                                        ? 'bg-white dark:bg-gray-600 shadow-sm text-[var(--text-primary)]'
                                                        : 'text-[var(--text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                            >
                                                <ArrowDownToLine className="w-3.5 h-3.5" />
                                                Below
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )
                        })()}
                    </div>

                    {/* Verse reference style override — bible slides only. Each control sets an
                        explicit per-slide value the moment it's touched; "Reset" clears all five
                        back to inheriting the global Display Settings default. */}
                    {editedSlide.type === 'bible' && (() => {
                        const s = editedSlide.slideStyle
                        const g = settings.slideStyles
                        const resolvedColor = s?.verseRefColor ?? g?.verseRefColor
                        const resolvedBold = s?.verseRefBold ?? g?.verseRefBold ?? false
                        const resolvedItalic = s?.verseRefItalic ?? g?.verseRefItalic ?? false
                        const resolvedUnderline = s?.verseRefUnderline ?? g?.verseRefUnderline ?? false
                        const resolvedSizePercent = s?.verseRefSizePercent ?? g?.verseRefSizePercent ?? 100
                        const hasOverride = s?.verseRefColor !== undefined || s?.verseRefBold !== undefined ||
                            s?.verseRefItalic !== undefined || s?.verseRefUnderline !== undefined ||
                            s?.verseRefSizePercent !== undefined

                        return (
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex-wrap">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    Ref Style
                                </span>

                                {/* Color */}
                                <div className="flex items-center gap-1">
                                    {REF_STYLE_COLOR_PRESETS.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => updateStyle({ verseRefColor: color })}
                                            title={color}
                                            className={`w-5 h-5 rounded-full transition-all ${resolvedColor === color ? 'ring-2 ring-offset-1 ring-offset-gray-50 dark:ring-offset-gray-800' : 'hover:scale-105'
                                                }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                    <input
                                        type="color"
                                        value={resolvedColor && resolvedColor.startsWith('#') ? resolvedColor : '#ffffff'}
                                        onChange={(e) => updateStyle({ verseRefColor: e.target.value })}
                                        title="Custom color"
                                        className="w-5 h-5 rounded-full border-0 cursor-pointer"
                                    />
                                </div>

                                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                                {/* Bold / Italic / Underline */}
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => updateStyle({ verseRefBold: !resolvedBold })}
                                        title="Bold"
                                        className={`p-1.5 rounded ${resolvedBold ? 'bg-white dark:bg-gray-600 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                    >
                                        <Bold className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => updateStyle({ verseRefItalic: !resolvedItalic })}
                                        title="Italic"
                                        className={`p-1.5 rounded ${resolvedItalic ? 'bg-white dark:bg-gray-600 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                    >
                                        <Italic className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => updateStyle({ verseRefUnderline: !resolvedUnderline })}
                                        title="Underline"
                                        className={`p-1.5 rounded ${resolvedUnderline ? 'bg-white dark:bg-gray-600 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                    >
                                        <Underline className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                                {/* Size */}
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => updateStyle({ verseRefSizePercent: Math.max(50, resolvedSizePercent - 10) })}
                                        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                    >
                                        <ZoomOut className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-xs text-[var(--text-secondary)] w-9 text-center">
                                        {resolvedSizePercent}%
                                    </span>
                                    <button
                                        onClick={() => updateStyle({ verseRefSizePercent: Math.min(200, resolvedSizePercent + 10) })}
                                        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                                    >
                                        <ZoomIn className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                {hasOverride && (
                                    <>
                                        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                                        <button
                                            onClick={() => updateStyle({
                                                verseRefColor: undefined,
                                                verseRefBold: undefined,
                                                verseRefItalic: undefined,
                                                verseRefUnderline: undefined,
                                                verseRefSizePercent: undefined,
                                            })}
                                            title="Reset to global default"
                                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:bg-gray-200 dark:hover:bg-gray-600"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            Reset
                                        </button>
                                    </>
                                )}
                            </div>
                        )
                    })()}

                    {/* Content Blocks */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {editedSlide.contents.map((content, index) => (
                            <div
                                key={index}
                                className={`relative group rounded-lg border-2 transition-colors ${activeContentIndex === index
                                    ? 'border-[var(--accent-teal)]'
                                    : 'border-[var(--border-subtle)] hover:border-gray-300 dark:hover:border-gray-600'
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
                                        className="absolute top-2 right-2 p-1 text-[var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            onClick={addContentBlock}
                            className="w-full py-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-[var(--text-muted)] hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)] transition-colors"
                        >
                            + Add Content Block
                        </button>

                        {/* Background Picker */}
                        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                            <BackgroundPicker
                                value={{
                                    background: editedSlide.background || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    backgroundType: editedSlide.backgroundType || 'gradient',
                                    backgroundStorageId: editedSlide.backgroundStorageId,
                                    localFilePath: editedSlide.localFilePath,
                                    localMediaId: editedSlide.localMediaId,
                                }}
                                onChange={handleBackgroundChange}
                            />
                        </div>
                    </div>
                </div>

                {/* Preview Panel */}
                <div className="w-1/2 flex flex-col bg-[var(--bg-tertiary)]">
                    <div className="px-4 py-2 border-b border-[var(--border-subtle)]">
                        <h4 className="text-sm font-medium text-[var(--text-secondary)]">Live Preview</h4>
                    </div>
                    <div className="flex-1 flex items-center justify-center p-6">
                        <div
                            className="w-full max-w-lg aspect-video rounded-lg shadow-xl overflow-hidden relative flex items-center justify-center p-8"
                            style={{
                                background: editedSlide.backgroundType === 'video' || editedSlide.backgroundType === 'image'
                                    ? '#0a0a0a'
                                    : (resolvedBg || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'),
                                fontFamily: editedSlide.slideStyle?.font || settings.defaultFont,
                                textAlign: (editedSlide.slideStyle?.alignment as React.CSSProperties['textAlign']) || 'center',
                            }}
                        >
                            {editedSlide.backgroundType === 'video' && resolvedBg && (
                                <video
                                    src={resolvedBg}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                />
                            )}
                            {editedSlide.backgroundType === 'image' && resolvedBg && (
                                <img
                                    src={resolvedBg}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                />
                            )}
                            <div
                                className="relative z-10 text-white tiptap-preview drop-shadow-lg"
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
        </Modal>
    )
}
