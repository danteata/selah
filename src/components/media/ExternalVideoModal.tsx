import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { detectExternalVideoPlatform } from '../../utils/externalVideo'
import { Modal } from '../modals/Modal'

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
        <Modal
            isOpen={isOpen}
            onClose={() => onClose?.()}
            labelledBy="external-video-modal-title"
            className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
        >
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <h3 id="external-video-modal-title" className="font-semibold text-[var(--text-primary)]">
                    Add {PLATFORM_LABEL[platform]} Video
                </h3>
                <button
                    aria-label="Close"
                    onClick={onClose}
                    className="ml-auto p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                        {PLATFORM_LABEL[platform]} link
                    </label>
                    <input
                        type="url"
                        autoFocus
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder={platform === 'youtube' ? 'https://www.youtube.com/watch?v=...' : 'https://vimeo.com/...'}
                        className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                    />
                    {url.trim().length > 0 && !valid && (
                        <p className="text-xs text-red-500 mt-1">
                            That doesn't look like a valid {PLATFORM_LABEL[platform]} link.
                        </p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                        Title <span className="text-[var(--text-muted)]">(optional)</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Sunday announcement..."
                        className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                    />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
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
        </Modal>
    )
}
