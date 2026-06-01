import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaPicker } from '../MediaPicker'

vi.mock('../MediaUpload', () => ({
    MediaUpload: ({ onUpload, onCancel }: any) => (
        <div data-testid="media-upload">
            <button onClick={() => onUpload([{ id: 'u1', name: 'Uploaded', type: 'image', url: 'blob:test' }])}>
                Simulate Upload
            </button>
            <button onClick={onCancel}>Cancel Upload</button>
        </div>
    ),
}))

describe('MediaPicker', () => {
    const baseProps = {
        isOpen: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when closed', () => {
        const { container } = render(<MediaPicker {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders media picker when open', () => {
        render(<MediaPicker {...baseProps} />)
        expect(screen.getByText('Select Media')).toBeInTheDocument()
    })

    it('shows library and upload tabs when allowUpload is true', () => {
        render(<MediaPicker {...baseProps} />)
        expect(screen.getByText('Library')).toBeInTheDocument()
        expect(screen.getByText('Upload')).toBeInTheDocument()
    })

    it('hides tabs when allowUpload is false', () => {
        render(<MediaPicker {...baseProps} allowUpload={false} />)
        expect(screen.queryByText('Library')).not.toBeInTheDocument()
        expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    })

    it('shows search input', () => {
        render(<MediaPicker {...baseProps} />)
        expect(screen.getByPlaceholderText('Search media...')).toBeInTheDocument()
    })

    it('shows loading spinner initially', () => {
        const { container } = render(<MediaPicker {...baseProps} />)
        const spinner = container.querySelector('.animate-spin')
        expect(spinner).toBeTruthy()
    })

    it('switches to upload tab', () => {
        render(<MediaPicker {...baseProps} />)
        fireEvent.click(screen.getByText('Upload'))
        expect(screen.getByTestId('media-upload')).toBeInTheDocument()
    })

    it('switches back to library from upload', () => {
        render(<MediaPicker {...baseProps} />)
        fireEvent.click(screen.getByText('Upload'))
        fireEvent.click(screen.getByText('Cancel Upload'))
        expect(screen.getByPlaceholderText('Search media...')).toBeInTheDocument()
    })

    it('calls onClose when close button is clicked', () => {
        const { container } = render(<MediaPicker {...baseProps} />)
        const closeBtn = container.querySelector('button:has(.lucide-x)')
        expect(closeBtn).toBeTruthy()
        fireEvent.click(closeBtn!)
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const { container } = render(<MediaPicker {...baseProps} />)
        const backdrop = container.querySelector('.bg-black\\/60')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('closes on Escape key', () => {
        render(<MediaPicker {...baseProps} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('renders inline mode without modal overlay', () => {
        const { container } = render(<MediaPicker {...baseProps} isInline={true} />)
        const overlay = container.querySelector('[class*="fixed"][class*="inset-0"][class*="bg-black"]')
        expect(overlay).toBeNull()
    })

    it('hides header in inline mode', () => {
        render(<MediaPicker {...baseProps} isInline={true} />)
        expect(screen.queryByText('Select Media')).not.toBeInTheDocument()
    })

    it('allows upload in upload tab', () => {
        render(<MediaPicker {...baseProps} />)
        fireEvent.click(screen.getByText('Upload'))
        // Verify we're in the upload tab
        expect(screen.getByTestId('media-upload')).toBeInTheDocument()
        // The upload component has a simulate upload button
        fireEvent.click(screen.getByText('Simulate Upload'))
        // After upload, it switches back to library tab
        expect(screen.getByPlaceholderText('Search media...')).toBeInTheDocument()
        // The upload tab should no longer be active
        expect(screen.queryByTestId('media-upload')).not.toBeInTheDocument()
    })

    it('does not show Upload tab when allowUpload is false', () => {
        render(<MediaPicker {...baseProps} allowUpload={false} />)
        expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    })

    it('disables Use Selected when no media is selected', async () => {
        render(<MediaPicker {...baseProps} />)
        await waitFor(() => {
            expect(screen.queryByText('Use Selected')).toBeInTheDocument()
        }, { timeout: 10000 })
        const useBtn = screen.getByText('Use Selected')
        expect(useBtn).toBeDisabled()
    }, 15000)

    it('filters by mediaType prop shows no results for video', async () => {
        render(<MediaPicker {...baseProps} mediaType="video" />)
        await waitFor(() => {
            expect(screen.getByText('No media found')).toBeInTheDocument()
        }, { timeout: 10000 })
    }, 15000)
})
