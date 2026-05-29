import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TipTapToolbar } from '../TipTapToolbar'

vi.mock('@tiptap/react', () => ({
    Editor: vi.fn(),
}))

describe('TipTapToolbar', () => {
    it('renders nothing when editor is null', () => {
        const { container } = render(<TipTapToolbar editor={null} />)
        expect(container.firstChild).toBeNull()
    })
})
