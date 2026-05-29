import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { EmbeddingSyncIndicator } from '../EmbeddingSyncIndicator'

vi.mock('../../services/sermon-listener/embeddingSyncManager', () => ({
    embeddingSyncManager: {
        subscribe: vi.fn(() => vi.fn()),
    },
}))

describe('EmbeddingSyncIndicator', () => {
    it('renders nothing when no sync is active', () => {
        const { container } = render(<EmbeddingSyncIndicator />)
        expect(container.firstChild).toBeNull()
    })
})
