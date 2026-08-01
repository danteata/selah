import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateTemplateModal } from '../CreateTemplateModal'
import type { TemplateItem } from '../../../hooks/useTemplates'

const mockCreateTemplate = vi.fn()
const mockUpdateTemplate = vi.fn()
const mockGenerateUploadUrl = vi.fn()

// Only the hook is stubbed; everything else — notably the shared
// TEMPLATE_SLIDE_TYPE_OPTIONS list the modal renders its chips from — comes from
// the real module. Enumerating the exports by hand means the mock silently
// breaks the moment the module grows one.
vi.mock('../../../hooks/useTemplates', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/useTemplates')>()),
    useTemplates: () => ({
        createTemplate: mockCreateTemplate,
        updateTemplate: mockUpdateTemplate,
        generateUploadUrl: mockGenerateUploadUrl,
    }),
}))

vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isOffline: false }),
}))

vi.mock('../../../hooks/useLocalBackground', () => ({
    useLocalBackground: vi.fn().mockImplementation((bg: string) => bg || ''),
}))

vi.mock('../../../utils/templateThumbnail', () => ({
    generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,fake'),
}))

vi.mock('../../../platform', () => ({
    isDesktop: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../utils/fileDialog', () => ({
    openFileDialog: vi.fn().mockResolvedValue([]),
}))

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
}

describe('CreateTemplateModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCreateTemplate.mockResolvedValue(undefined)
        mockUpdateTemplate.mockResolvedValue(undefined)
    })

    it('renders nothing when closed', () => {
        const { container } = render(<CreateTemplateModal {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders create form when open', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Create Custom Template')).toBeInTheDocument()
    })

    it('renders template name input', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByPlaceholderText('My Template')).toBeInTheDocument()
    })

    it('renders default content input', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByPlaceholderText('Enter default text for this template...')).toBeInTheDocument()
    })

    it('renders description textarea', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByPlaceholderText('Brief description of this template...')).toBeInTheDocument()
    })

    it('shows background type buttons', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Image')).toBeInTheDocument()
        expect(screen.getByText('Video')).toBeInTheDocument()
        expect(screen.getByText('Gradient')).toBeInTheDocument()
        expect(screen.getByText('Color')).toBeInTheDocument()
    })

    it('defaults to image background type', () => {
        render(<CreateTemplateModal {...baseProps} />)
        const imageBtn = screen.getByText('Image').closest('button')!
        expect(imageBtn.className).toContain('ring-2')
    })

    it('switches to gradient background type', () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Gradient'))
        const gradientBtn = screen.getByText('Gradient').closest('button')!
        expect(gradientBtn.className).toContain('ring-2')
    })

    it('shows gradient presets section when gradient type is selected', async () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Gradient'))
        await waitFor(() => {
            expect(screen.getByText('Gradient Preset')).toBeInTheDocument()
        }, { timeout: 5000 })
        // NOTE: Gradient preset buttons contain only a colored div, no text labels.
        // This is a real accessibility issue — screen readers cannot identify the presets.
        const presetGrid = document.querySelector('.grid.grid-cols-3')
        expect(presetGrid).toBeTruthy()
        expect(presetGrid!.children.length).toBe(6)
    })

    it('switches to color background type and shows color picker', async () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Color'))
        await waitFor(() => {
            // Both color input and text input show #667eea
            const colorInputs = screen.getAllByDisplayValue('#667eea')
            expect(colorInputs.length).toBeGreaterThanOrEqual(1)
        })
    })

    it('shows all category buttons', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Announcement')).toBeInTheDocument()
        expect(screen.getByText('Worship')).toBeInTheDocument()
        expect(screen.getByText('Sermon')).toBeInTheDocument()
        expect(screen.getByText('Prayer')).toBeInTheDocument()
        expect(screen.getByText('General')).toBeInTheDocument()
    })

    it('defaults to General category', () => {
        render(<CreateTemplateModal {...baseProps} />)
        // Find the General category button and check if it's selected
        const generalBtns = screen.getAllByText('General')
        const catBtn = generalBtns.find(btn => btn.closest('button')?.className.includes('ring-2'))
        expect(catBtn).toBeTruthy()
    })

    it('shows slide type buttons for appliesTo', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Bible Verses')).toBeInTheDocument()
        expect(screen.getByText('Songs')).toBeInTheDocument()
        expect(screen.getByText('Hymns')).toBeInTheDocument()
        expect(screen.getByText('Text Slides')).toBeInTheDocument()
    })

    it('defaults appliesTo to Any Type', () => {
        render(<CreateTemplateModal {...baseProps} />)
        const anyBtn = screen.getByText('Any Type').closest('button')!
        expect(anyBtn.className).toContain('bg-[var(--accent-teal)]')
    })

    it('submit button is disabled when name is empty', () => {
        render(<CreateTemplateModal {...baseProps} />)
        const submitBtn = screen.getByText('Create Template').closest('button')!
        expect(submitBtn).toBeDisabled()
    })

    it('enables submit button when name is entered', () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('My Template'), { target: { value: 'My Template' } })
        const submitBtn = screen.getByText('Create Template').closest('button')!
        expect(submitBtn).not.toBeDisabled()
    })

    it('calls createTemplate on valid submit', async () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('My Template'), { target: { value: 'Test Template' } })
        fireEvent.change(screen.getByPlaceholderText('Enter default text for this template...'), { target: { value: 'Hello' } })

        fireEvent.click(screen.getByText('Create Template').closest('button')!)

        await waitFor(() => {
            expect(mockCreateTemplate).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Test Template',
            }))
        })
    })

    it('calls onClose after successful creation', async () => {
        const onClose = vi.fn()
        render(<CreateTemplateModal {...baseProps} onClose={onClose} />)
        fireEvent.change(screen.getByPlaceholderText('My Template'), { target: { value: 'Test' } })

        fireEvent.click(screen.getByText('Create Template').closest('button')!)

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled()
        })
    })

    it('calls onClose when cancel is clicked', () => {
        const onClose = vi.fn()
        render(<CreateTemplateModal {...baseProps} onClose={onClose} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(onClose).toHaveBeenCalled()
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        const { container } = render(<CreateTemplateModal {...baseProps} onClose={onClose} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalled()
    })

    it('shows edit form when editingTemplate is provided', () => {
        const template: Partial<TemplateItem> = {
            _id: 'tpl-1',
            name: 'Existing Template',
            category: 'worship',
            description: 'Old description',
            slideId: JSON.stringify({
                contents: ['Old content'],
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                backgroundType: 'gradient',
            }),
        }
        render(<CreateTemplateModal {...baseProps} editingTemplate={template as TemplateItem} />)
        expect(screen.getByText('Edit Template')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Existing Template')).toBeInTheDocument()
    })

    it('populates form from editing template', () => {
        const template: Partial<TemplateItem> = {
            _id: 'tpl-1',
            name: 'My Template',
            category: 'prayer',
            description: 'A prayer template',
            appliesTo: ['bible', 'song'],
            slideId: JSON.stringify({
                contents: ['Content here'],
                background: '#ff0000',
                backgroundType: 'color',
            }),
        }
        render(<CreateTemplateModal {...baseProps} editingTemplate={template as TemplateItem} />)
        expect(screen.getByDisplayValue('My Template')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Content here')).toBeInTheDocument()
        expect(screen.getByDisplayValue('A prayer template')).toBeInTheDocument()
    })

    it('calls updateTemplate instead of createTemplate when editing', async () => {
        const template: Partial<TemplateItem> = {
            _id: 'tpl-1',
            name: 'Old Name',
            category: 'general',
            slideId: '{}',
        }
        render(<CreateTemplateModal {...baseProps} editingTemplate={template as TemplateItem} />)
        fireEvent.change(screen.getByDisplayValue('Old Name'), { target: { value: 'Updated Name' } })
        fireEvent.click(screen.getByText('Update Template').closest('button')!)

        await waitFor(() => {
            expect(mockUpdateTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
                name: 'Updated Name',
            }))
        })
        expect(mockCreateTemplate).not.toHaveBeenCalled()
    })

    it('shows image upload section when image type is selected', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Upload Image')).toBeInTheDocument()
    })

    it('shows video upload section when video type is selected', () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Video'))
        expect(screen.getByText(/Upload Video/)).toBeInTheDocument()
    })

    it('shows color picker when color type is selected', async () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.click(screen.getByText('Color'))
        await waitFor(() => {
            const colorInputs = screen.getAllByDisplayValue('#667eea')
            expect(colorInputs.length).toBeGreaterThanOrEqual(1)
        })
    })

    it('renders preview with default content placeholder', () => {
        render(<CreateTemplateModal {...baseProps} />)
        expect(screen.getByText('Your content here')).toBeInTheDocument()
    })

    it('updates preview when content is entered', () => {
        render(<CreateTemplateModal {...baseProps} />)
        fireEvent.change(screen.getByPlaceholderText('Enter default text for this template...'), { target: { value: 'Custom content' } })
        expect(screen.getByText('Custom content')).toBeInTheDocument()
    })

    it('shows preset image options for image background type', () => {
        render(<CreateTemplateModal {...baseProps} />)
        // The preset images section should exist (it renders background image buttons)
        expect(screen.getByText('Background Image')).toBeInTheDocument()
    })

    it('renders X close button', () => {
        render(<CreateTemplateModal {...baseProps} />)
        const buttons = screen.getAllByRole('button')
        const xButton = buttons.find(btn => btn.querySelector('svg') && btn.className.includes('ml-auto'))
        expect(xButton).toBeTruthy()
    })

    it('calls onClose when X button is clicked', () => {
        const onClose = vi.fn()
        render(<CreateTemplateModal {...baseProps} onClose={onClose} />)
        const buttons = screen.getAllByRole('button')
        const xButton = buttons.find(btn => btn.querySelector('svg') && btn.className.includes('ml-auto'))
        fireEvent.click(xButton!)
        expect(onClose).toHaveBeenCalled()
    })
})
