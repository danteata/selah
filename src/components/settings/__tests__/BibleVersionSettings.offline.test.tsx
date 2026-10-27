import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Offline, Convex's stand-in answers every query with an empty list.
vi.mock('convex/react', () => ({ useConvex: vi.fn(() => ({})), useQuery: vi.fn(() => []) }))
vi.mock('../../../hooks/useScripture', () => ({
    useScripture: () => ({ downloadBibleVersion: vi.fn(), isVersionDownloaded: vi.fn(async (id: string) => id === 'KJV') }),
}))
vi.mock('../../../hooks/useEmbeddingStatus', () => ({
    useEmbeddingStatus: () => ({
        states: new Map(), checkAllStatuses: vi.fn(async () => {}), startSync: vi.fn(),
        upgradeToFragments: vi.fn(), clearEmbeddings: vi.fn(), isSyncing: false,
    }),
}))

import { BibleVersionSettings } from '../BibleVersionSettings'

describe('Bible versions with Convex unreachable', () => {
    it('lists the versions that come with Selah instead of loading forever', async () => {
        render(<BibleVersionSettings />)
        expect(await screen.findByText('NIV')).toBeInTheDocument()
        expect(screen.queryByText('Loading versions...')).not.toBeInTheDocument()
        expect(await screen.findByRole('option', { name: /KJV/ })).toBeInTheDocument()
    })
})
