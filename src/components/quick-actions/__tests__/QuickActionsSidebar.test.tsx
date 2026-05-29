import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QuickActionsSidebar } from '../QuickActionsSidebar'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            quickActionsPage: '',
            setQuickActionsPage: vi.fn(),
            openModal: vi.fn(),
            appendActiveSlide: vi.fn(),
            setEditingSlide: vi.fn(),
            setLiveSlide: vi.fn(),
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
    useSemanticVerseSearch: vi.fn(() => ({
        results: [],
        isSearching: false,
        hasEmbeddings: false,
        isEmbedderReady: false,
        search: vi.fn(),
        clearResults: vi.fn(),
        initEmbedder: vi.fn(),
    })),
}))

vi.mock('../slides/SlideChip', () => ({ SlideChip: () => <div data-testid="slide-chip">SlideChip</div> }))
vi.mock('../bible/BibleList', () => ({ BibleList: () => <div data-testid="bible-list">BibleList</div> }))
vi.mock('../hymns/HymnList', () => ({ HymnList: () => <div data-testid="hymn-list">HymnList</div> }))
vi.mock('../songs/SongList', () => ({ SongList: () => <div data-testid="song-list">SongList</div> }))

describe('QuickActionsSidebar', () => {
    it('renders without crashing', () => {
        render(<QuickActionsSidebar />)
    })
})
