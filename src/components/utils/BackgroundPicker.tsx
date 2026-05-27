import { useState } from 'react'
import { Check, Loader2, ChevronDown, ChevronUp, ImagePlus, Film } from 'lucide-react'
import { useTemplates } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { pickLocalBackgroundAsset } from '../../utils/pickBackgroundAsset'

export interface BackgroundSelection {
    background: string
    backgroundType: string
    backgroundStorageId?: string | null
    /** Original filesystem path on desktop (Tauri). Required to re-resolve asset URLs across sessions. */
    localFilePath?: string
    label?: string
}

function isMediaUrl(url: string): boolean {
    if (!url) return false
    return (
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('asset://')
    )
}

interface BackgroundPickerProps {
    value: BackgroundSelection
    onChange: (selection: BackgroundSelection) => void
    /** Optional JSX rendered on top of the preview strip */
    previewChildren?: React.ReactNode
}

const GRADIENT_PRESETS: BackgroundSelection[] = [
    { label: 'Midnight', background: 'linear-gradient(135deg, #0f172a, #1e293b)', backgroundType: 'gradient' },
    { label: 'Ocean', background: 'linear-gradient(135deg, #1e3a5f, #0ea5e9)', backgroundType: 'gradient' },
    { label: 'Royal', background: 'linear-gradient(135deg, #4c1d95, #7c3aed)', backgroundType: 'gradient' },
    { label: 'Teal', background: 'linear-gradient(135deg, #134e4a, #0d9488)', backgroundType: 'gradient' },
    { label: 'Ember', background: 'linear-gradient(135deg, #7c2d12, #ea580c)', backgroundType: 'gradient' },
    { label: 'Ruby', background: 'linear-gradient(135deg, #7f1d1d, #dc2626)', backgroundType: 'gradient' },
    { label: 'Gold', background: 'linear-gradient(135deg, #78350f, #d97706)', backgroundType: 'gradient' },
    { label: 'Black', background: '#000000', backgroundType: 'color' },
    { label: 'Slate', background: '#1e293b', backgroundType: 'color' },
]

/** Extract background info from a template's slideId JSON */
function extractTemplateBackground(template: { thumbnail?: string; slideId: unknown }): BackgroundSelection | null {
    let slideData: Record<string, unknown> | null = null

    if (typeof template.slideId === 'string') {
        try { slideData = JSON.parse(template.slideId) } catch { /* ignore */ }
    } else if (typeof template.slideId === 'object' && template.slideId !== null) {
        slideData = template.slideId as Record<string, unknown>
    }

    const background = (slideData?.background as string) || template.thumbnail
    if (!background) return null

    return {
        background,
        backgroundType: (slideData?.backgroundType as string) || 'image',
        backgroundStorageId: (slideData?.backgroundStorageId as string | null) || null,
    }
}

export function BackgroundPicker({ value, onChange, previewChildren }: BackgroundPickerProps) {
    const [showTemplates, setShowTemplates] = useState(false)
    const [isUploading, setIsUploading] = useState<null | 'image' | 'video'>(null)
    const { templates, isLoading } = useTemplates()

    // Resolve local file paths on desktop so the preview is loadable
    const previewUrl = useLocalBackground(value.background, value.localFilePath)

    const isSelected = (sel: BackgroundSelection) =>
        sel.background === value.background && sel.backgroundType === value.backgroundType

    const handlePickLocal = async (kind: 'image' | 'video') => {
        setIsUploading(kind)
        try {
            const picked = await pickLocalBackgroundAsset(kind)
            if (!picked) return
            onChange({
                background: picked.background,
                backgroundType: picked.backgroundType,
                localFilePath: picked.localFilePath,
                backgroundStorageId: null,
                label: picked.name,
            })
        } finally {
            setIsUploading(null)
        }
    }

    return (
        <div className="space-y-3">
            {/* Section label */}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Background
            </label>

            {/* Gradient presets */}
            <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Presets</p>
                <div className="flex flex-wrap gap-2">
                    {GRADIENT_PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            type="button"
                            title={preset.label}
                            onClick={() => onChange(preset)}
                            className="relative w-10 h-10 rounded-lg border-2 transition-all overflow-hidden flex-shrink-0"
                            style={{
                                background: preset.background,
                                borderColor: isSelected(preset) ? '#3b82f6' : 'transparent',
                                boxShadow: isSelected(preset) ? '0 0 0 2px #3b82f6' : 'none',
                            }}
                        >
                            {isSelected(preset) && (
                                <span className="absolute inset-0 flex items-center justify-center">
                                    <Check className="w-4 h-4 text-white drop-shadow" />
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Templates section - collapsible */}
            <div>
                <button
                    type="button"
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                    {showTemplates ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showTemplates ? 'Hide' : 'Use template background'}
                </button>

                {showTemplates && (
                    <div className="mt-2">
                        {isLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading templates...
                            </div>
                        ) : !templates?.length ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
                                No templates found. Create templates from the Slide Templates panel.
                            </p>
                        ) : (
                            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
                                {templates.map((template) => {
                                    const bg = extractTemplateBackground(template)
                                    if (!bg) return null
                                    const sel = isSelected(bg)
                                    return (
                                        <button
                                            key={template._id}
                                            type="button"
                                            title={template.name}
                                            onClick={() => onChange({ ...bg, label: template.name })}
                                            className="relative rounded-lg overflow-hidden border-2 transition-all aspect-video"
                                            style={{
                                                borderColor: sel ? '#3b82f6' : 'transparent',
                                                boxShadow: sel ? '0 0 0 2px #3b82f6' : 'none',
                                            }}
                                        >
                                            {/* Background preview */}
                                            <div
                                                className="absolute inset-0"
                                                style={{ background: bg.backgroundType === 'video' ? '#1a1a2e' : bg.background }}
                                            />
                                            {/* Thumbnail image */}
                                            {template.thumbnail && bg.backgroundType === 'image' && (
                                                <img
                                                    src={template.thumbnail}
                                                    alt={template.name}
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                />
                                            )}
                                            {template.thumbnail && bg.backgroundType === 'video' && (
                                                <img
                                                    src={template.thumbnail}
                                                    alt={template.name}
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                />
                                            )}
                                            {/* Name overlay */}
                                            <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5">
                                                <p className="text-white text-[9px] truncate">{template.name}</p>
                                            </div>
                                            {sel && (
                                                <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                                    <Check className="w-2.5 h-2.5 text-white" />
                                                </div>
                                            )}
                                            {template.createdBy && (
                                                <div className="absolute top-1 left-1 px-1 py-0.5 bg-primary-500/80 rounded text-white text-[8px]">
                                                    Custom
                                                </div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Upload from device */}
            <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Upload from device</p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => handlePickLocal('image')}
                        disabled={isUploading !== null}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors disabled:opacity-50"
                    >
                        {isUploading === 'image' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <ImagePlus className="w-3.5 h-3.5" />
                        )}
                        Image
                    </button>
                    <button
                        type="button"
                        onClick={() => handlePickLocal('video')}
                        disabled={isUploading !== null}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors disabled:opacity-50"
                    >
                        {isUploading === 'video' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Film className="w-3.5 h-3.5" />
                        )}
                        Video
                    </button>
                </div>
            </div>

            {/* Preview strip */}
            <div
                className="h-16 rounded-lg flex flex-col items-center justify-center overflow-hidden relative"
                style={{
                    background: value.backgroundType === 'gradient' || value.backgroundType === 'color'
                        ? value.background
                        : '#0a0a0a',
                }}
            >
                {value.backgroundType === 'video' && previewUrl && (
                    <video
                        src={previewUrl}
                        className="absolute inset-0 w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                    />
                )}
                {value.backgroundType === 'image' && previewUrl && isMediaUrl(previewUrl) && (
                    <img
                        src={previewUrl}
                        alt="background"
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                )}
                <div className="relative z-10 text-center">
                    {previewChildren ?? (
                        <span className="text-white/80 text-xs drop-shadow">{value.label || 'Preview'}</span>
                    )}
                </div>
            </div>
        </div>
    )
}
