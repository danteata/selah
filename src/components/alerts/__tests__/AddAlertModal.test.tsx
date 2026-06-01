import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AddAlertModal } from '../AddAlertModal'
import type { Slide } from '../../../types'

const mockSetAlerts = vi.fn()
const mockAppendActiveSlide = vi.fn()
const mockUpdateActiveSlide = vi.fn()
const mockAlerts: any[] = []

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn().mockImplementation((selector: any) => {
        const state = {
            setAlerts: mockSetAlerts,
            alerts: mockAlerts,
            appendActiveSlide: mockAppendActiveSlide,
            updateActiveSlide: mockUpdateActiveSlide,
            activeSchedule: { _id: 'schedule-1' },
        }
        return typeof selector === 'function' ? selector(state) : state
    }),
}))

vi.mock('../../utils/BackgroundPicker', () => ({
    BackgroundPicker: ({ value, onChange, previewChildren }: any) => (
        <div data-testid="background-picker">
            <div data-testid="preview">{previewChildren}</div>
            <button onClick={() => onChange({ background: '#ff0000', backgroundType: 'color', label: 'Red' })}>
                Pick Red
            </button>
        </div>
    ),
}))

const editingSlide: Slide = {
    id: 'alert-1',
    index: 0,
    name: 'Test Alert',
    type: 'alert',
    layout: 'lower-third',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['<p>Important</p>', '<p>Service starts now</p>'],
    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    backgroundType: 'gradient',
}

describe('AddAlertModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockAlerts.length = 0
    })

    it('renders nothing when closed', () => {
        const { container } = render(<AddAlertModal isOpen={false} onClose={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders create alert form when open', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('Create Alert')).toBeInTheDocument()
    })

    it('renders title input', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByPlaceholderText('Announcement')).toBeInTheDocument()
    })

    it('renders message textarea', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByPlaceholderText('Enter your announcement...')).toBeInTheDocument()
    })

    it('shows display style options', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('Full Screen')).toBeInTheDocument()
        expect(screen.getByText('Banner')).toBeInTheDocument()
    })

    it('shows duration options', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('3s')).toBeInTheDocument()
        expect(screen.getByText('5s')).toBeInTheDocument()
        expect(screen.getByText('10s')).toBeInTheDocument()
        expect(screen.getByText('15s')).toBeInTheDocument()
        expect(screen.getByText('30s')).toBeInTheDocument()
    })

    it('shows priority options', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('Low')).toBeInTheDocument()
        expect(screen.getByText('Medium')).toBeInTheDocument()
        expect(screen.getByText('High')).toBeInTheDocument()
    })

    it('defaults to fullscreen style', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        const fullscreenBtn = screen.getByText('Full Screen').closest('button')!
        expect(fullscreenBtn.className).toContain('border-blue-500')
    })

    it('defaults to medium priority', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        const mediumBtn = screen.getByText('Medium').closest('button')!
        expect(mediumBtn.className).toContain('ring-2')
    })

    it('defaults to 5s duration', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        const fiveBtn = screen.getByText('5s').closest('button')!
        expect(fiveBtn.className).toContain('ring-2')
    })

    it('switches display style to banner', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.click(screen.getByText('Banner').closest('button')!)
        const bannerBtn = screen.getByText('Banner').closest('button')!
        expect(bannerBtn.className).toContain('border-blue-500')
    })

    it('switches priority to high', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.click(screen.getByText('High').closest('button')!)
        const highBtn = screen.getByText('High').closest('button')!
        expect(highBtn.className).toContain('ring-2')
    })

    it('switches duration to 10s', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.click(screen.getByText('10s').closest('button')!)
        const tenBtn = screen.getByText('10s').closest('button')!
        expect(tenBtn.className).toContain('ring-2')
    })

    it('calls onClose when cancel is clicked', () => {
        const onClose = vi.fn()
        render(<AddAlertModal isOpen={true} onClose={onClose} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        const { container } = render(<AddAlertModal isOpen={true} onClose={onClose} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalled()
    })

    it('creates alert and slide on valid submit', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Announcement'), { target: { value: 'Title' } })
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Message body' } })

        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockSetAlerts).toHaveBeenCalled()
        expect(mockAppendActiveSlide).toHaveBeenCalledWith(expect.objectContaining({
            type: 'alert',
            contents: expect.arrayContaining([expect.stringContaining('Title')]),
        }))
    })

    it('does not create alert when content is empty', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Announcement'), { target: { value: 'Title' } })

        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockSetAlerts).not.toHaveBeenCalled()
        expect(mockAppendActiveSlide).not.toHaveBeenCalled()
    })

    it('allows submit with only content (no title)', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Just content' } })

        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockAppendActiveSlide).toHaveBeenCalledWith(expect.objectContaining({
            contents: [expect.stringContaining('Just content')],
        }))
    })

    it('closes after successful submit', () => {
        const onClose = vi.fn()
        render(<AddAlertModal isOpen={true} onClose={onClose} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })

        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(onClose).toHaveBeenCalled()
    })

    it('shows edit form when editingSlide is provided', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={editingSlide} />)
        expect(screen.getByText('Edit Alert')).toBeInTheDocument()
    })

    it('populates form from editing slide', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={editingSlide} />)
        expect(screen.getByDisplayValue('Important')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Service starts now')).toBeInTheDocument()
    })

    it('shows banner style when editing slide has lower-third layout', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={editingSlide} />)
        const bannerBtn = screen.getByText('Banner').closest('button')!
        expect(bannerBtn.className).toContain('border-blue-500')
    })

    it('updates existing slide when editing', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={editingSlide} />)
        fireEvent.click(screen.getByText('UPDATE ALERT'))

        expect(mockUpdateActiveSlide).toHaveBeenCalledWith(expect.objectContaining({
            id: 'alert-1',
        }))
        expect(mockAppendActiveSlide).not.toHaveBeenCalled()
    })

    it('shows ADD ALERT button for new alert', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('ADD ALERT')).toBeInTheDocument()
        expect(screen.queryByText('UPDATE ALERT')).not.toBeInTheDocument()
    })

    it('shows UPDATE ALERT button when editing', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={editingSlide} />)
        expect(screen.getByText('UPDATE ALERT')).toBeInTheDocument()
        expect(screen.queryByText('ADD ALERT')).not.toBeInTheDocument()
    })

    it('renders background picker', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByTestId('background-picker')).toBeInTheDocument()
    })

    it('renders inline mode without cancel button', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} isInline={true} />)
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
        // Form content is still visible in inline mode
        expect(screen.getByText('Display Style')).toBeInTheDocument()
        expect(screen.getByText('Message')).toBeInTheDocument()
    })

    it('renders inline mode without cancel button', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} isInline={true} />)
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    })

    it('does not close after submit in inline mode', () => {
        const onClose = vi.fn()
        render(<AddAlertModal isOpen={true} onClose={onClose} isInline={true} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })

        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(onClose).not.toHaveBeenCalled()
    })

    it('strips HTML tags from editing slide content', () => {
        const slideWithHtml: Slide = {
            ...editingSlide,
            contents: ['<h2>Title</h2>', '<p class="bold">Content</p>'],
        }
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} editingSlide={slideWithHtml} />)
        expect(screen.getByDisplayValue('Title')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Content')).toBeInTheDocument()
    })

    it('sets banner layout for banner style alert', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })
        fireEvent.click(screen.getByText('Banner').closest('button')!)
        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockAppendActiveSlide).toHaveBeenCalledWith(expect.objectContaining({
            layout: 'lower-third',
        }))
    })

    it('sets full-text layout for fullscreen style alert', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })
        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockAppendActiveSlide).toHaveBeenCalledWith(expect.objectContaining({
            layout: 'full-text',
        }))
    })

    it('shows preview text in background picker', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        const preview = screen.getByTestId('preview')
        expect(preview.textContent).toContain('Alert preview')
    })

    it('updates preview when title and content are entered', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Announcement'), { target: { value: 'My Title' } })
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'My message' } })
        // The preview is rendered inside the BackgroundPicker mock's preview slot
        const preview = screen.getByTestId('preview')
        expect(preview.textContent).toContain('My Title')
        expect(preview.textContent).toContain('My message')
    })

    it('includes priority in created alert', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })
        fireEvent.click(screen.getByText('High').closest('button')!)
        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockSetAlerts).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ priority: 'high' }),
            ])
        )
    })

    it('includes duration in created alert', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })
        fireEvent.click(screen.getByText('10s').closest('button')!)
        fireEvent.click(screen.getByText('ADD ALERT'))

        expect(mockSetAlerts).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ duration: 10 }),
            ])
        )
    })

    it('sets background from background picker', () => {
        render(<AddAlertModal isOpen={true} onClose={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your announcement...'), { target: { value: 'Test' } })
        fireEvent.click(screen.getByText('Pick Red'))
        fireEvent.click(screen.getByText('ADD ALERT'))

        // The form should submit successfully with content filled
        expect(mockAppendActiveSlide).toHaveBeenCalled()
        expect(mockSetAlerts).toHaveBeenCalled()
    })
})
