import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QuickBibleBar } from '../QuickBibleBar'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            quickBibleBarOpen: false,
            setQuickBibleBarOpen: vi.fn(),
            appendActiveSlide: vi.fn(),
            setLiveSlide: vi.fn(),
            setActiveNavSection: vi.fn(),
            setContextPanelOpen: vi.fn(),
            setBiblePanelQuery: vi.fn(),
            settings: {
                defaultBibleVersion: 'KJV',
            },
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../../hooks', () => ({
    useScripture: vi.fn(() => ({
        fetchScripture: vi.fn().mockResolvedValue(null),
    })),
    useSlideCreation: vi.fn(() => ({
        createBibleSlide: vi.fn(),
    })),
    useSemanticVerseSearch: vi.fn(() => ({
        results: [],
        isSearching: false,
        hasEmbeddings: false,
        search: vi.fn(),
        clearResults: vi.fn(),
    })),
    useLiveSession: vi.fn(() => ({
        setLiveSlide: vi.fn(),
        isConnected: false,
        isOperator: false,
        isOpen: false,
    })),
    useVerseNavigationShortcuts: vi.fn(),
}))

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children }: any) => <div>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('QuickBibleBar', () => {
    it('renders without crashing', () => {
        render(<QuickBibleBar />)
    })
})
