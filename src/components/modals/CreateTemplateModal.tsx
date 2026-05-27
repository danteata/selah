import { useState, useEffect } from 'react'
import { X, Save, Upload, Image, Palette, Type, Loader2, Video } from 'lucide-react'
import { useTemplates, type TemplateItem } from '../../hooks/useTemplates'
import { DEFAULT_BACKGROUNDS } from '../../constants/backgrounds'
import { openFileDialog } from '../../utils/fileDialog'
import { isDesktop } from '../../platform'
import { generateThumbnail } from '../../utils/templateThumbnail'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { useLocalBackground } from '../../hooks/useLocalBackground'

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
    const [appliesTo, setAppliesTo] = useState<string[]>(['any'])
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

    const isEditing = !!editingTemplate

    const resolvedBackground = useLocalBackground(background, localFilePath ?? undefined)

    const categories = [
        { id: 'announcement', label: 'Announcement', color: 'bg-blue-500' },
        { id: 'worship', label: 'Worship', color: 'bg-amber-500' },
        { id: 'sermon', label: 'Sermon', color: 'bg-amber-500' },
        { id: 'prayer', label: 'Prayer', color: 'bg-green-500' },
        { id: 'general', label: 'General', color: 'bg-gray-500' },
    ]

    const slideTypes = [
        { id: 'bible', label: 'Bible Verses' },
        { id: 'song', label: 'Songs' },
        { id: 'hymn', label: 'Hymns' },
        { id: 'text', label: 'Text Slides' },
        { id: 'media', label: 'Media' },
        { id: 'announcement', label: 'Announcements' },
        { id: 'countdown', label: 'Countdowns' },
        { id: 'any', label: 'Any Type' },
    ]

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
                setAppliesTo((editingTemplate.appliesTo || ['any']) as string[])
                setDescription(editingTemplate.description || '')

                // Parse slideId to get content and background
                let slideData: { contents?: string[]; background?: string; backgroundType?: 'image' | 'gradient' | 'color'; localFilePath?: string } | null = null
                if (typeof editingTemplate.slideId === 'string') {
                    try {
                        slideData = JSON.parse(editingTemplate.slideId)
                    } catch {
                        // If parsing fails, use defaults
                    }
                } else if (typeof editingTemplate.slideId === 'object' && editingTemplate.slideId !== null) {
                    slideData = editingTemplate.slideId as { contents?: string[]; background?: string; backgroundType?: 'image' | 'gradient' | 'color' }
                }

                setContent(slideData?.contents?.[0] || '')
                setBackground(slideData?.background || editingTemplate.thumbnail || DEFAULT_BACKGROUNDS.general.background)
                setBackgroundType(slideData?.backgroundType || 'image')
                setCustomImageUrl('')
                setCustomColor('#667eea')
                setLocalFilePath(slideData?.localFilePath || null)
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

            const slideData = {
                type: 'text',
                layout: 'full-text',
                contents: content ? [content] : ['Your content here'],
                background: resolvedBackground || background,
                backgroundType,
                backgroundStorageId,
                localFilePath: localFilePath || undefined,
            }

            if (isEditing && editingTemplate) {
                await updateTemplate(editingTemplate._id, {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    slideId: JSON.stringify(slideData),
                    category: category as 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general',
                    appliesTo: appliesTo as any,
                    thumbnail,
                    backgroundStorageId: backgroundStorageId || undefined,
                })
            } else {
                await createTemplate({
                    name: name.trim(),
                    description: description.trim() || undefined,
                    slideId: JSON.stringify(slideData),
                    category: category as 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general',
                    appliesTo: appliesTo as any,
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
                                    className="w-full h-full flex items-center justify-center p-4 text-center"
                                    style={{
                                        background: resolvedBackground,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                />
                            )}
                            <span className="relative text-white text-lg font-medium drop-shadow-lg z-10">
                                {content || 'Your content here'}
                            </span>
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
                                Default Content
                            </label>
                            <input
                                type="text"
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder="Enter default text for this template..."
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>

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
                                                    const withoutAny = prev.filter(id => id !== 'any')
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