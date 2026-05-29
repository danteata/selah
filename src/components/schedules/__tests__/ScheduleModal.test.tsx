import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScheduleModal } from '../ScheduleModal'

const createScheduleMock = vi.fn()

vi.mock('../../../hooks/useSchedules', () => ({
    useSchedules: vi.fn(() => ({ createSchedule: createScheduleMock })),
}))

describe('ScheduleModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when closed', () => {
        const { container } = render(<ScheduleModal isOpen={false} onClose={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders form when open', () => {
        render(<ScheduleModal isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('Create New Schedule')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter your schedule name')).toBeInTheDocument()
    })

    it('allows typing schedule name', () => {
        render(<ScheduleModal isOpen={true} onClose={vi.fn()} />)
        const input = screen.getByPlaceholderText('Enter your schedule name')
        fireEvent.change(input, { target: { value: 'Sunday Service' } })
        expect(input).toHaveValue('Sunday Service')
    })

    it('calls createSchedule and onClose on submit with name', () => {
        const onClose = vi.fn()
        render(<ScheduleModal isOpen={true} onClose={onClose} />)
        fireEvent.change(screen.getByPlaceholderText('Enter your schedule name'), { target: { value: 'Test Schedule' } })
        fireEvent.submit(screen.getByPlaceholderText('Enter your schedule name').closest('form')!)

        expect(createScheduleMock).toHaveBeenCalledWith('Test Schedule')
        expect(onClose).toHaveBeenCalled()
    })

    it('uses default name when input is empty', () => {
        const onClose = vi.fn()
        render(<ScheduleModal isOpen={true} onClose={onClose} />)
        fireEvent.submit(screen.getByPlaceholderText('Enter your schedule name').closest('form')!)

        expect(createScheduleMock).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when X button is clicked', () => {
        const onClose = vi.fn()
        render(<ScheduleModal isOpen={true} onClose={onClose} />)
        const closeBtn = screen.getByRole('button', { name: '' })
        fireEvent.click(closeBtn)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        render(<ScheduleModal isOpen={true} onClose={onClose} />)
        const backdrop = screen.getByText('Create New Schedule').closest('div')!.parentElement!.parentElement!
        fireEvent.click(backdrop)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
