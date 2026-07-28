import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandBar } from '../CommandBar'

const setActiveNavSection = vi.fn()
const setCommandBarOpen = vi.fn()
const setLiveSlide = vi.fn()

let commandBarOpen = true

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: (state: unknown) => unknown) => {
        const state = {
            commandBarOpen,
            setCommandBarOpen,
            setActiveNavSection,
            setLiveSlide,
            activeSlides: [],
            liveSlideId: null,
            activeSchedule: null,
        }
        return selector ? selector(state) : state
    }),
}))

/** Rows are buttons; their accessible name starts with the command title. */
function rowTitles(): string[] {
    return screen.getAllByRole('button')
        .map((button) => button.querySelector('.font-bold')?.textContent ?? '')
        .filter(Boolean)
}

function selectedTitle(): string | undefined {
    const selected = screen.getAllByRole('button')
        .find((button) => button.className.includes('accent-teal'))
    return selected?.querySelector('.font-bold')?.textContent ?? undefined
}

describe('CommandBar', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        commandBarOpen = true
    })

    it('offers the dictionary as a command', () => {
        render(<CommandBar />)
        expect(rowTitles()).toContain('Define a Word')
    })

    it('opens the dictionary section when the command is clicked', () => {
        render(<CommandBar />)

        fireEvent.click(screen.getByText('Define a Word'))

        expect(setActiveNavSection).toHaveBeenCalledWith('dictionary')
        expect(setCommandBarOpen).toHaveBeenCalledWith(false)
    })

    describe('keyboard navigation', () => {
        it('moves the selection with the arrow keys', () => {
            render(<CommandBar />)
            const first = rowTitles()[0]

            fireEvent.keyDown(window, { key: 'ArrowDown' })
            expect(selectedTitle()).toBe(rowTitles()[1])

            fireEvent.keyDown(window, { key: 'ArrowUp' })
            expect(selectedTitle()).toBe(first)
        })

        it('wraps around at both ends', () => {
            render(<CommandBar />)
            const titles = rowTitles()

            // Up from the first row lands on the last.
            fireEvent.keyDown(window, { key: 'ArrowUp' })
            expect(selectedTitle()).toBe(titles[titles.length - 1])

            fireEvent.keyDown(window, { key: 'ArrowDown' })
            expect(selectedTitle()).toBe(titles[0])
        })

        it('jumps to the ends with Home and End', () => {
            render(<CommandBar />)
            const titles = rowTitles()

            fireEvent.keyDown(window, { key: 'End' })
            expect(selectedTitle()).toBe(titles[titles.length - 1])

            fireEvent.keyDown(window, { key: 'Home' })
            expect(selectedTitle()).toBe(titles[0])
        })

        it('runs the selected command on Enter', () => {
            render(<CommandBar />)

            // Second row is Search Songs, right after Search Bible.
            fireEvent.keyDown(window, { key: 'ArrowDown' })
            fireEvent.keyDown(window, { key: 'Enter' })

            expect(setActiveNavSection).toHaveBeenCalledWith('music')
        })

        it('runs the right command after the query narrows the list', () => {
            // The regression: selecting a row, then typing, used to leave the
            // index pointing past the end of the filtered list — Enter did
            // nothing while clicking still worked.
            render(<CommandBar />)

            fireEvent.keyDown(window, { key: 'End' })
            fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'define' } })

            expect(rowTitles()).toEqual(['Define a Word'])
            fireEvent.keyDown(window, { key: 'Enter' })

            expect(setActiveNavSection).toHaveBeenCalledWith('dictionary')
        })

        it('keeps a row highlighted after the list narrows', () => {
            render(<CommandBar />)

            fireEvent.keyDown(window, { key: 'End' })
            fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'define' } })

            expect(selectedTitle()).toBe('Define a Word')
        })

        it('does nothing on Enter when the query matches no command', () => {
            render(<CommandBar />)

            fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'zzzzz' } })
            fireEvent.keyDown(window, { key: 'Enter' })

            expect(setActiveNavSection).not.toHaveBeenCalled()
            expect(setLiveSlide).not.toHaveBeenCalled()
        })

        it('works when focus is not in the search box', () => {
            render(<CommandBar />)
            // Mouse over a row (which is what took focus off the input before).
            fireEvent.mouseEnter(screen.getByText('Search Songs').closest('button')!)

            fireEvent.keyDown(window, { key: 'Enter' })

            expect(setActiveNavSection).toHaveBeenCalledWith('music')
        })

        it('ignores navigation keys while closed, so the slide queue keeps them', () => {
            commandBarOpen = false
            render(<CommandBar />)

            fireEvent.keyDown(window, { key: 'ArrowDown' })
            fireEvent.keyDown(window, { key: 'Enter' })

            expect(setActiveNavSection).not.toHaveBeenCalled()
        })
    })
})
