import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplateSelector } from '../TemplateSelector'

const mockTemplates = [
    { _id: 't1', name: 'Classic', category: 'general' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' },
    { _id: 't2', name: 'Modern', category: 'worship' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' },
    { _id: 't3', name: 'Bold', category: 'sermon' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' },
    { _id: 't4', name: 'Minimal', category: 'general' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' },
    { _id: 't5', name: 'Elegant', category: 'prayer' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' },
]

let mockReturnValue = {
    getTemplatesForSlideType: vi.fn().mockReturnValue(mockTemplates),
    isLoading: false,
}

// Only the hook is stubbed; the shared category table and its lookup come from
// the real module, so this mock can't go stale as that module grows.
vi.mock('../../../hooks/useTemplates', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/useTemplates')>()),
    useTemplates: vi.fn(() => mockReturnValue),
}))

describe('TemplateSelector', () => {
    beforeEach(() => {
        mockReturnValue = {
            getTemplatesForSlideType: vi.fn().mockReturnValue(mockTemplates),
            isLoading: false,
        }
    })

    it('renders nothing when no templates and not loading', () => {
        mockReturnValue.getTemplatesForSlideType.mockReturnValue([])
        const { container } = render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders template buttons', () => {
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} />
        )
        expect(screen.getByText('Classic')).toBeInTheDocument()
        expect(screen.getByText('Modern')).toBeInTheDocument()
    })

    it('shows only maxVisible templates by default', () => {
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} maxVisible={3} />
        )
        expect(screen.getByText('Classic')).toBeInTheDocument()
        expect(screen.getByText('Modern')).toBeInTheDocument()
        expect(screen.getByText('Bold')).toBeInTheDocument()
        expect(screen.queryByText('Minimal')).not.toBeInTheDocument()
        expect(screen.getByText('+2')).toBeInTheDocument()
    })

    it('expands to show all templates when "+N" clicked', () => {
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} maxVisible={3} />
        )
        fireEvent.click(screen.getByText('+2'))
        expect(screen.getByText('Minimal')).toBeInTheDocument()
        expect(screen.getByText('Elegant')).toBeInTheDocument()
    })

    it('calls onSelect with template when clicked', () => {
        const onSelect = vi.fn()
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={onSelect} />
        )
        fireEvent.click(screen.getByText('Classic'))
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Classic' }))
    })

    it('calls onSelect with null when selected template is clicked again', () => {
        const onSelect = vi.fn()
        const selected = { _id: 't1', name: 'Classic', category: 'general' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' }
        render(
            <TemplateSelector slideType="bible" selectedTemplate={selected} onSelect={onSelect} />
        )
        fireEvent.click(screen.getByText('Classic'))
        expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('shows clear button when template is selected', () => {
        const selected = { _id: 't1', name: 'Classic', category: 'general' as const, slideType: 'bible' as const, createdAt: '', slideId: '', updatedAt: '' }
        render(
            <TemplateSelector slideType="bible" selectedTemplate={selected} onSelect={vi.fn()} />
        )
        const clearBtn = screen.getByTitle('Clear template')
        expect(clearBtn).toBeInTheDocument()
    })

    it('does not show clear button when no template selected', () => {
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} />
        )
        expect(screen.queryByTitle('Clear template')).not.toBeInTheDocument()
    })

    it('shows loading skeletons when isLoading', () => {
        mockReturnValue.getTemplatesForSlideType.mockReturnValue([])
        mockReturnValue.isLoading = true
        render(
            <TemplateSelector slideType="bible" selectedTemplate={null} onSelect={vi.fn()} />
        )
        expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    })
})
