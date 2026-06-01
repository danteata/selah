import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddSongModal } from '../AddSongModal'
import type { Song } from '../../../types'

const mockCreateSong = vi.fn()
const mockUpdateSong = vi.fn()

vi.mock('../../../hooks/useSongs', () => ({
    useSongs: () => ({
        createSong: mockCreateSong,
        updateSong: mockUpdateSong,
        loading: false,
        parseSongLyrics: vi.fn().mockReturnValue([]),
    }),
}))

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
}

const existingSong: Song = {
    _id: 'song-1',
    id: 'song-1',
    title: 'Amazing Grace',
    artist: 'John Newton',
    lyrics: 'Amazing grace how sweet the sound',
    isPublic: true,
} as Song

describe('AddSongModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCreateSong.mockResolvedValue({ _id: 'new-song', title: 'Test' } as Song)
        mockUpdateSong.mockResolvedValue({ _id: 'song-1', title: 'Updated' } as Song)
    })

    it('renders nothing when closed', () => {
        const { container } = render(<AddSongModal {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders add song form when open', () => {
        render(<AddSongModal {...baseProps} />)
        expect(screen.getByText('Add New Song')).toBeInTheDocument()
    })

    it('renders title input', () => {
        render(<AddSongModal {...baseProps} />)
        expect(screen.getByPlaceholderText('e.g., Hallelujah Eh')).toBeInTheDocument()
    })

    it('renders artist input', () => {
        render(<AddSongModal {...baseProps} />)
        expect(screen.getByPlaceholderText('e.g., Nathaniel Bassey')).toBeInTheDocument()
    })

    it('renders lyrics textarea', () => {
        render(<AddSongModal {...baseProps} />)
        expect(screen.getByPlaceholderText('Paste your lyrics here...')).toBeInTheDocument()
    })

    it('disables submit when title and lyrics are empty', () => {
        render(<AddSongModal {...baseProps} />)
        const submitBtn = screen.getByRole('button', { name: /Add Song/i })
        expect(submitBtn).toBeDisabled()
    })

    it('disables submit when only title is filled', () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        const submitBtn = screen.getByRole('button', { name: /Add Song/i })
        expect(submitBtn).toBeDisabled()
    })

    it('disables submit when only lyrics are filled', () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })
        const submitBtn = screen.getByRole('button', { name: /Add Song/i })
        expect(submitBtn).toBeDisabled()
    })

    it('enables submit when both title and lyrics are filled', () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })
        const submitBtn = screen.getByRole('button', { name: /Add Song/i })
        expect(submitBtn).not.toBeDisabled()
    })

    it('calls createSong with correct data on valid submit', async () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('e.g., Nathaniel Bassey'), { target: { value: 'My Artist' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Some lyrics here' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(mockCreateSong).toHaveBeenCalledWith(
                { title: 'My Song', artist: 'My Artist', lyrics: 'Some lyrics here' },
                true
            )
        })
    })

    it('defaults artist to "Unknown" when empty', async () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(mockCreateSong).toHaveBeenCalledWith(
                expect.objectContaining({ artist: 'Unknown' }),
                true
            )
        })
    })

    it('trims whitespace from title and artist', async () => {
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: '  My Song  ' } })
        fireEvent.change(screen.getByPlaceholderText('e.g., Nathaniel Bassey'), { target: { value: '  My Artist  ' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(mockCreateSong).toHaveBeenCalledWith(
                { title: 'My Song', artist: 'My Artist', lyrics: 'Lyrics' },
                true
            )
        })
    })

    it('calls onClose after successful creation', async () => {
        const onClose = vi.fn()
        render(<AddSongModal {...baseProps} onClose={onClose} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled()
        })
    })

    it('calls onSuccess with result after successful creation', async () => {
        const onSuccess = vi.fn()
        render(<AddSongModal {...baseProps} onSuccess={onSuccess} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(onSuccess).toHaveBeenCalledWith({ _id: 'new-song', title: 'Test' })
        })
    })

    it('shows error message when createSong returns null', async () => {
        mockCreateSong.mockResolvedValue(null)
        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(screen.getByText('Failed to save song. Please try again.')).toBeInTheDocument()
        })
    })

    it('does not call onClose when createSong returns null', async () => {
        mockCreateSong.mockResolvedValue(null)
        const onClose = vi.fn()
        render(<AddSongModal {...baseProps} onClose={onClose} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))

        await waitFor(() => {
            expect(screen.getByText('Failed to save song. Please try again.')).toBeInTheDocument()
        })
        expect(onClose).not.toHaveBeenCalled()
    })

    it('shows edit form when song prop is provided', () => {
        render(<AddSongModal {...baseProps} song={existingSong} />)
        expect(screen.getByText('Edit Song')).toBeInTheDocument()
    })

    it('populates form fields when editing existing song', () => {
        render(<AddSongModal {...baseProps} song={existingSong} />)
        expect(screen.getByDisplayValue('Amazing Grace')).toBeInTheDocument()
        expect(screen.getByDisplayValue('John Newton')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Amazing grace how sweet the sound')).toBeInTheDocument()
    })

    it('calls updateSong instead of createSong when editing', async () => {
        render(<AddSongModal {...baseProps} song={existingSong} />)
        const submitBtn = screen.getByRole('button', { name: /Update Song/i })
        fireEvent.click(submitBtn)

        await waitFor(() => {
            expect(mockUpdateSong).toHaveBeenCalledWith('song-1', expect.objectContaining({
                title: 'Amazing Grace',
            }))
        })
        expect(mockCreateSong).not.toHaveBeenCalled()
    })

    it('shows public toggle only for new songs', () => {
        const { rerender } = render(<AddSongModal {...baseProps} />)
        expect(screen.getByText('Share this song with other users?')).toBeInTheDocument()

        rerender(<AddSongModal {...baseProps} song={existingSong} />)
        expect(screen.queryByText('Share this song with other users?')).not.toBeInTheDocument()
    })

    it('calls onClose when cancel button is clicked', () => {
        const onClose = vi.fn()
        render(<AddSongModal {...baseProps} onClose={onClose} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        const { container } = render(<AddSongModal {...baseProps} onClose={onClose} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalled()
    })

    it('shows verse count when lyrics are entered', () => {
        render(<AddSongModal {...baseProps} />)
        const lyricsArea = screen.getByPlaceholderText('Paste your lyrics here...')
        fireEvent.change(lyricsArea, { target: { value: 'Verse 1\n\nVerse 2' } })
        expect(screen.getByText('2 verses will be created')).toBeInTheDocument()
    })

    it('toggles verse preview when preview button is clicked', () => {
        render(<AddSongModal {...baseProps} />)
        const lyricsArea = screen.getByPlaceholderText('Paste your lyrics here...')
        fireEvent.change(lyricsArea, { target: { value: 'Verse 1\n\nVerse 2' } })

        const previewBtn = screen.getByText('Preview Verses')
        fireEvent.click(previewBtn)

        expect(screen.getByText('Hide Preview')).toBeInTheDocument()
        expect(screen.getByText('Preview: 2 verses detected')).toBeInTheDocument()
    })

    it('hides verse preview when toggled off', () => {
        render(<AddSongModal {...baseProps} />)
        const lyricsArea = screen.getByPlaceholderText('Paste your lyrics here...')
        fireEvent.change(lyricsArea, { target: { value: 'Verse 1\n\nVerse 2' } })

        fireEvent.click(screen.getByText('Preview Verses'))
        expect(screen.getByText('Hide Preview')).toBeInTheDocument()

        fireEvent.click(screen.getByText('Hide Preview'))
        expect(screen.getByText('Preview Verses')).toBeInTheDocument()
    })

    it('clears error when form fields are corrected and resubmitted', async () => {
        mockCreateSong
            .mockResolvedValueOnce(null)  // First attempt fails
            .mockResolvedValueOnce({ _id: 'new-song', title: 'Test' } as Song)  // Second attempt succeeds

        render(<AddSongModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('e.g., Hallelujah Eh'), { target: { value: 'My Song' } })
        fireEvent.change(screen.getByPlaceholderText('Paste your lyrics here...'), { target: { value: 'Lyrics' } })

        // First submit - fails
        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))
        await waitFor(() => {
            expect(screen.getByText('Failed to save song. Please try again.')).toBeInTheDocument()
        })

        // Second submit - succeeds
        fireEvent.click(screen.getByRole('button', { name: /Add Song/i }))
        await waitFor(() => {
            expect(screen.queryByText('Failed to save song. Please try again.')).not.toBeInTheDocument()
        })
    })

    it('shows hint about empty lines for verse breaking', () => {
        render(<AddSongModal {...baseProps} />)
        expect(screen.getByText(/Add an/)).toBeInTheDocument()
        expect(screen.getByText(/empty line/)).toBeInTheDocument()
    })
})
