import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlideChip } from '../SlideChip'

describe('SlideChip', () => {
    it('renders bible chip correctly', () => {
        render(<SlideChip slideType="bible" />)
        expect(screen.getByText('Bible')).toBeInTheDocument()
    })

    it('renders hymn chip correctly', () => {
        render(<SlideChip slideType="hymn" />)
        expect(screen.getByText('Hymn')).toBeInTheDocument()
    })

    it('renders song chip correctly', () => {
        render(<SlideChip slideType="song" />)
        expect(screen.getByText('Song')).toBeInTheDocument()
    })

    it('renders text chip correctly', () => {
        render(<SlideChip slideType="text" />)
        expect(screen.getByText('Text')).toBeInTheDocument()
    })

    it('renders media chip correctly', () => {
        render(<SlideChip slideType="media" />)
        expect(screen.getByText('Media')).toBeInTheDocument()
    })

    it('renders countdown chip correctly', () => {
        render(<SlideChip slideType="countdown" />)
        expect(screen.getByText('Timer')).toBeInTheDocument()
    })

    it('applies custom className', () => {
        const { container } = render(<SlideChip slideType="bible" className="custom-class" />)
        expect(container.firstChild).toHaveClass('custom-class')
    })

    it('falls back to text for unknown type', () => {
        render(<SlideChip slideType="unknown" />)
        expect(screen.getByText('Text')).toBeInTheDocument()
    })
})
