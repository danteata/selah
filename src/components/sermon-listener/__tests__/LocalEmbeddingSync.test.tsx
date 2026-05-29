import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { LocalEmbeddingSync } from '../LocalEmbeddingSync'

vi.mock('convex/react', () => ({
    useConvex: vi.fn(() => ({})),
    useQuery: vi.fn(() => []),
}))

vi.mock('../../hooks/useEmbeddingStatus', () => ({
    useEmbeddingStatus: vi.fn(() => ({
        states: new Map(),
        checkAllStatuses: vi.fn(),
        startSync: vi.fn(),
        upgradeToFragments: vi.fn(),
        clearEmbeddings: vi.fn(),
        isSyncing: false,
        modelLoading: false,
        modelReady: false,
    })),
}))

vi.mock('../../services/sermon-listener/localEmbeddings', () => ({
    isEmbedderReady: vi.fn(() => false),
}))

describe('LocalEmbeddingSync', () => {
    it('renders without crashing', () => {
        render(<LocalEmbeddingSync />)
    })
})
