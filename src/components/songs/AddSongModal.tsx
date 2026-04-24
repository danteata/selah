import { useState, useEffect } from 'react'
import { X, Music, Plus, Lightbulb, Globe, Eye, EyeOff } from 'lucide-react'
import { useSongs } from '../../hooks/useSongs'
import type { Song } from '../../types'

interface AddSongModalProps {
    isOpen: boolean
    onClose: () => void
    song?: Song | null
    onSuccess?: (song: Song) => void
}

export function AddSongModal({ isOpen, onClose, song, onSuccess }: AddSongModalProps) {
    const [title, setTitle] = useState('')
    const [artist, setArtist] = useState('')
    const [lyrics, setLyrics] = useState('')
    const [isPublic, setIsPublic] = useState(true)
    const [error, setError] = useState('')
    const [showPreview, setShowPreview] = useState(false)

    const { createSong, updateSong, loading, parseSongLyrics } = useSongs()

    // Parse verses for preview
    const parsedVerses = lyrics.trim() ? lyrics.split(/\n\s*\n/).filter(v => v.trim()) : []

    // Populate form when editing an existing song or when modal opens
    useEffect(() => {
        if (isOpen) {
            if (song) {
                setTitle(song.title || '')
                setArtist(song.artist || '')
                setLyrics(song.lyrics || '')
                setIsPublic(song.isPublic ?? true)
            } else {
                setTitle('')
                setArtist('')
                setLyrics('')
                setIsPublic(true)
                setError('')
            }
        }
    }, [song, isOpen])

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

    if (!isOpen) return null

    const isEditing = !!song
    const canSubmit = title.trim() && lyrics.trim() && !loading

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
            <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
                    <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                        <Music className="w-5 h-5 text-primary-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        {isEditing ? 'Edit Song' : 'Add New Song'}
                    </h3>
                    <button
                        onClick={handleClose}
                        disabled={loading}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
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
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Hallelujah Eh"
                                required
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>

                        {/* Artist */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Artist
                            </label>
                            <input
                                type="text"
                                value={artist}
                                onChange={(e) => setArtist(e.target.value)}
                                placeholder="e.g., Nathaniel Bassey"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                        </div>

                        {/* Hint */}
                        <div className="rounded-lg bg-primary-50 dark:bg-primary-900/20 p-4 border border-primary-100 dark:border-primary-800">
                            <div className="text-sm text-primary-700 dark:text-primary-300 font-semibold flex items-center gap-2">
                                <Lightbulb className="w-4 h-4" />
                                Hint
                            </div>
                            <p className="mt-1 text-sm text-primary-600 dark:text-primary-400">
                                Add an <span className="font-bold">empty line</span> if you wish to forcefully
                                break your lyrics into verses. This feature is especially useful for
                                adding a worship lineup.
                            </p>
                        </div>

                        {/* Lyrics */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Lyrics <span className="text-red-500">*</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setShowPreview(!showPreview)}
                                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
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
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none font-mono text-sm leading-relaxed"
                            />

                            {/* Verse Preview */}
                            {showPreview && parsedVerses.length > 0 && (
                                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                                        Preview: {parsedVerses.length} verse{parsedVerses.length !== 1 ? 's' : ''} detected
                                    </div>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {parsedVerses.map((verse, index) => (
                                            <div key={index} className="p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                                                <div className="text-xs font-medium text-primary-600 dark:text-primary-400 mb-1">
                                                    Verse {index + 1}
                                                </div>
                                                <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line">
                                                    {verse}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Verse count indicator */}
                            {lyrics.trim() && !showPreview && (
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {parsedVerses.length} verse{parsedVerses.length !== 1 ? 's' : ''} will be created
                                </div>
                            )}
                        </div>

                        {/* Public Toggle - Only for new songs */}
                        {!isEditing && (
                            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                <Globe className="w-5 h-5 text-gray-500" />
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Share this song with other users?
                                    </label>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Public songs can be discovered by other churches
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPublic(!isPublic)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPublic
                                        ? 'bg-primary-600'
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
                    <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-800 shrink-0">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
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