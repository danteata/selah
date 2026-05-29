import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ScheduleSelector } from '../ScheduleSelector'

vi.mock('../../../hooks/useSchedules', () => ({
    useSchedules: vi.fn(() => ({
        schedules: [],
        activeSchedule: null,
        createSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        setActiveSchedule: vi.fn(),
        isLoading: false,
    })),
}))

describe('ScheduleSelector', () => {
    it('renders schedule selector without crashing', () => {
        render(<ScheduleSelector />)
        // Component renders with mocked data
    })
})
