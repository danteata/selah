import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SlideCard } from '../SlideCard'
import type { Slide } from '../../../types'

vi.mock('../../../hooks/useTemplates', () => ({
    useFileUrl: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../hooks/useLocalBackground', () => ({
    useLocalBackground: vi.fn().mockImplementation((bg: string) => bg || ''),
}))

const baseSlide: Slide = {
    id: 'slide-1',
    index: 0,
    name: 'Test Slide',
    type: 'text',
    layout: 'full-text',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['Hello World'],
}

const bibleSlide: Slide = {
    ...baseSlide,
    id: 'slide-bible',
    type: 'bible',
    contents: ['John 3:16', '<p>For God so loved the world</p>'],
}

function renderSlideCard(overrides: Partial<React.ComponentProps<typeof SlideCard>> = {}) {
    const defaults = {
        slide: baseSlide,
        onClick: vi.fn(),
        onDuplicate: vi.fn(),
        onDelete: vi.fn(),
    }
    return render(<SlideCard {...defaults} {...overrides} />)
}

describe('SlideCard', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders slide name', () => {
        renderSlideCard()
        expect(screen.getByText('Test Slide')).toBeInTheDocument()
    })

    it('renders slide content preview', () => {
        renderSlideCard()
        expect(screen.getByText('Hello World')).toBeInTheDocument()
    })

    it('renders slide index starting from 1', () => {
        renderSlideCard({ slide: { ...baseSlide, index: 4 } })
        expect(screen.getByText('#5')).toBeInTheDocument()
    })

    it('calls onClick when card is clicked', () => {
        const onClick = vi.fn()
        renderSlideCard({ onClick })
        fireEvent.click(screen.getByText('Test Slide').closest('[class*="rounded-xl"]')!)
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('calls onDuplicate when duplicate button is clicked', () => {
        const onDuplicate = vi.fn()
        renderSlideCard({ onDuplicate })
        const duplicateBtn = screen.getByTitle('Duplicate')
        fireEvent.click(duplicateBtn)
        expect(onDuplicate).toHaveBeenCalledTimes(1)
    })

    it('calls onDelete when delete button is clicked', () => {
        const onDelete = vi.fn()
        renderSlideCard({ onDelete })
        const deleteBtn = screen.getByTitle('Delete')
        fireEvent.click(deleteBtn)
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('does not propagate click when action buttons are clicked', () => {
        const onClick = vi.fn()
        const onDelete = vi.fn()
        renderSlideCard({ onClick, onDelete })
        fireEvent.click(screen.getByTitle('Delete'))
        expect(onDelete).toHaveBeenCalledTimes(1)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('shows LIVE badge when isLive is true', () => {
        renderSlideCard({ isLive: true })
        expect(screen.getByText('LIVE')).toBeInTheDocument()
    })

    it('does not show LIVE badge when isLive is false', () => {
        renderSlideCard({ isLive: false })
        expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    })

    it('shows Editing badge when lockedBy is set', () => {
        renderSlideCard({ lockedBy: 'user-2' })
        expect(screen.getByText('Editing')).toBeInTheDocument()
    })

    it('does not show Editing badge when lockedBy is not set', () => {
        renderSlideCard({ lockedBy: undefined })
        expect(screen.queryByText('Editing')).not.toBeInTheDocument()
    })

    it('shows Saved badge when isSaved is true', () => {
        renderSlideCard({ isSaved: true })
        expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    it('does not show Saved badge when isSaved is false', () => {
        renderSlideCard({ isSaved: false })
        expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    })

    it('shows selection checkbox when selectable is true', () => {
        const { container } = renderSlideCard({ selectable: true })
        expect(container.querySelector('[class*="rounded border-2"]')).toBeTruthy()
    })

    it('shows checkmark when selectable and isSelected are both true', () => {
        const { container } = renderSlideCard({ selectable: true, isSelected: true })
        expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('does not show checkmark when selectable but not isSelected', () => {
        renderSlideCard({ selectable: true, isSelected: false })
        expect(screen.queryByText('✓')).not.toBeInTheDocument()
    })

    it('shows edit button when onEdit is provided', () => {
        renderSlideCard({ onEdit: vi.fn() })
        expect(screen.getByTitle('Edit')).toBeInTheDocument()
    })

    it('does not show edit button when onEdit is not provided', () => {
        renderSlideCard({ onEdit: undefined })
        expect(screen.queryByTitle('Edit')).not.toBeInTheDocument()
    })

    it('calls onEdit when edit button is clicked', () => {
        const onEdit = vi.fn()
        renderSlideCard({ onEdit })
        fireEvent.click(screen.getByTitle('Edit'))
        expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('shows save to library button when onSaveToLibrary is provided', () => {
        renderSlideCard({ onSaveToLibrary: vi.fn() })
        expect(screen.getByTitle('Save to Library')).toBeInTheDocument()
    })

    it('shows "Already in Library" title when isSaved and onSaveToLibrary are both true', () => {
        renderSlideCard({ onSaveToLibrary: vi.fn(), isSaved: true })
        expect(screen.getByTitle('Already in Library')).toBeInTheDocument()
    })

    it('calls onSaveToLibrary when bookmark button is clicked', () => {
        const onSaveToLibrary = vi.fn()
        renderSlideCard({ onSaveToLibrary })
        fireEvent.click(screen.getByTitle('Save to Library'))
        expect(onSaveToLibrary).toHaveBeenCalledTimes(1)
    })

    it('shows Go Live button when onGoLive is provided and not live', () => {
        renderSlideCard({ onGoLive: vi.fn(), isLive: false })
        expect(screen.getByTitle('Send to Live')).toBeInTheDocument()
    })

    it('hides Go Live button when isLive is true', () => {
        renderSlideCard({ onGoLive: vi.fn(), isLive: true })
        expect(screen.queryByTitle('Send to Live')).not.toBeInTheDocument()
    })

    it('calls onGoLive when Go Live button is clicked', () => {
        const onGoLive = vi.fn()
        renderSlideCard({ onGoLive })
        fireEvent.click(screen.getByTitle('Send to Live'))
        expect(onGoLive).toHaveBeenCalledTimes(1)
    })

    it('does not propagate click when Go Live button is clicked', () => {
        const onClick = vi.fn()
        const onGoLive = vi.fn()
        renderSlideCard({ onClick, onGoLive })
        fireEvent.click(screen.getByTitle('Send to Live'))
        expect(onGoLive).toHaveBeenCalledTimes(1)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('shows Suggest to Queue button when onSuggestToQueue is provided', () => {
        renderSlideCard({ onSuggestToQueue: vi.fn() })
        expect(screen.getByTitle('Suggest to queue')).toBeInTheDocument()
    })

    it('calls onSuggestToQueue when suggest button is clicked', () => {
        const onSuggestToQueue = vi.fn()
        renderSlideCard({ onSuggestToQueue })
        fireEvent.click(screen.getByTitle('Suggest to queue'))
        expect(onSuggestToQueue).toHaveBeenCalledTimes(1)
    })

    it('renders bible slide content correctly', () => {
        renderSlideCard({ slide: bibleSlide })
        expect(screen.getByText('Test Slide')).toBeInTheDocument()
    })

    it('renders verse label and total when present', () => {
        const songSlide: Slide = {
            ...baseSlide,
            verseIndex: 0,
            totalVerses: 3,
            verseLabel: 'Verse',
        }
        renderSlideCard({ slide: songSlide })
        expect(screen.getByText('Verse (1/3)')).toBeInTheDocument()
    })

    it('renders verse label without count when totalVerses is 1', () => {
        const songSlide: Slide = {
            ...baseSlide,
            verseIndex: 0,
            totalVerses: 1,
            verseLabel: 'Chorus',
        }
        renderSlideCard({ slide: songSlide })
        expect(screen.getByText('Chorus')).toBeInTheDocument()
    })

    it('applies active border styling when isActive is true', () => {
        const { container } = renderSlideCard({ isActive: true })
        const card = container.firstChild as HTMLElement
        expect(card.className).toContain('border-[var(--accent-teal)]')
    })

    it('applies live border styling when isLive is true', () => {
        const { container } = renderSlideCard({ isLive: true })
        const card = container.firstChild as HTMLElement
        expect(card.className).toContain('border-red-500')
    })

    it('applies selected ring when isSelected is true', () => {
        const { container } = renderSlideCard({ isSelected: true })
        const card = container.firstChild as HTMLElement
        expect(card.className).toContain('ring-1')
    })

    it('applies sticky positioning when isStickyActive is true', () => {
        const { container } = renderSlideCard({ isStickyActive: true })
        const card = container.firstChild as HTMLElement
        expect(card.className).toContain('sticky')
        expect(card.className).toContain('z-10')
    })

    it('does not render empty content with <p></p>', () => {
        const emptySlide: Slide = {
            ...baseSlide,
            contents: ['<p></p>'],
        }
        const { container } = renderSlideCard({ slide: emptySlide })
        const tiptapPreviews = container.querySelectorAll('.tiptap-preview')
        expect(tiptapPreviews.length).toBe(0)
    })

    it('forwards ref correctly', () => {
        const ref = { current: null }
        render(<SlideCard ref={ref as any} slide={baseSlide} onClick={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />)
        expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })

    it('has displayName set', () => {
        expect(SlideCard.displayName).toBe('SlideCard')
    })
})
