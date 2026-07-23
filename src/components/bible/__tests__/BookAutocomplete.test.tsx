import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BookAutocomplete } from '../BookAutocomplete'
import type { RankedBookSuggestion } from '../../../utils/bibleReference'

// No matchIndexes here: `Highlighted` renders plain text so getByText works.
const suggestions: RankedBookSuggestion[] = [
    { book: 'John', bookIndex: 43, matchType: 'prefix', abbrev: 'jn' },
    { book: 'Jonah', bookIndex: 32, matchType: 'prefix', abbrev: 'jon' },
    { book: 'Job', bookIndex: 18, matchType: 'prefix', abbrev: 'job' },
]

describe('BookAutocomplete', () => {
    it('renders nothing when there are no suggestions', () => {
        const { container } = render(
            <BookAutocomplete suggestions={[]} activeIndex={0} onSelect={vi.fn()} />,
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders each suggestion as an option', () => {
        render(<BookAutocomplete suggestions={suggestions} activeIndex={0} onSelect={vi.fn()} />)
        expect(screen.getByText('John')).toBeInTheDocument()
        expect(screen.getByText('Jonah')).toBeInTheDocument()
        expect(screen.getByText('Job')).toBeInTheDocument()
    })

    it('marks the active option with aria-selected', () => {
        render(<BookAutocomplete suggestions={suggestions} activeIndex={1} onSelect={vi.fn()} />)
        const options = screen.getAllByRole('option')
        expect(options[1]).toHaveAttribute('aria-selected', 'true')
        expect(options[0]).toHaveAttribute('aria-selected', 'false')
    })

    it('calls onSelect with book index + name on mousedown', () => {
        const onSelect = vi.fn()
        render(<BookAutocomplete suggestions={suggestions} activeIndex={0} onSelect={onSelect} />)
        fireEvent.mouseDown(screen.getByText('Jonah'))
        expect(onSelect).toHaveBeenCalledWith(32, 'Jonah')
    })

    it('reports hover through onHoverIndex', () => {
        const onHoverIndex = vi.fn()
        render(<BookAutocomplete suggestions={suggestions} activeIndex={0} onSelect={vi.fn()} onHoverIndex={onHoverIndex} />)
        fireEvent.mouseEnter(screen.getByText('Job'))
        expect(onHoverIndex).toHaveBeenCalledWith(2)
    })

    it('highlights matched characters when matchIndexes are given', () => {
        const highlighted: RankedBookSuggestion[] = [
            { book: 'John', bookIndex: 43, matchType: 'prefix', matchIndexes: [0, 1] },
        ]
        const { container } = render(
            <BookAutocomplete suggestions={highlighted} activeIndex={0} onSelect={vi.fn()} />,
        )
        // The whole word is still present, and the first two chars are emphasized.
        expect(container.textContent).toContain('John')
        const option = screen.getByRole('option')
        const emphasized = option.querySelectorAll('span.font-semibold')
        expect(emphasized.length).toBe(2)
        expect(Array.from(emphasized).map(e => e.textContent).join('')).toBe('Jo')
    })
})
