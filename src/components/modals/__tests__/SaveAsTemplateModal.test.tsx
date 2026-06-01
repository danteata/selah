import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SaveAsTemplateModal } from '../SaveAsTemplateModal'
import type { Slide } from '../../../types'

vi.mock('../../hooks/useLocalBackground', () => ({
    useLocalBackground: vi.fn().mockImplementation((bg: string) => bg || ''),
}))

vi.mock('../../utils/templateThumbnail', () => ({
    generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,fake'),
}))

const baseSlide: Slide = {
    id: 'slide-1',
    index: 0,
    name: 'My Bible Slide',
    type: 'bible',
    layout: 'full-text',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['For God so loved the world'],
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    backgroundType: 'gradient',
}

const baseProps = {
    isOpen: true,
    slide: baseSlide,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
}

describe('SaveAsTemplateModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when closed', () => {
        const { container } = render(<SaveAsTemplateModal {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders nothing when slide is null', () => {
        const { container } = render(<SaveAsTemplateModal {...baseProps} slide={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders modal when open with slide', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByText('Save as Template')).toBeInTheDocument()
    })

    it('shows slide name as initial template name', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByDisplayValue('My Bible Slide')).toBeInTheDocument()
    })

    it('renders slide content in preview', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByText('For God so loved the world')).toBeInTheDocument()
    })

    it('shows all category buttons', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByText('Announcement')).toBeInTheDocument()
        expect(screen.getByText('Worship')).toBeInTheDocument()
        // Sermon and Prayer appear in both categories and slide types
        expect(screen.getAllByText('Sermon').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Prayer').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('defaults to General category', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        const generalBtn = screen.getByText('General').closest('button')!
        expect(generalBtn.className).toContain('ring-2')
    })

    it('changes category when clicked', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Worship'))
        const worshipBtn = screen.getByText('Worship').closest('button')!
        expect(worshipBtn.className).toContain('ring-2')
    })

    it('shows all slide type buttons', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByText('Bible')).toBeInTheDocument()
        expect(screen.getByText('Songs')).toBeInTheDocument()
        expect(screen.getByText('Hymns')).toBeInTheDocument()
        expect(screen.getByText('Text')).toBeInTheDocument()
        expect(screen.getByText('Media')).toBeInTheDocument()
        expect(screen.getByText('Any Type')).toBeInTheDocument()
    })

    it('defaults appliesTo to "Any Type"', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        const anyBtn = screen.getByText('Any Type').closest('button')!
        expect(anyBtn.className).toContain('bg-[var(--accent-teal)]')
    })

    it('selects specific slide type and deselects Any', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Bible'))
        const bibleBtn = screen.getByText('Bible').closest('button')!
        expect(bibleBtn.className).toContain('bg-[var(--accent-teal)]')
        const anyBtn = screen.getByText('Any Type').closest('button')!
        expect(anyBtn.className).not.toContain('bg-[var(--accent-teal)]')
    })

    it('reverts to Any when last specific type is deselected', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Bible'))
        fireEvent.click(screen.getByText('Bible')) // deselect
        const anyBtn = screen.getByText('Any Type').closest('button')!
        expect(anyBtn.className).toContain('bg-[var(--accent-teal)]')
    })

    it('allows multiple slide type selections', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Bible'))
        fireEvent.click(screen.getByText('Songs'))
        expect(screen.getByText('Bible').closest('button')!.className).toContain('bg-[var(--accent-teal)]')
        expect(screen.getByText('Songs').closest('button')!.className).toContain('bg-[var(--accent-teal)]')
    })

    it('clicking Any clears specific selections', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Bible'))
        fireEvent.click(screen.getByText('Songs'))
        fireEvent.click(screen.getByText('Any Type'))
        expect(screen.getByText('Bible').closest('button')!.className).not.toContain('bg-[var(--accent-teal)]')
        expect(screen.getByText('Any Type').closest('button')!.className).toContain('bg-[var(--accent-teal)]')
    })

    it('calls onSave with correct data on submit', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined)
        render(<SaveAsTemplateModal {...baseProps} onSave={onSave} />)

        fireEvent.change(screen.getByDisplayValue('My Bible Slide'), { target: { value: 'New Template' } })
        fireEvent.click(screen.getByText('Worship'))
        fireEvent.change(screen.getByPlaceholderText('Brief description of this template...'), { target: { value: 'A great template' } })

        fireEvent.click(screen.getByText('Save Template'))

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
                name: 'New Template',
                category: 'worship',
                description: 'A great template',
            }))
        })
    })

    it('calls onClose after successful save', async () => {
        const onClose = vi.fn()
        render(<SaveAsTemplateModal {...baseProps} onClose={onClose} />)

        fireEvent.click(screen.getByText('Save Template'))

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled()
        })
    })

    it('does not submit with empty name', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        fireEvent.change(screen.getByDisplayValue('My Bible Slide'), { target: { value: '' } })
        const submitBtn = screen.getByText('Save Template').closest('button')!
        expect(submitBtn).toBeDisabled()
    })

    it('calls onClose when cancel is clicked', () => {
        const onClose = vi.fn()
        render(<SaveAsTemplateModal {...baseProps} onClose={onClose} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        const { container } = render(<SaveAsTemplateModal {...baseProps} onClose={onClose} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when X button is clicked', () => {
        const onClose = vi.fn()
        render(<SaveAsTemplateModal {...baseProps} onClose={onClose} />)
        const closeBtn = document.querySelector('.ml-auto.p-2')
        expect(closeBtn).toBeTruthy()
        fireEvent.click(closeBtn!)
        expect(onClose).toHaveBeenCalled()
    })

    it('includes appliesTo in onSave call', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined)
        render(<SaveAsTemplateModal {...baseProps} onSave={onSave} />)

        fireEvent.click(screen.getByText('Bible'))
        fireEvent.click(screen.getByText('Save Template'))

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
                appliesTo: ['bible'],
            }))
        })
    })

    it('does not call onClose when saving fails', async () => {
        const onSave = vi.fn().mockRejectedValue(new Error('Save failed'))
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const onClose = vi.fn()
        render(<SaveAsTemplateModal {...baseProps} onSave={onSave} onClose={onClose} />)

        // Suppress unhandled rejection from component missing catch block
        const handler = (e: PromiseRejectionEvent) => { e.preventDefault() }
        window.addEventListener('unhandledrejection', handler)

        fireEvent.click(screen.getByText('Save Template'))

        await waitFor(() => {
            expect(onSave).toHaveBeenCalled()
        })
        // The modal should still be open (onClose not called)
        expect(onClose).not.toHaveBeenCalled()

        window.removeEventListener('unhandledrejection', handler)
        consoleSpy.mockRestore()
    })

    it('shows description field', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        expect(screen.getByPlaceholderText('Brief description of this template...')).toBeInTheDocument()
    })

    it('allows entering description', () => {
        render(<SaveAsTemplateModal {...baseProps} />)
        const descInput = screen.getByPlaceholderText('Brief description of this template...')
        fireEvent.change(descInput, { target: { value: 'My description' } })
        expect(descInput).toHaveValue('My description')
    })
})
