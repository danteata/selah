import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { BibleVersionSettings } from '../BibleVersionSettings'

vi.mock('convex/react', () => ({
    useConvex: vi.fn(() => ({})),
    useQuery: vi.fn(() => []),
}))

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            bibleVersions: [],
            settings: {
                defaultBibleVersion: 'KJV',
            },
            setDefaultBibleVersion: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../hooks/useScripture', () => ({
    useScripture: vi.fn(() => ({
        downloadBibleVersion: vi.fn(),
        isVersionDownloaded: vi.fn().mockResolvedValue(false),
    })),
}))

vi.mock('../../hooks/useEmbeddingStatus', () => ({
    useEmbeddingStatus: vi.fn(() => ({
        states: new Map(),
        checkAllStatuses: vi.fn(),
        startSync: vi.fn(),
        upgradeToFragments: vi.fn(),
        clearEmbeddings: vi.fn(),
        isSyncing: false,
    })),
}))

describe('BibleVersionSettings', () => {
    it('renders without crashing', () => {
        render(<BibleVersionSettings />)
    })
})
