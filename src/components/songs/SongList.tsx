import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, ChevronLeft, Music, Trash2, Edit, CloudOff } from 'lucide-react'
import { useSong, useSongs, useSlideCreation } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { AddSongModal } from './AddSongModal'
import { TemplateSelector } from '../templates/TemplateSelector'
import { useTemplates, type TemplateItem } from '../../hooks/useTemplates'
import type { Song } from '../../types'

interface SongListProps {
    onClose: () => void
    isInline?: boolean
}

export function SongList({ onClose, isInline = false }: SongListProps) {
    const [query, setQuery] = useState('')
    const [selectedSong, setSelectedSong] = useState<Song | null>(null)
    const [songToEdit, setSongToEdit] = useState<Song | null>(null)
    const [isAddModalOpen, setIsAddModalOpen] = useState(false)
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)

    const { songs, loading: songsLoading, searchSongs, deleteSong, parseSongLyrics } = useSongs()
    const { getSong } = useSong()
    const { createSongSlides } = useSlideCreation()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)

    // Filter songs
    const filteredSongs = songs.filter((song: Song) =>
        song.title.toLowerCase().includes(query.toLowerCase()) ||
        song.artist.toLowerCase().includes(query.toLowerCase())
    )

    const handleCreateSlides = useCallback(async () => {
        if (selectedSong) {
            console.log('Selected song:', selectedSong)
            console.log('Selected song lyrics:', selectedSong.lyrics)

            const songWithVerses = await getSong(selectedSong)
            console.log('Song with verses after getSong:', songWithVerses)
            console.log('Verses parsed:', songWithVerses?.verses)

            if (songWithVerses) {
                const slides = createSongSlides(songWithVerses as any, { template: selectedTemplate })
                console.log('Created slides count:', slides.length)
                slides.forEach(slide => {
                    appendActiveSlide(slide)
                })
            }
            onClose()
        }
    }, [selectedSong, getSong, createSongSlides, appendActiveSlide, onClose])

    const handleDeleteSong = useCallback(async (songId: string) => {
        const success = await deleteSong(songId)
        if (success) {
            if (selectedSong?._id === songId || selectedSong?.id === songId) {
                setSelectedSong(null)
            }
        }
        setDeleteConfirmId(null)
    }, [deleteSong, selectedSong])

    const handleEditSong = useCallback((song: Song) => {
        setSongToEdit(song)
        setIsAddModalOpen(true)
    }, [])

    const handleAddSongSuccess = useCallback(() => {
        setSongToEdit(null)
        setIsAddModalOpen(false)
    }, [])

    const handleCloseModal = useCallback(() => {
        setIsAddModalOpen(false)
        setSongToEdit(null)
    }, [])

    const isLoading = songsLoading && songs.length === 0

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full" />
            </div>
        )
    }

    return (
        <>
            <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg">
                {/* Header - Hidden when inline */}
                {!isInline && (
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <h2 className="text-lg font-semibold">Songs Library</h2>
                            {songsLoading && (
                                <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                            )}
                        </div>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            Add Song
                        </button>
                    </div>
                )}

                {/* Search */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search songs..."
                        className="w-full pl-10 pr-4 py-2 border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                        />
                    </div>
                </div>

                {/* Songs List */}
                {!selectedSong ? (
                    <div className="flex-1 overflow-y-auto">
                        {filteredSongs.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">
                                <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                <p className="font-medium">
                                    {query ? 'No songs found' : 'No songs yet'}
                                </p>
                                <p className="text-sm mt-1">
                                    {query
                                        ? 'Try a different search term'
                                        : 'Add your first song to get started'}
                                </p>
                                {!query && (
                                    <button
                                        onClick={() => setIsAddModalOpen(true)}
                                        className="mt-4 flex items-center gap-2 px-4 py-2 mx-auto bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Song
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-200 dark:divide-gray-800">
                                {filteredSongs.map((song) => (
                                    <div
                                        key={song._id || song.id}
                                        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 group"
                                    >
                                        <button
                                            onClick={() => setSelectedSong(song)}
                                            className="flex-1 text-left"
                                        >
                                            <h3 className="font-medium text-gray-900 dark:text-white">
                                                {song.title}
                                            </h3>
                                            <p className="text-sm text-gray-500">{song.artist}</p>
                                        </button>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleEditSong(song)}
                                                className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                                                title="Edit song"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmId(song._id || song.id)}
                                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                                title="Delete song"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    /* Song Detail */
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-semibold text-lg">{selectedSong.title}</h3>
                                    <p className="text-sm text-gray-500">{selectedSong.artist}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEditSong(selectedSong)}
                                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                                        title="Edit song"
                                    >
                                        <Edit className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setSelectedSong(null)}
                                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Lyrics Preview */}
                            <div className="max-h-64 overflow-y-auto">
                                <pre className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
                                    {selectedSong.lyrics?.slice(0, 500)}
                                    {selectedSong.lyrics && selectedSong.lyrics.length > 500 && '...'}
                                </pre>
                            </div>
                        </div>

                            {/* Template Selector */}
                            <TemplateSelector
                                slideType="song"
                                selectedTemplate={selectedTemplate}
                                onSelect={setSelectedTemplate}
                            />

                            <div className="flex justify-end gap-2 mt-4">
                            <button
                                onClick={() => setSelectedSong(null)}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleCreateSlides}
                                className="px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm font-medium"
                            >
                                Create Slides
                            </button>
                        </div>
                    </div>
                )}

                {/* Delete Confirmation */}
                {deleteConfirmId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                Delete Song?
                            </h3>
                            <p className="text-gray-600 dark:text-gray-400 mb-4">
                                Are you sure you want to delete this song? This action cannot be undone.
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleDeleteSong(deleteConfirmId)}
                                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Add/Edit Song Modal */}
            <AddSongModal
                isOpen={isAddModalOpen}
                onClose={handleCloseModal}
                song={songToEdit}
                onSuccess={handleAddSongSuccess}
            />
        </>
    )
}
