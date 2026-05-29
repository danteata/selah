import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MediaUpload } from '../MediaUpload'

vi.mock('../../utils/fileDialog', () => ({
    openFileDialog: vi.fn().mockResolvedValue(null),
}))

describe('MediaUpload', () => {
    it('renders drop zone with upload button', () => {
        const onUpload = vi.fn()
        render(<MediaUpload onUpload={onUpload} />)
        expect(screen.getByText('Drag & drop files here')).toBeInTheDocument()
        expect(screen.getByText('or click to browse')).toBeInTheDocument()
    })

    it('shows max file size and count limits', () => {
        const onUpload = vi.fn()
        render(<MediaUpload onUpload={onUpload} maxSize={10} maxFiles={5} />)
        expect(screen.getByText('Max 10MB per file • 5 files max')).toBeInTheDocument()
    })
})
