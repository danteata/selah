import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { StudioWorkspace } from '../StudioWorkspace'

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = { slideQueueWidth: 280, setSlideQueueWidth: vi.fn() }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../preview/PreviewContent', () => ({ PreviewContent: () => <div data-testid="preview">Preview</div> }))
vi.mock('../../live/LiveOutput', () => ({ LiveOutput: () => <div data-testid="live-output">Live</div> }))

describe('StudioWorkspace', () => {
    it('renders preview and live output areas', () => {
        render(<StudioWorkspace />)
        // PreviewContent and LiveOutput are mocked
    })

    it('applies slide queue width from store', () => {
        const { container } = render(<StudioWorkspace />)
        const queue = container.querySelector('.studio-slide-queue')
        expect(queue).toBeTruthy()
        expect(queue).toHaveAttribute('style', expect.stringContaining('280'))
    })

    it('renders resize handle', () => {
        const { container } = render(<StudioWorkspace />)
        const handle = container.querySelector('.cursor-col-resize')
        expect(handle).toBeTruthy()
    })
})
