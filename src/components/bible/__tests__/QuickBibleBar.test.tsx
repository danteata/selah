import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QuickBibleBar } from '../QuickBibleBar'

/**
 * Mocked hook return values are hoisted so each hook hands back the SAME object
 * (and the same callbacks) on every render.
 *
 * This is not a tidiness point. Building the return value inside the mock
 * factory hands the component a fresh `clearResults` identity on every render,
 * and one of QuickBibleBar's effects depends on it while calling
 * `setNeighboringVerses({ prev: [], next: [] })` — a fresh object, so a
 * guaranteed state change. Unstable dep plus state write is an infinite render
 * loop, and because every iteration allocates new objects and new `vi.fn()`
 * call records, this file exhausted the 4 GB fork heap and took the entire
 * `vitest run` down with it rather than failing as one test.
 *
 * The real hooks are stable — `useSemanticVerseSearch` returns
 * `useCallback(..., [])` for `clearResults` — so only the mock was ever wrong.
 */
const h = vi.hoisted(() => ({
    scripture: { fetchScripture: vi.fn().mockResolvedValue(null) },
    slideCreation: { createBibleSlide: vi.fn() },
    semantic: {
        results: [] as unknown[],
        isSearching: false,
        hasEmbeddings: false,
        search: vi.fn(),
        clearResults: vi.fn(),
    },
    liveSession: {
        setLiveSlide: vi.fn(),
        isConnected: false,
        isOperator: false,
        isOpen: false,
    },
}))

vi.mock('../../../hooks', () => ({
    useScripture: vi.fn(() => h.scripture),
    useSlideCreation: vi.fn(() => h.slideCreation),
    useSemanticVerseSearch: vi.fn(() => h.semantic),
    useLiveSession: vi.fn(() => h.liveSession),
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
