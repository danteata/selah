import { useState } from 'react'
import { X, Music, Plus, Lightbulb, Globe, Eye, EyeOff } from 'lucide-react'
import { useSongs } from '../../hooks/useSongs'
import type { Song } from '../../types'
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss'
import { useDialog } from '../../hooks/useDialog'

interface AddSongModalProps {
    isOpen: boolean
    onClose: () => void
    song?: Song | null
    onSuccess?: (song: Song) => void
}

export function AddSongModal({ isOpen, onClose, song, onSuccess }: AddSongModalProps) {
    // Seeded from the song once per mount; callers key this modal per song, so
    // each open starts fresh. Copying them in an effect instead painted the
    // previous song's fields (and any old error) for a frame on every open.
    const [title, setTitle] = useState(() => song?.title || '')
    const [artist, setArtist] = useState(() => song?.artist || '')
    const [lyrics, setLyrics] = useState(() => song?.lyrics || '')
    const [isPublic, setIsPublic] = useState(() => song?.isPublic ?? true)
    const [error, setError] = useState('')
    const [showPreview, setShowPreview] = useState(false)

    const { createSong, updateSong, loading } = useSongs()

    // Parse verses for preview
    const parsedVerses = lyrics.trim() ? lyrics.split(/\n\s*\n/).filter(v => v.trim()) : []

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (!title.trim() || !lyrics.trim()) {
            setError('Title and lyrics are required')
            return
        }

        const songData: Partial<Song> = {
            title: title.trim(),
            artist: artist.trim() || 'Unknown',
            lyrics: lyrics.trim(),
        }

        let result: Song | null = null

        if (song?._id || song?.id) {
            // Update existing song
            result = await updateSong(song._id || song.id, songData)
        } else {
            // Create new song
            result = await createSong(songData, isPublic)
        }

        if (result) {
            // Reset form
            setTitle('')
            setArtist('')
            setLyrics('')
            setIsPublic(true)
            onSuccess?.(result)
            onClose()
        } else {
            setError('Failed to save song. Please try again.')
        }
    }

    const handleClose = () => {
        if (!loading) {
            setError('')
            onClose()
        }
    }
    const backdropDismiss = useBackdropDismiss(handleClose)
    const panelRef = useDialog({ isOpen, onClose: handleClose })

    if (!isOpen) return null

    const isEditing = !!song
    const canSubmit = title.trim() && lyrics.trim() && !loading

    return (
        // Its own overlay rather than <Modal>: the key fence below has to wrap the
        // whole dialog, panel included, and Modal takes no key handler.
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            {...backdropDismiss}
            // Keys typed in this editor belong to this editor. Every surface that
            // opens it — the songs panel, the music browser's search results, the
            // browse list nested inside that browser — binds its own key handler
            // to a container that is an ancestor of this modal in the React tree,
            // and React propagates events up the React tree even through a
            // portal. So without this, Enter in the lyrics box reached the search
            // results' handler, which sent the song being edited straight to the
            // live output and called preventDefault() on the newline. Escape is
            // let through: stopping it here would stop it at React's root too,
            // before it reaches useDialog's document listener that closes this.
            onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-song-modal-title"
                tabIndex={-1}
                className="w-full max-w-2xl max-h-[90vh] outline-none bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)] shrink-0">
                    <div className="p-2 bg-[var(--accent-teal)]/10 rounded-lg">
                        <Music className="w-5 h-5 text-[var(--accent-teal)]" />
                    </div>
                    <h3 id="add-song-modal-title" className="font-semibold text-[var(--text-primary)]">
                        {isEditing ? 'Edit Song' : 'Add New Song'}
                    </h3>
                    <button
                        aria-label="Close"
                        onClick={handleClose}
                        disabled={loading}
                        className="ml-auto p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    <div className="p-4 space-y-4 overflow-y-auto flex-1">
                        {/* Error Message */}
                        {error && (
                            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Title */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                                Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Hallelujah Eh"
                                required
                                className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                            />
                        </div>

                        {/* Artist */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                                Artist
                            </label>
                            <input
                                type="text"
                                value={artist}
                                onChange={(e) => setArtist(e.target.value)}
                                placeholder="e.g., Nathaniel Bassey"
                                className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                            />
                        </div>

                        {/* Hint */}
                        <div className="rounded-lg bg-[var(--accent-teal)]/10 p-4 border border-[var(--accent-teal)]/20">
                            <div className="text-sm text-[var(--accent-teal)] font-semibold flex items-center gap-2">
                                <Lightbulb className="w-4 h-4" />
                                Hint
                            </div>
                            <p className="mt-1 text-sm text-[var(--text-secondary)]">
                                Add an <span className="font-bold">empty line</span> if you wish to forcefully
                                break your lyrics into verses. This feature is especially useful for
                                adding a worship lineup.
                            </p>
                        </div>

                        {/* Lyrics */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-[var(--text-secondary)]">
                                    Lyrics <span className="text-red-500">*</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setShowPreview(!showPreview)}
                                    className="flex items-center gap-1 text-xs text-[var(--accent-teal)] hover:brightness-110"
                                >
                                    {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    {showPreview ? 'Hide Preview' : 'Preview Verses'}
                                </button>
                            </div>
                            <textarea
                                value={lyrics}
                                onChange={(e) => setLyrics(e.target.value)}
                                placeholder="Paste your lyrics here..."
                                rows={10}
                                required
                                className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent resize-none font-mono text-sm leading-relaxed"
                            />

                            {/* Verse Preview */}
                            {showPreview && parsedVerses.length > 0 && (
                                <div className="mt-3 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)]">
                                    <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                                        Preview: {parsedVerses.length} verse{parsedVerses.length !== 1 ? 's' : ''} detected
                                    </div>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {parsedVerses.map((verse, index) => (
                                            <div key={index} className="p-2 bg-[var(--bg-elevated)] rounded border border-[var(--border-subtle)]">
                                                <div className="text-xs font-medium text-[var(--accent-teal)] mb-1">
                                                    Verse {index + 1}
                                                </div>
                                                <p className="text-xs text-[var(--text-secondary)] whitespace-pre-line">
                                                    {verse}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Verse count indicator */}
                            {lyrics.trim() && !showPreview && (
                                <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    {parsedVerses.length} verse{parsedVerses.length !== 1 ? 's' : ''} will be created
                                </div>
                            )}
                        </div>

                        {/* Public Toggle - Only for new songs */}
                        {!isEditing && (
                            <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded-lg">
                                <Globe className="w-5 h-5 text-[var(--text-muted)]" />
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-[var(--text-secondary)]">
                                        Share this song with other users?
                                    </label>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Public songs can be discovered by other churches
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPublic(!isPublic)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPublic
                                        ? 'bg-[var(--accent-teal)]'
                                        : 'bg-gray-300 dark:bg-gray-600'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 p-4 border-t border-[var(--border-subtle)] shrink-0">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    {isEditing ? (
                                        <>
                                            <Music className="w-4 h-4" />
                                            Update Song
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="w-4 h-4" />
                                            Add Song
                                        </>
                                    )}
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}