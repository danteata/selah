import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { detectExternalVideoPlatform } from '../../utils/externalVideo'

interface ExternalVideoModalProps {
    isOpen?: boolean
    onClose?: () => void
    onAdd: (video: { url: string; name?: string }) => void
    platform: 'youtube' | 'vimeo'
}

const PLATFORM_LABEL: Record<ExternalVideoModalProps['platform'], string> = {
    youtube: 'YouTube',
    vimeo: 'Vimeo',
}

export function ExternalVideoModal({ isOpen = true, onClose, onAdd, platform }: ExternalVideoModalProps) {
    const [url, setUrl] = useState('')
    const [name, setName] = useState('')

    if (!isOpen) return null

    const valid = detectExternalVideoPlatform(url.trim()) === platform

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!valid) return
        onAdd({ url: url.trim(), name: name.trim() || undefined })
        onClose?.()
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        Add {PLATFORM_LABEL[platform]} Video
                    </h3>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {PLATFORM_LABEL[platform]} link
                        </label>
                        <input
                            type="url"
                            autoFocus
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder={platform === 'youtube' ? 'https://www.youtube.com/watch?v=...' : 'https://vimeo.com/...'}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                        />
                        {url.trim().length > 0 && !valid && (
                            <p className="text-xs text-red-500 mt-1">
                                That doesn't look like a valid {PLATFORM_LABEL[platform]} link.
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Title <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Sunday announcement..."
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!valid}
                            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent-teal)] hover:brightness-110 disabled:opacity-50 rounded-lg transition-all shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            ADD VIDEO
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
