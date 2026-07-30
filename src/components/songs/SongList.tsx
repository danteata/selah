import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, Plus, ChevronLeft, Music, Trash2, Edit, CloudOff, Zap } from 'lucide-react'
import { buildMusicIndex, searchMusicIndex } from '../../lib/search/musicSearch'
import { useSong, useSongs, useSlideCreation, useAnalytics } from '../../hooks'
import { useGoLive } from '../../hooks/useGoLive'
import { useResultNavigation } from '../../hooks/useResultNavigation'
import { AnalyticsEventType } from '../../services/analytics/types'
import { useVoiceSearch } from '../../hooks/useVoiceSearch'
import { VoiceSearchButton } from '../common/VoiceSearchButton'
import { useAppStore } from '../../store/appStore'
import { AddSongModal } from './AddSongModal'
import { TemplateSelector } from '../templates/TemplateSelector'
import { useTemplates, type TemplateItem } from '../../hooks/useTemplates'
import type { Song } from '../../types'

interface SongListProps {
    onClose: () => void
    isInline?: boolean
    /** Hide the internal search box (the parent owns search, e.g. the unified
     *  MusicBrowser). The New-song button stays. */
    hideSearch?: boolean
}

export function SongList({ onClose, isInline = false, hideSearch = false }: SongListProps) {
    const [query, setQuery] = useState('')
    const [selectedSong, setSelectedSong] = useState<Song | null>(null)
    const [songToEdit, setSongToEdit] = useState<Song | null>(null)
    const [isAddModalOpen, setIsAddModalOpen] = useState(false)
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)

    const { songs, loading: songsLoading, searchSongs, deleteSong, parseSongLyrics } = useSongs()
    const { getSong } = useSong()
    const { createSongSlides } = useSlideCreation()
    const { trackEvent } = useAnalytics()
    const { canGoLive, addToQueue, addAndGoLive } = useGoLive()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const lastSearchTrackRef = useRef<number>(0)

    // Quick "Add" / "Live" straight from a result row — no detail-view detour.
    // Live appends the song's verses and puts verse 1 on the output; Add just
    // queues it. Mirrors BibleList's per-result Add/Live buttons.
    const quickSelect = useCallback(async (song: Song, goLive: boolean) => {
        const full = await getSong(song)
        const slides = createSongSlides((full ?? song) as Song, { template: selectedTemplate })
        if (slides.length === 0) return
        // Keep the panel open (Add and Live) so the operator can navigate the
        // song's verses in the LiveSongNavigator and keep searching.
        if (goLive) {
            addAndGoLive(slides)
            trackEvent(AnalyticsEventType.SONG_SELECTED, {
                song_id: (full ?? song)._id || (full ?? song).id,
                title: song.title,
                slide_count: slides.length,
                has_template: !!selectedTemplate,
            })
        } else {
            addToQueue(slides)
        }
    }, [getSong, createSongSlides, selectedTemplate, addAndGoLive, addToQueue, trackEvent])

    const voice = useVoiceSearch({
        onFinal: (text) => setQuery(text),
    })

    // BM25 index over the loaded library — title/artist field-weighted above
    // lyrics — rebuilt only when the list changes, then queried per keystroke.
    const songIndex = useMemo(
        () => buildMusicIndex(
            songs.map((s: Song) => ({
                id: s._id || s.id,
                title: s.title,
                subtitle: s.artist,
                body: s.lyrics || '',
            })),
        ),
        [songs],
    )

    // Ranked, typo/punctuation/whitespace-tolerant search over title/artist +
    // lyrics, so a half-remembered line ("amazing grace how sweet") finds the
    // song even when the operator misremembers the title. Empty query browses
    // the full list in stored order.
    const filteredSongs = useMemo(() => {
        const q = query.trim()
        if (!q) return songs
        const byId = new Map(songs.map((s) => [s._id || s.id, s]))
        return searchMusicIndex(songIndex, q, 50)
            .map((r) => byId.get(r.item.id))
            .filter((s): s is Song => !!s)
    }, [songs, songIndex, query])

    // Same keyboard contract as the Bible and dictionary panels: the top hit is
    // highlighted as results arrive, Enter sends it live, Shift+Enter queues it.
    const { focusedIndex, setFocusedIndex, handleKeyDown, listRef } = useResultNavigation<HTMLDivElement>({
        count: filteredSongs.length,
        resetKey: `${query}:${filteredSongs.length}`,
        onActivate: (index, { queue }) => {
            const song = filteredSongs[index]
            if (song) void quickSelect(song, !queue)
        },
        // The detail view owns the keyboard while a song is open.
        enabled: !selectedSong,
    })

    // Throttled song search tracking — fire at most once per 2s
    useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length < 2) return
        const now = Date.now()
        if (now - lastSearchTrackRef.current < 2000) return
        lastSearchTrackRef.current = now
        trackEvent(AnalyticsEventType.SONG_SEARCHED, {
            query_length: trimmed.length,
            result_count: filteredSongs.length,
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

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
                trackEvent(AnalyticsEventType.SONG_SELECTED, {
                    song_id: songWithVerses._id || songWithVerses.id,
                    title: songWithVerses.title,
                    slide_count: slides.length,
                    has_template: !!selectedTemplate,
                })
            }
            // Keep the panel open; return to the list so the operator can pick
            // another song or navigate verses.
            setSelectedSong(null)
        }
    }, [selectedSong, getSong, createSongSlides, appendActiveSlide, selectedTemplate, trackEvent])

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

    // No early-return spinner here — the list body renders a skeleton while
    // songs load (see below), which is steadier than a full-panel spinner.

    // Subtitle under the title: the author when known, otherwise a short lyrics
    // preview (so many "Unknown" authors don't leave a useless line — you can
    // decide from the first line whether to add / go live).
    const songSubtitle = (song: Song): string => {
        const artist = (song.artist || '').trim()
        if (artist && artist.toLowerCase() !== 'unknown') return artist
        const preview = (song.lyrics || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        return preview || artist || 'Unknown'
    }

    return (
        <>
            <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg" onKeyDown={handleKeyDown}>
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

                {/* Search — hidden when a parent (unified MusicBrowser) owns it,
                    which also owns the New-song action, so nothing renders here. */}
                {!hideSearch && (
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    value={voice.isListening ? voice.transcript : query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={voice.isListening ? 'Listening…' : 'Search songs…'}
                                    className="w-full pl-10 pr-10 py-2 border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <VoiceSearchButton
                                        isListening={voice.isListening}
                                        isSupported={voice.isSupported}
                                        error={voice.error}
                                        onClick={voice.isListening ? voice.stop : voice.start}
                                    />
                                </div>
                            </div>
                            {/* Compact New-song button, same height as the input. */}
                            {isInline && (
                                <button
                                    onClick={() => setIsAddModalOpen(true)}
                                    title="New song"
                                    aria-label="New song"
                                    className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Songs List */}
                {!selectedSong ? (
                    <div className="flex-1 overflow-y-auto" ref={listRef}>
                        {songsLoading && filteredSongs.length === 0 ? (
                            /* Skeleton while the library loads — avoids flashing the
                               deceptive "No songs yet" state before songs arrive. */
                            <div className="p-3 space-y-2.5">
                                {Array.from({ length: 7 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-2 px-1 py-1.5">
                                        <div className="flex-1 min-w-0 space-y-1.5">
                                            <div
                                                className="h-3.5 rounded bg-gray-200 dark:bg-gray-800 animate-pulse"
                                                style={{ width: `${66 - (i % 3) * 14}%` }}
                                            />
                                            <div className="h-2.5 w-1/4 rounded bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
                                        </div>
                                        <div className="h-6 w-14 rounded-lg bg-gray-200 dark:bg-gray-800 animate-pulse flex-shrink-0" />
                                    </div>
                                ))}
                            </div>
                        ) : filteredSongs.length === 0 ? (
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
                                {filteredSongs.map((song, index) => (
                                    <div
                                        key={song._id || song.id}
                                        data-result-index={index}
                                        onMouseEnter={() => setFocusedIndex(index)}
                                        className={`flex items-center justify-between px-4 py-3 group ${
                                            focusedIndex === index
                                                ? 'bg-[var(--accent-teal)]/8 ring-1 ring-inset ring-[var(--accent-teal)]/20'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                                        }`}
                                    >
                                        <button
                                            onClick={() => setSelectedSong(song)}
                                            className="flex-1 text-left"
                                        >
                                            <h3 className="font-medium text-gray-900 dark:text-white truncate">
                                                {song.title}
                                            </h3>
                                            <p className="text-sm text-gray-500 truncate">{songSubtitle(song)}</p>
                                        </button>
                                        <div className="flex items-center gap-1">
                                            {/* Edit/delete are PREPENDED and reveal on
                                                hover, so Add/Live stay pinned at the far
                                                right (consistent with the results list). */}
                                            <div className="hidden group-hover:flex items-center gap-1">
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
                                            {/* Quick actions — always visible so you can
                                                go live in one click without the detail view. */}
                                            <button
                                                onClick={() => void quickSelect(song, false)}
                                                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10 transition-colors"
                                                title="Add to queue"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                                Add
                                            </button>
                                            {canGoLive && (
                                                <button
                                                    onClick={() => void quickSelect(song, true)}
                                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
                                                    title="Send to live output"
                                                >
                                                    <Zap className="w-3.5 h-3.5" />
                                                    Live
                                                </button>
                                            )}
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
