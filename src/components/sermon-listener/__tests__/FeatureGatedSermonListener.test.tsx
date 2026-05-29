import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { FeatureGatedSermonListener } from '../FeatureGatedSermonListener'

vi.mock('../../services/feature-flags', () => ({
    featureFlags: {
        isEnabled: vi.fn().mockResolvedValue(true),
    },
}))

vi.mock('../SermonListenerPanel', () => ({
    SermonListenerPanel: (props: any) => <div data-testid="sermon-panel">Panel {props.compact ? 'compact' : ''}</div>,
}))

describe('FeatureGatedSermonListener', () => {
    it('renders nothing while loading', () => {
        const { container } = render(<FeatureGatedSermonListener />)
        expect(container.firstChild).toBeNull()
    })
})
