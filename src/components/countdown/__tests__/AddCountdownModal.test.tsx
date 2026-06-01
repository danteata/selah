import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddCountdownModal } from '../AddCountdownModal'
import type { Slide } from '../../../types'

vi.mock('../../utils/BackgroundPicker', () => ({
    BackgroundPicker: ({ value, onChange, previewChildren }: any) => (
        <div data-testid="background-picker">
            <div data-testid="preview">{previewChildren}</div>
            <button onClick={() => onChange({ background: '#00ff00', backgroundType: 'color', label: 'Green' })}>
                Pick Green
            </button>
        </div>
    ),
}))

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onAdd: vi.fn(),
}

const editingSlide: Slide = {
    id: 'countdown-1',
    index: 0,
    name: 'Service Countdown',
    type: 'countdown',
    layout: 'full-text',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['<p>Service starts</p>', '01:30:00'],
    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    backgroundType: 'gradient',
}

describe('AddCountdownModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when closed', () => {
        const { container } = render(<AddCountdownModal {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders add countdown form when open', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByText('Add Countdown')).toBeInTheDocument()
    })

    it('renders title input', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByPlaceholderText('Service starts in...')).toBeInTheDocument()
    })

    it('renders hours, minutes, seconds inputs', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByText('Hours')).toBeInTheDocument()
        expect(screen.getByText('Minutes')).toBeInTheDocument()
        expect(screen.getByText('Seconds')).toBeInTheDocument()
    })

    it('defaults to 0:05:00', () => {
        render(<AddCountdownModal {...baseProps} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        const secondsInput = screen.getByText('Seconds').closest('.text-center')!.querySelector('input')!
        expect(hoursInput).toHaveValue(0)
        expect(minutesInput).toHaveValue(5)
        expect(secondsInput).toHaveValue(0)
    })

    it('shows quick presets', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByText('1m')).toBeInTheDocument()
        expect(screen.getByText('5m')).toBeInTheDocument()
        expect(screen.getByText('10m')).toBeInTheDocument()
        expect(screen.getByText('15m')).toBeInTheDocument()
        expect(screen.getByText('30m')).toBeInTheDocument()
        expect(screen.getByText('1h')).toBeInTheDocument()
    })

    it('applies preset when clicked', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('30m'))

        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        expect(minutesInput).toHaveValue(30)
    })

    it('applies 1h preset correctly', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('1h'))

        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        expect(hoursInput).toHaveValue(1)
        expect(minutesInput).toHaveValue(0)
    })

    it('calls onAdd with countdown data on submit', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('ADD COUNTDOWN'))

        expect(baseProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
            hours: 0,
            minutes: 5,
            seconds: 0,
            title: 'Countdown',
        }))
    })

    it('uses custom title when provided', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Service starts in...'), { target: { value: 'Worship Start' } })
        fireEvent.click(screen.getByText('ADD COUNTDOWN'))

        expect(baseProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Worship Start',
        }))
    })

    it('defaults title to "Countdown" when empty', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('ADD COUNTDOWN'))

        expect(baseProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Countdown',
        }))
    })

    it('calls onClose after submit', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('ADD COUNTDOWN'))

        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('calls onClose when cancel is clicked', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const { container } = render(<AddCountdownModal {...baseProps} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('renders edit form when editingSlide is provided', () => {
        render(<AddCountdownModal {...baseProps} editingSlide={editingSlide} />)
        expect(screen.getByText('Edit Countdown')).toBeInTheDocument()
    })

    it('shows UPDATE button when editing', () => {
        render(<AddCountdownModal {...baseProps} editingSlide={editingSlide} />)
        expect(screen.getByText('UPDATE')).toBeInTheDocument()
        expect(screen.queryByText('ADD COUNTDOWN')).not.toBeInTheDocument()
    })

    it('populates form from editing slide time', () => {
        render(<AddCountdownModal {...baseProps} editingSlide={editingSlide} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        const secondsInput = screen.getByText('Seconds').closest('.text-center')!.querySelector('input')!
        expect(hoursInput).toHaveValue(1)
        expect(minutesInput).toHaveValue(30)
        expect(secondsInput).toHaveValue(0)
    })

    it('populates title from editing slide', () => {
        render(<AddCountdownModal {...baseProps} editingSlide={editingSlide} />)
        expect(screen.getByDisplayValue('Service starts')).toBeInTheDocument()
    })

    it('calls onAdd with existing id when editing', () => {
        render(<AddCountdownModal {...baseProps} editingSlide={editingSlide} />)
        fireEvent.click(screen.getByText('UPDATE'))

        expect(baseProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({
            id: 'countdown-1',
        }))
    })

    it('renders background picker', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByTestId('background-picker')).toBeInTheDocument()
    })

    it('renders preview with time', () => {
        render(<AddCountdownModal {...baseProps} />)
        expect(screen.getByText('05:00')).toBeInTheDocument()
    })

    it('updates preview when time changes via preset', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.click(screen.getByText('1h'))
        expect(screen.getByText('01:00:00')).toBeInTheDocument()
    })

    it('renders inline mode without cancel button', () => {
        render(<AddCountdownModal {...baseProps} isInline={true} />)
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
        // The form content and submit button are still visible in inline mode
        expect(screen.getByText('Duration')).toBeInTheDocument()
        expect(screen.getByText('Quick Presets')).toBeInTheDocument()
    })

    it('does not close after submit in inline mode', () => {
        render(<AddCountdownModal {...baseProps} isInline={true} />)
        fireEvent.click(screen.getByText('ADD COUNTDOWN'))
        expect(baseProps.onClose).not.toHaveBeenCalled()
    })

    it('allows editing hours directly', () => {
        render(<AddCountdownModal {...baseProps} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        fireEvent.change(hoursInput, { target: { value: '2' } })
        expect(hoursInput).toHaveValue(2)
    })

    it('allows editing minutes directly', () => {
        render(<AddCountdownModal {...baseProps} />)
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        fireEvent.change(minutesInput, { target: { value: '45' } })
        expect(minutesInput).toHaveValue(45)
    })

    it('allows editing seconds directly', () => {
        render(<AddCountdownModal {...baseProps} />)
        const secondsInput = screen.getByText('Seconds').closest('.text-center')!.querySelector('input')!
        fireEvent.change(secondsInput, { target: { value: '30' } })
        expect(secondsInput).toHaveValue(30)
    })

    it('clamps hours to max 23', () => {
        render(<AddCountdownModal {...baseProps} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        fireEvent.change(hoursInput, { target: { value: '25' } })
        expect(hoursInput).toHaveValue(23)
    })

    it('clamps minutes to max 59', () => {
        render(<AddCountdownModal {...baseProps} />)
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        fireEvent.change(minutesInput, { target: { value: '70' } })
        expect(minutesInput).toHaveValue(59)
    })

    it('clamps seconds to max 59', () => {
        render(<AddCountdownModal {...baseProps} />)
        const secondsInput = screen.getByText('Seconds').closest('.text-center')!.querySelector('input')!
        fireEvent.change(secondsInput, { target: { value: '99' } })
        expect(secondsInput).toHaveValue(59)
    })

    it('clamps negative values to 0', () => {
        render(<AddCountdownModal {...baseProps} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        fireEvent.change(hoursInput, { target: { value: '-5' } })
        expect(hoursInput).toHaveValue(0)
    })

    it('handles non-numeric input as 0', () => {
        render(<AddCountdownModal {...baseProps} />)
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        fireEvent.change(minutesInput, { target: { value: 'abc' } })
        expect(minutesInput).toHaveValue(0)
    })

    it('parses MM:SS format from editing slide', () => {
        const mmssSlide: Slide = {
            ...editingSlide,
            contents: ['<p>Countdown</p>', '10:30'],
        }
        render(<AddCountdownModal {...baseProps} editingSlide={mmssSlide} />)
        const hoursInput = screen.getByText('Hours').closest('.text-center')!.querySelector('input')!
        const minutesInput = screen.getByText('Minutes').closest('.text-center')!.querySelector('input')!
        const secondsInput = screen.getByText('Seconds').closest('.text-center')!.querySelector('input')!
        expect(hoursInput).toHaveValue(0)
        expect(minutesInput).toHaveValue(10)
        expect(secondsInput).toHaveValue(30)
    })

    it('shows preview title when title is entered', () => {
        render(<AddCountdownModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Service starts in...'), { target: { value: 'Worship' } })
        expect(screen.getByText('Worship')).toBeInTheDocument()
    })
})
