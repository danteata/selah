import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickActions } from '../QuickActions'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            quickActionsPage: '',
            setQuickActionsPage: vi.fn(),
            openModal: vi.fn(),
            appendActiveSlide: vi.fn(),
            setEditingSlide: vi.fn(),
            activeSchedule: null,
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../../hooks', () => ({
    useHymn: vi.fn(() => ({
        getAllHymns: vi.fn().mockResolvedValue([]),
        getHymnByNumber: vi.fn().mockResolvedValue(null),
    })),
    useScripture: vi.fn(() => ({
        fetchScripture: vi.fn().mockResolvedValue(null),
    })),
    useSlideCreation: vi.fn(() => ({
        createBibleSlide: vi.fn(),
        createHymnSlides: vi.fn(),
    })),
}))

vi.mock('./ActionCard', () => ({ ActionCard: () => <div data-testid="action-card">ActionCard</div> }))
vi.mock('../slides/SlideChip', () => ({ SlideChip: () => <div data-testid="slide-chip">SlideChip</div> }))
vi.mock('../bible/BibleList', () => ({ BibleList: () => <div data-testid="bible-list">BibleList</div> }))
vi.mock('../hymns/HymnList', () => ({ HymnList: () => <div data-testid="hymn-list">HymnList</div> }))
vi.mock('../songs/SongList', () => ({ SongList: () => <div data-testid="song-list">SongList</div> }))

describe('QuickActions', () => {
    it('renders search input', () => {
        render(<QuickActions />)
        expect(screen.getByPlaceholderText('Search actions, scripture, hymns...')).toBeInTheDocument()
    })

    it('updates search query on input', () => {
        render(<QuickActions />)
        const input = screen.getByPlaceholderText('Search actions, scripture, hymns...')
        fireEvent.change(input, { target: { value: 'test' } })
        expect(input).toHaveValue('test')
    })

    it('shows clear button when input has value', () => {
        render(<QuickActions />)
        const input = screen.getByPlaceholderText('Search actions, scripture, hymns...')
        fireEvent.change(input, { target: { value: 'test' } })
        expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('clears search when X button clicked', () => {
        render(<QuickActions />)
        const input = screen.getByPlaceholderText('Search actions, scripture, hymns...')
        fireEvent.change(input, { target: { value: 'test' } })
        const clearBtn = screen.getByRole('button')
        fireEvent.click(clearBtn)
        expect(input).toHaveValue('')
    })
})
