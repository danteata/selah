import { useState, useEffect } from 'react'
import {
    X, Save, Upload, Image, Palette, Type, Loader2, Video,
    LayoutTemplate, PanelBottom, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react'
import { useTemplates, TEMPLATE_SLIDE_TYPE_OPTIONS, TEMPLATE_CATEGORIES, type TemplateItem, type SlideType } from '../../hooks/useTemplates'
import { DEFAULT_BACKGROUNDS } from '../../constants/backgrounds'
import { openFileDialog } from '../../utils/fileDialog'
import { isDesktop } from '../../platform'
import { generateThumbnail } from '../../utils/templateThumbnail'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import type { SlideStyle } from '../../types'

type TemplateLayout = 'full-text' | 'lower-third'

const LOWER_THIRD_STYLES: { value: NonNullable<SlideStyle['lowerThirdStyle']>; label: string; desc: string }[] = [
    { value: 'standard', label: 'Standard', desc: 'Dark semi-transparent bar' },
    { value: 'minimalist', label: 'Minimalist', desc: 'Clean text, no bar' },
    { value: 'accent-bar', label: 'Accent Bar', desc: 'Colored left stripe' },
    { value: 'gradient-bar', label: 'Gradient', desc: 'Gradient background bar' },
]

const LOWER_THIRD_POSITIONS: { value: NonNullable<SlideStyle['lowerThirdPosition']>; icon: typeof AlignLeft }[] = [
    { value: 'left', icon: AlignLeft },
    { value: 'center', icon: AlignCenter },
    { value: 'right', icon: AlignRight },
]

const ACCENT_PRESETS = [
    '#0d9488', '#3b82f6', '#8b5cf6', '#ef4444',
    '#f59e0b', '#10b981', '#ec4899', '#6366f1',
]

async function getConvertFileSrc(): Promise<((filePath: string) => string) | null> {
    try {
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        return convertFileSrc
    } catch {
        return null
    }
}

interface CreateTemplateModalProps {
    isOpen: boolean
    onClose: () => void
    editingTemplate?: TemplateItem | null
}

export function CreateTemplateModal({ isOpen, onClose, editingTemplate }: CreateTemplateModalProps) {
    const { createTemplate, updateTemplate, generateUploadUrl } = useTemplates()
    const { isOffline } = useConvexConnection()
    const [name, setName] = useState('')
    const [category, setCategory] = useState<string>('general')
    const [appliesTo, setAppliesTo] = useState<SlideType[]>(['any'])
    const [description, setDescription] = useState('')
    const [content, setContent] = useState('')
    const [backgroundType, setBackgroundType] = useState<'image' | 'gradient' | 'color' | 'video'>('image')
    const [background, setBackground] = useState(DEFAULT_BACKGROUNDS.general.background)
    const [customImageUrl, setCustomImageUrl] = useState('')
    const [customColor, setCustomColor] = useState('#667eea')
    const [isSaving, setIsSaving] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [backgroundStorageId, setBackgroundStorageId] = useState<string | null>(null)
    const [localFilePath, setLocalFilePath] = useState<string | null>(null)

    // Layout & lower-third options — lets templates define a lower-third look.
    const [layout, setLayout] = useState<TemplateLayout>('full-text')
    const [lowerThirdStyle, setLowerThirdStyle] = useState<NonNullable<SlideStyle['lowerThirdStyle']>>('standard')
    const [lowerThirdPosition, setLowerThirdPosition] = useState<NonNullable<SlideStyle['lowerThirdPosition']>>('left')
    const [lowerThirdAccentColor, setLowerThirdAccentColor] = useState<string>('#0d9488')
    const [lowerThirdSubtitle, setLowerThirdSubtitle] = useState<string>('')

    const isEditing = !!editingTemplate

    const resolvedBackground = useLocalBackground(background, localFilePath ?? undefined)

    // Shared with the browser's badges and SaveAsTemplateModal. The local copy
    // this replaces coloured Sermon amber — the same as Worship — while the badge
    // on the saved card came out orange, so the swatch shown while choosing
    // wasn't the swatch you ended up with.
    const categories = TEMPLATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.dotClass }))

    // Shared with SaveAsTemplateModal — the two lists had drifted apart, and
    // only one of them offered options the backend then discarded.
    const slideTypes = TEMPLATE_SLIDE_TYPE_OPTIONS

    const gradientOptions = [
        { name: 'Purple Dream', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
        { name: 'Ocean Blue', value: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)' },
        { name: 'Sunset', value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
        { name: 'Forest', value: 'linear-gradient(135deg, #1a472a 0%, #2d5a3d 100%)' },
        { name: 'Night Sky', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
        { name: 'Warm Glow', value: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
    ]

    const presetImages = [
        { name: 'Hymn', url: DEFAULT_BACKGROUNDS.hymn.background },
        { name: 'Bible', url: DEFAULT_BACKGROUNDS.bible.background },
        { name: 'Text', url: DEFAULT_BACKGROUNDS.text.background },
        { name: 'Prayer', url: DEFAULT_BACKGROUNDS.prayer.background },
    ]

    // Reset form when modal opens or editing template changes
    useEffect(() => {
        if (isOpen) {
            if (editingTemplate) {
                // Populate form with existing template data
                setName(editingTemplate.name)
                setCategory(editingTemplate.category)
                setAppliesTo(editingTemplate.appliesTo || ['any'])
                setDescription(editingTemplate.description || '')

                // Parse slideId to get content and background
                let slideData: {
                    contents?: string[]
                    background?: string
                    backgroundType?: 'image' | 'gradient' | 'color' | 'video'
                    localFilePath?: string
                    layout?: TemplateLayout
                    slideStyle?: SlideStyle
                } | null = null
                if (typeof editingTemplate.slideId === 'string') {
                    try {
                        slideData = JSON.parse(editingTemplate.slideId)
                    } catch {
                        // If parsing fails, use defaults
                    }
                } else if (typeof editingTemplate.slideId === 'object' && editingTemplate.slideId !== null) {
                    slideData = editingTemplate.slideId as unknown as typeof slideData
                }

                setContent(slideData?.contents?.[0] || '')
                setBackground(slideData?.background || editingTemplate.thumbnail || DEFAULT_BACKGROUNDS.general.background)
                setBackgroundType(slideData?.backgroundType || 'image')
                setCustomImageUrl('')
                setCustomColor('#667eea')
                setLocalFilePath(slideData?.localFilePath || null)

                // Layout & lower-third options
                setLayout(slideData?.layout === 'lower-third' ? 'lower-third' : 'full-text')
                setLowerThirdStyle(slideData?.slideStyle?.lowerThirdStyle || 'standard')
                setLowerThirdPosition(slideData?.slideStyle?.lowerThirdPosition || 'left')
                setLowerThirdAccentColor(slideData?.slideStyle?.lowerThirdAccentColor || '#0d9488')
                setLowerThirdSubtitle(slideData?.slideStyle?.lowerThirdSubtitle || '')
            } else {
                // Reset form for new template
                setName('')
                setCategory('general')
                setAppliesTo(['any'])
                setDescription('')
                setContent('')
                setBackgroundType('image')
                setBackground(DEFAULT_BACKGROUNDS.general.background)
                setCustomImageUrl('')
                setCustomColor('#667eea')
                setLocalFilePath(null)

                setLayout('full-text')
                setLowerThirdStyle('standard')
                setLowerThirdPosition('left')
                setLowerThirdAccentColor('#0d9488')
                setLowerThirdSubtitle('')
            }
        }
    }, [isOpen, editingTemplate])

    // Update background when type changes
    useEffect(() => {
        if (backgroundType === 'image') {
            setBackground(DEFAULT_BACKGROUNDS.general.background)
        } else if (backgroundType === 'gradient') {
            setBackground(gradientOptions[0].value)
        } else if (backgroundType === 'color') {
            setBackground(customColor)
        }
    }, [backgroundType, customColor])

    const handleCustomImageChange = (url: string) => {
        setCustomImageUrl(url)
        if (url) {
            setBackground(url)
        }
    }

    const handleFileUploadClick = async () => {
        try {
            if (isDesktop()) {
                const { open } = await import('@tauri-apps/plugin-dialog')

                const selected = await open({
                    multiple: false,
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'] }],
                })

                if (!selected) return

                const filePath = typeof selected === 'string' ? selected : selected as string

                const convertFileSrc = await getConvertFileSrc()
                if (!convertFileSrc) {
                    console.error('Tauri asset protocol not available')
                    const files = await openFileDialog({ multiple: false, accept: 'image/*' })
                    if (files && files.length > 0) {
                        readFileAsDataUrl(files[0])
                    }
                    return
                }

                const assetUrl = convertFileSrc(filePath)
                setBackground(assetUrl)
                setLocalFilePath(filePath)
                setCustomImageUrl('')
                setBackgroundStorageId(null)
            } else {
                const files = await openFileDialog({
                    multiple: false,
                    accept: 'image/*',
                })

                if (!files || files.length === 0) return
                const file = files[0]

                if (!file.type.startsWith('image/')) {
                    alert('Please upload an image file')
                    return
                }

                if (file.size > 10 * 1024 * 1024) {
                    alert('Image must be less than 10MB')
                    return
                }

                setIsUploading(true)
                readFileAsDataUrl(file)
            }
        } catch (error) {
            console.error('Image upload failed:', error)
            setIsUploading(false)
        }
    }

    const readFileAsDataUrl = (file: File) => {
        const reader = new FileReader()
        reader.onload = (event) => {
            const result = event.target?.result as string
            setBackground(result)
            setCustomImageUrl('')
            setIsUploading(false)
        }
        reader.onerror = () => {
            alert('Failed to read file')
            setIsUploading(false)
        }
        reader.readAsDataURL(file)
    }

    const handleVideoUploadClick = async () => {
        try {
            if (isDesktop()) {
                const { open } = await import('@tauri-apps/plugin-dialog')

                const selected = await open({
                    multiple: false,
                    filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'] }],
                })

                if (!selected) return

                const filePath = typeof selected === 'string' ? selected : selected as string

                const convertFileSrc = await getConvertFileSrc()
                if (!convertFileSrc) {
                    console.error('Tauri asset protocol not available')
                    alert('Local video playback is not available in this environment.')
                    return
                }

                const assetUrl = convertFileSrc(filePath)
                setBackgroundType('video')
                setBackground(assetUrl)
                setLocalFilePath(filePath)
                setBackgroundStorageId(null)
                setCustomImageUrl('')
            } else {
                const files = await openFileDialog({
                    multiple: false,
                    accept: 'video/*',
                })

                if (!files || files.length === 0) return
                const file = files[0]

                if (!file.type.startsWith('video/')) {
                    alert('Please upload a video file')
                    return
                }

                if (file.size > 50 * 1024 * 1024) {
                    alert('Video must be less than 50MB')
                    return
                }

                setIsUploading(true)
                try {
                    if (isOffline) {
                        const blobUrl = URL.createObjectURL(file)
                        setBackgroundType('video')
                        setBackground(blobUrl)
                        setCustomImageUrl('')
                        setIsUploading(false)
                        return
                    }

                    const uploadUrl = await generateUploadUrl()

                    const response = await fetch(uploadUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': file.type },
                        body: file,
                    })

                    if (!response.ok) {
                        throw new Error('Failed to upload video')
                    }

                    const { storageId } = await response.json()

                    setBackgroundStorageId(storageId)
                    setBackgroundType('video')

                    const localUrl = URL.createObjectURL(file)
                    setBackground(localUrl)
                    setCustomImageUrl('')
                } catch (error) {
                    console.error('Video upload error:', error)
                    if (isOffline) {
                        const blobUrl = URL.createObjectURL(file)
                        setBackgroundType('video')
                        setBackground(blobUrl)
                    } else {
                        alert('Failed to upload video. Please try again.')
                    }
                } finally {
                    setIsUploading(false)
                }
            }
        } catch (error) {
            console.error('Video dialog failed:', error)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return

        setIsSaving(true)
        try {
            let thumbnail: string | undefined
            if (backgroundType === 'image' && background) {
                if (localFilePath) {
                    thumbnail = await generateThumbnail(background, 'image', content || name)
                } else if (background.startsWith('data:')) {
                    thumbnail = background
                } else {
                    thumbnail = background
                }
            } else if (backgroundType === 'gradient' || backgroundType === 'color') {
                thumbnail = await generateThumbnail(background, backgroundType, content || name)
            } else if (backgroundType === 'video' && background) {
                thumbnail = await generateThumbnail(background, 'video', content || name, resolvedBackground || undefined)
            }

            const slideStyle: SlideStyle | undefined = layout === 'lower-third'
                ? {
                    lowerThirdStyle,
                    lowerThirdPosition,
                    lowerThirdAccentColor,
                    lowerThirdSubtitle,
                }
                : undefined

            const slideData = {
                type: 'text',
                layout,
                contents: content ? [content] : ['Your content here'],
                background: resolvedBackground || background,
                backgroundType,
                backgroundStorageId,
                localFilePath: localFilePath || undefined,
                ...(slideStyle ? { slideStyle } : {}),
            }

            if (isEditing && editingTemplate) {
                await updateTemplate(editingTemplate._id, {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    slideId: JSON.stringify(slideData),
                    category: category as 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general',
                    appliesTo,
                    thumbnail,
                    backgroundStorageId: backgroundStorageId || undefined,
                })
            } else {
                await createTemplate({
                    name: name.trim(),
                    description: description.trim() || undefined,
                    slideId: JSON.stringify(slideData),
                    category: category as 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general',
                    appliesTo,
                    thumbnail,
                    backgroundStorageId: backgroundStorageId || undefined,
                })
            }
            onClose()
        } catch (error) {
            console.error('Failed to save template:', error)
            alert('Failed to save template. Please try again.')
        } finally {
            setIsSaving(false)
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-primary-500/10 to-amber-500/10">
                    <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                        <Save className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                            {isEditing ? 'Edit Template' : 'Create Custom Template'}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {isEditing ? 'Update your template' : 'Design a template from scratch'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-4 space-y-4">
                        {/* Preview */}
                        <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center text-gray-400 relative">
                            {backgroundType === 'video' && resolvedBackground ? (
                                <video
                                    src={resolvedBackground}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                />
                            ) : (
                                <div
                                    className="absolute inset-0 w-full h-full"
                                    style={{
                                        background: resolvedBackground,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                />
                            )}
                            {layout === 'lower-third' ? (
                                <div
                                    className="absolute inset-x-0 bottom-0 px-4 py-3 flex flex-col z-10"
                                    style={{
                                        alignItems: lowerThirdPosition === 'center' ? 'center'
                                            : lowerThirdPosition === 'right' ? 'flex-end'
                                                : 'flex-start',
                                        background: lowerThirdStyle === 'minimalist' ? 'transparent'
                                            : lowerThirdStyle === 'gradient-bar'
                                                ? `linear-gradient(135deg, ${lowerThirdAccentColor}ee, ${lowerThirdAccentColor}88)`
                                                : 'rgba(0,0,0,0.75)',
                                        backdropFilter: lowerThirdStyle === 'minimalist' ? undefined : 'blur(8px)',
                                        borderLeft: lowerThirdStyle === 'accent-bar'
                                            ? `4px solid ${lowerThirdAccentColor}`
                                            : undefined,
                                    }}
                                >
                                    <span className="text-white font-semibold drop-shadow-lg text-base">
                                        {content || 'Speaker Name'}
                                    </span>
                                    {lowerThirdSubtitle && (
                                        <span className="text-white/80 drop-shadow-lg text-xs mt-0.5">
                                            {lowerThirdSubtitle}
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="relative text-white text-lg font-medium drop-shadow-lg z-10">
                                    {content || 'Your content here'}
                                </span>
                            )}
                        </div>

                        {/* Name */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Template Name *
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Template"
                                required
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>

                        {/* Content */}
                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                <Type className="w-4 h-4" />
                                {layout === 'lower-third' ? 'Default Title' : 'Default Content'}
                            </label>
                            <input
                                type="text"
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder={layout === 'lower-third'
                                    ? 'e.g. Pastor John Smith'
                                    : 'Enter default text for this template...'}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>

                        {/* Layout selector — full-text vs lower-third */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Layout
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setLayout('full-text')}
                                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border-2 text-left transition-all ${
                                        layout === 'full-text'
                                            ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                                >
                                    <LayoutTemplate className={`w-5 h-5 ${layout === 'full-text' ? 'text-[var(--accent-teal)]' : 'text-gray-400'}`} />
                                    <div className="flex-1">
                                        <div className={`text-sm font-medium ${layout === 'full-text' ? 'text-[var(--accent-teal)]' : 'text-gray-900 dark:text-white'}`}>
                                            Full Text
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            Centered, fills the screen
                                        </div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLayout('lower-third')}
                                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border-2 text-left transition-all ${
                                        layout === 'lower-third'
                                            ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                                >
                                    <PanelBottom className={`w-5 h-5 ${layout === 'lower-third' ? 'text-[var(--accent-teal)]' : 'text-gray-400'}`} />
                                    <div className="flex-1">
                                        <div className={`text-sm font-medium ${layout === 'lower-third' ? 'text-[var(--accent-teal)]' : 'text-gray-900 dark:text-white'}`}>
                                            Lower Third
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            Name banner across the bottom
                                        </div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* Lower-third specific controls */}
                        {layout === 'lower-third' && (
                            <div className="space-y-4 p-4 rounded-lg border border-[var(--accent-teal)]/30 bg-[var(--accent-teal)]/[0.03]">
                                {/* Subtitle */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                        Default Subtitle
                                    </label>
                                    <input
                                        type="text"
                                        value={lowerThirdSubtitle}
                                        onChange={(e) => setLowerThirdSubtitle(e.target.value)}
                                        placeholder="e.g. Senior Pastor · Grace Community Church"
                                        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-teal)]/40 focus:border-[var(--accent-teal)]"
                                    />
                                </div>

                                {/* Style */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                        Style
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {LOWER_THIRD_STYLES.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setLowerThirdStyle(opt.value)}
                                                className={`px-3 py-2 rounded-lg border-2 text-left transition-all ${
                                                    lowerThirdStyle === opt.value
                                                        ? 'border-[var(--accent-teal)] bg-white dark:bg-gray-800'
                                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                            >
                                                <span className={`block text-sm font-medium ${
                                                    lowerThirdStyle === opt.value
                                                        ? 'text-[var(--accent-teal)]'
                                                        : 'text-gray-900 dark:text-white'
                                                }`}>
                                                    {opt.label}
                                                </span>
                                                <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {opt.desc}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Position */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                        Position
                                    </label>
                                    <div className="flex gap-2">
                                        {LOWER_THIRD_POSITIONS.map((opt) => {
                                            const Icon = opt.icon
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setLowerThirdPosition(opt.value)}
                                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                                                        lowerThirdPosition === opt.value
                                                            ? 'border-[var(--accent-teal)] bg-white dark:bg-gray-800 text-[var(--accent-teal)]'
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
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <div className="flex gap-1.5 flex-wrap">
                                            {ACCENT_PRESETS.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() => setLowerThirdAccentColor(color)}
                                                    className={`w-7 h-7 rounded-md transition-all ${
                                                        lowerThirdAccentColor === color
                                                            ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110'
                                                            : 'hover:scale-105'
                                                    }`}
                                                    style={{
                                                        backgroundColor: color,
                                                        outline: lowerThirdAccentColor === color ? `2px solid ${color}` : undefined,
                                                        outlineOffset: lowerThirdAccentColor === color ? '2px' : undefined,
                                                    }}
                                                    title={color}
                                                />
                                            ))}
                                        </div>
                                        <input
                                            type="color"
                                            value={lowerThirdAccentColor}
                                            onChange={(e) => setLowerThirdAccentColor(e.target.value)}
                                            className="w-7 h-7 rounded-md border-0 cursor-pointer"
                                        />
                                        <span className="text-[11px] text-gray-500 font-mono">{lowerThirdAccentColor}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Background Type Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Background Type
                            </label>
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => setBackgroundType('image')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${backgroundType === 'image'
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <Image className="w-4 h-4" />
                                    Image
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBackgroundType('video')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${backgroundType === 'video'
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <Video className="w-4 h-4" />
                                    Video
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBackgroundType('gradient')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${backgroundType === 'gradient'
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <Palette className="w-4 h-4" />
                                    Gradient
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBackgroundType('color')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${backgroundType === 'color'
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <div className="w-4 h-4 rounded-full" style={{ background: customColor }} />
                                    Color
                                </button>
                            </div>
                        </div>

                        {/* Background Options based on type */}
                        {backgroundType === 'image' && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <Image className="w-4 h-4" />
                                    Background Image
                                </label>

                                {/* Preset Images */}
                                <div className="grid grid-cols-4 gap-2">
                                    {presetImages.map((img) => (
                                        <button
                                            key={img.name}
                                            type="button"
                                            onClick={() => setBackground(img.url)}
                                            className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${background === img.url
                                                ? 'border-primary-500 ring-2 ring-primary-500/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <div
                                                className="w-full h-full bg-cover bg-center"
                                                style={{ backgroundImage: `url(${img.url})` }}
                                            />
                                        </button>
                                    ))}
                                </div>

                                {/* Custom Image URL */}
                                <div className="relative">
                                    <Upload className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="url"
                                        value={customImageUrl}
                                        onChange={(e) => handleCustomImageChange(e.target.value)}
                                        placeholder="Or paste an image URL..."
                                        className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                                    />
                                </div>

                                {/* File Upload */}
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
                                    <button
                                        type="button"
                                        onClick={handleFileUploadClick}
                                        disabled={isUploading}
                                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 border border-primary-300 dark:border-primary-700 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Upload className="w-4 h-4" />
                                        )}
                                        {isUploading ? 'Uploading...' : 'Upload Image'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {backgroundType === 'video' && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <Video className="w-4 h-4" />
                                    Background Video
                                </label>

                                {/* Video Upload */}
                                <div className="flex flex-col gap-3">
                                    <button
                                        type="button"
                                        onClick={handleVideoUploadClick}
                                        disabled={isUploading}
                                        className="flex items-center justify-center gap-2 px-4 py-8 text-sm font-medium text-primary-600 dark:text-primary-400 border-2 border-dashed border-primary-300 dark:border-primary-700 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <Video className="w-5 h-5" />
                                        )}
                                        {isUploading ? 'Uploading...' : 'Upload Video (MP4, WebM, etc.)'}
                                    </button>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                        Max file size: 50MB. Supported formats: MP4, WebM, MOV
                                    </p>
                                </div>

                                {/* Video Preview */}
                                {resolvedBackground && backgroundType === 'video' && (
                                    <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                                        <video
                                            src={resolvedBackground}
                                            className="w-full aspect-video object-cover"
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setBackground('')}
                                            className="absolute top-2 right-2 p-1 bg-red-500/80 hover:bg-red-600 rounded text-white"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {backgroundType === 'gradient' && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <Palette className="w-4 h-4" />
                                    Gradient Preset
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {gradientOptions.map((gradient) => (
                                        <button
                                            key={gradient.name}
                                            type="button"
                                            onClick={() => setBackground(gradient.value)}
                                            className={`aspect-video rounded-lg overflow-hidden border-2 transition-all ${background === gradient.value
                                                ? 'border-primary-500 ring-2 ring-primary-500/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <div
                                                className="w-full h-full"
                                                style={{ background: gradient.value }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {backgroundType === 'color' && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <div className="w-4 h-4 rounded-full" style={{ background: customColor }} />
                                    Solid Color
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={customColor}
                                        onChange={(e) => setCustomColor(e.target.value)}
                                        className="w-12 h-12 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={customColor}
                                        onChange={(e) => setCustomColor(e.target.value)}
                                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Category */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Category
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {categories.map((cat) => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setCategory(cat.id)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${category === cat.id
                                            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                                        {cat.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Applies To — which slide types this template is for */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Applies To
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                Which slide types can use this template?
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {slideTypes.map((st) => (
                                    <button
                                        key={st.id}
                                        type="button"
                                        onClick={() => {
                                            if (st.id === 'any') {
                                                setAppliesTo(['any'])
                                            } else {
                                                setAppliesTo(prev => {
                                                    // Annotated: TS infers a type
                                                    // predicate from the filter and
                                                    // would narrow 'any' out of the
                                                    // element type.
                                                    const withoutAny: SlideType[] = prev.filter(id => id !== 'any')
                                                    if (withoutAny.includes(st.id)) {
                                                        const next = withoutAny.filter(id => id !== st.id)
                                                        return next.length === 0 ? ['any'] : next
                                                    }
                                                    return [...withoutAny, st.id]
                                                })
                                            }
                                        }}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                            appliesTo.includes(st.id)
                                                ? 'bg-[var(--accent-teal)] text-white'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                            }`}
                                    >
                                        {st.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Description (optional)
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description of this template..."
                                rows={2}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving || !name.trim()}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {isEditing ? 'Update Template' : 'Create Template'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}