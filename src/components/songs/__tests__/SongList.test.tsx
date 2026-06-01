import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SongList } from '../SongList'
import type { Song } from '../../../types'

const mockDeleteSong = vi.fn().mockResolvedValue(true)
const mockSearchSongs = vi.fn().mockReturnValue([])
const mockParseSongLyrics = vi.fn().mockReturnValue([])
const mockGetSong = vi.fn()
const mockCreateSongSlides = vi.fn().mockReturnValue([])
const mockAppendActiveSlide = vi.fn()

vi.mock('../../../hooks', () => ({
    useSongs: () => ({
        songs: [
            { _id: 's1', id: 's1', title: 'Amazing Grace', artist: 'John Newton', lyrics: 'Amazing grace how sweet the sound' },
            { _id: 's2', id: 's2', title: 'How Great Thou Art', artist: 'Carl Boberg', lyrics: 'O Lord my God' },
            { _id: 's3', id: 's3', title: 'Great Is Thy Faithfulness', artist: 'Thomas Chisholm', lyrics: 'Great is thy faithfulness' },
        ] as Song[],
        loading: false,
        searchSongs: mockSearchSongs,
        deleteSong: mockDeleteSong,
        parseSongLyrics: mockParseSongLyrics,
    }),
    useSong: () => ({
        getSong: mockGetSong,
    }),
    useSlideCreation: () => ({
        createSongSlides: mockCreateSongSlides,
    }),
}))

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn().mockImplementation((selector: any) => {
        const state = {
            appendActiveSlide: mockAppendActiveSlide,
        }
        return typeof selector === 'function' ? selector(state) : state
    }),
}))

vi.mock('../templates/TemplateSelector', () => ({
    TemplateSelector: () => <div data-testid="template-selector" />,
}))

vi.mock('../../../hooks/useTemplates', () => ({
    useTemplates: () => ({
        templates: [],
        getTemplatesForSlideType: vi.fn().mockReturnValue([]),
    }),
}))

vi.mock('../AddSongModal', () => ({
    AddSongModal: ({ isOpen, onClose }: any) => isOpen ? <div data-testid="add-song-modal"><button onClick={onClose}>Close Modal</button></div> : null,
}))

describe('SongList', () => {
    const baseProps = {
        onClose: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders songs library header', () => {
        render(<SongList {...baseProps} />)
        expect(screen.getByText('Songs Library')).toBeInTheDocument()
    })

    it('renders search input', () => {
        render(<SongList {...baseProps} />)
        expect(screen.getByPlaceholderText('Search songs...')).toBeInTheDocument()
    })

    it('renders all songs', () => {
        render(<SongList {...baseProps} />)
        expect(screen.getByText('Amazing Grace')).toBeInTheDocument()
        expect(screen.getByText('How Great Thou Art')).toBeInTheDocument()
        expect(screen.getByText('Great Is Thy Faithfulness')).toBeInTheDocument()
    })

    it('renders artist names', () => {
        render(<SongList {...baseProps} />)
        expect(screen.getByText('John Newton')).toBeInTheDocument()
        expect(screen.getByText('Carl Boberg')).toBeInTheDocument()
    })

    it('filters songs by title', () => {
        render(<SongList {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Search songs...'), { target: { value: 'Amazing' } })
        expect(screen.getByText('Amazing Grace')).toBeInTheDocument()
        expect(screen.queryByText('How Great Thou Art')).not.toBeInTheDocument()
    })

    it('filters songs by artist', () => {
        render(<SongList {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Search songs...'), { target: { value: 'Newton' } })
        expect(screen.getByText('Amazing Grace')).toBeInTheDocument()
        expect(screen.queryByText('How Great Thou Art')).not.toBeInTheDocument()
    })

    it('shows no results for non-matching search', () => {
        render(<SongList {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Search songs...'), { target: { value: 'xyz' } })
        expect(screen.getByText('No songs found')).toBeInTheDocument()
    })

    it('calls onClose when back button is clicked', () => {
        render(<SongList {...baseProps} />)
        // The header has a back button with ChevronLeft icon
        const header = screen.getByText('Songs Library').closest('.flex')!
        const backBtn = header.querySelector('button')!
        fireEvent.click(backBtn)
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('opens add song modal when Add Song button is clicked', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Add Song'))
        expect(screen.getByTestId('add-song-modal')).toBeInTheDocument()
    })

    it('shows song detail when song is clicked', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Amazing Grace'))
        expect(screen.getByText('Amazing grace how sweet the sound')).toBeInTheDocument()
    })

    it('shows back button in song detail', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Amazing Grace'))
        // The back button has no text, just a ChevronLeft icon
        const backButtons = screen.getAllByRole('button')
        const backButton = backButtons.find(b => b.querySelector('.lucide-chevron-left'))
        expect(backButton).toBeTruthy()
    })

    it('returns to song list when back is clicked in detail', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Amazing Grace'))
        const backButtons = screen.getAllByRole('button')
        const backButton = backButtons.find(b => b.querySelector('.lucide-chevron-left'))
        fireEvent.click(backButton!)
        expect(screen.getByText('Songs Library')).toBeInTheDocument()
    })

    it('shows Create Slides button in detail view', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Amazing Grace'))
        expect(screen.getByText('Create Slides')).toBeInTheDocument()
    })

    it('shows song detail with lyrics when song is selected', () => {
        render(<SongList {...baseProps} />)
        fireEvent.click(screen.getByText('Amazing Grace'))
        // The detail view should show the song lyrics
        expect(screen.getByText('Amazing grace how sweet the sound')).toBeInTheDocument()
        // And the Create Slides button
        expect(screen.getByText('Create Slides')).toBeInTheDocument()
    })

    it('shows delete confirmation when delete is clicked', () => {
        render(<SongList {...baseProps} />)
        // Hover over a song to reveal the delete button
        const deleteButtons = screen.getAllByTitle('Delete song')
        fireEvent.click(deleteButtons[0])
        expect(screen.getByText('Delete Song?')).toBeInTheDocument()
    })

    it('calls deleteSong when delete is confirmed', async () => {
        render(<SongList {...baseProps} />)
        const deleteButtons = screen.getAllByTitle('Delete song')
        fireEvent.click(deleteButtons[0])
        fireEvent.click(screen.getByText('Delete'))
        await waitFor(() => {
            expect(mockDeleteSong).toHaveBeenCalledWith('s1')
        })
    })

    it('closes delete confirmation when cancel is clicked', () => {
        render(<SongList {...baseProps} />)
        const deleteButtons = screen.getAllByTitle('Delete song')
        fireEvent.click(deleteButtons[0])
        fireEvent.click(screen.getByText('Cancel'))
        expect(screen.queryByText('Delete Song?')).not.toBeInTheDocument()
    })

    it('hides header when isInline is true', () => {
        render(<SongList {...baseProps} isInline={true} />)
        expect(screen.queryByText('Songs Library')).not.toBeInTheDocument()
    })

    it('renders inline mode', () => {
        render(<SongList {...baseProps} isInline={true} />)
        expect(screen.getByPlaceholderText('Search songs...')).toBeInTheDocument()
        expect(screen.getByText('Amazing Grace')).toBeInTheDocument()
    })

    it('shows edit button on song hover', () => {
        render(<SongList {...baseProps} />)
        const editButtons = screen.getAllByTitle('Edit song')
        expect(editButtons.length).toBeGreaterThan(0)
    })

    it('opens add modal in edit mode when edit is clicked', () => {
        render(<SongList {...baseProps} />)
        const editButtons = screen.getAllByTitle('Edit song')
        fireEvent.click(editButtons[0])
        expect(screen.getByTestId('add-song-modal')).toBeInTheDocument()
    })
})
