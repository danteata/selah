import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { TemplateItem, SlideType } from '../../../hooks/useTemplates'
import { useAppStore } from '../../../store/appStore'

/**
 * The templates panel: found by what a template works with (which decides
 * where it's offered), and doing the two things a template does — be the
 * default for a kind of slide, or become a text slide.
 */

function template(over: Partial<TemplateItem> & { _id: string; name: string }): TemplateItem {
    return {
        category: 'general',
        slideId: '',
        createdAt: '',
        updatedAt: '',
        ...over,
    } as TemplateItem
}

const TEMPLATES: TemplateItem[] = [
    template({ _id: 'a', name: 'Songs Only', category: 'worship', appliesTo: ['song'] }),
    template({ _id: 'b', name: 'Bible Only', category: 'sermon', appliesTo: ['bible'], isFavorite: true }),
    template({ _id: 'c', name: 'Universal', category: 'general', appliesTo: ['any'] }),
    template({ _id: 'd', name: 'Unconstrained', category: 'prayer', createdBy: 'me' }),
    template({ _id: 'e', name: 'Colleague’s', category: 'prayer', appliesTo: ['text'], createdBy: 'someone-else' }),
]

const h = vi.hoisted(() => ({ slideTypeProp: undefined as SlideType | undefined }))

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ isSignedIn: true }) }))
vi.mock('../../modals', () => ({ CreateTemplateModal: () => null }))
vi.mock('../../../hooks/useUserRole', () => ({ useUserRole: () => ({ isSuperadmin: false, currentUser: { _id: 'me' } }) }))
vi.mock('../../../hooks/useLocalBackground', () => ({ useLocalBackground: () => '' }))

vi.mock('../../../hooks/useTemplates', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../hooks/useTemplates')>()
    return {
        ...actual,
        useFileUrl: () => null,
        useTemplates: () => ({
            templates: TEMPLATES,
            isLoading: false,
            deleteTemplate: vi.fn(),
            toggleFavorite: vi.fn(),
            seedDefaultTemplates: vi.fn(),
            resetDefaultTemplates: vi.fn(),
            // The real rule, so the panel and the inline pickers can't
            // disagree about what "works with" means.
            getTemplatesForSlideType: (slideType: SlideType) =>
                TEMPLATES.filter((t) => {
                    const applies = t.appliesTo || ['any']
                    return applies.includes('any') || applies.includes(slideType)
                }),
        }),
    }
})

const { TemplateBrowser } = await import('../TemplateBrowser')

/** Names of the template cards currently rendered. */
function visibleNames(): string[] {
    return TEMPLATES.map((t) => t.name).filter((name) => screen.queryByRole('button', { name }) !== null)
}

const onSelect = vi.fn()

function renderBrowser() {
    return render(<TemplateBrowser isInline onSelect={onSelect} slideType={h.slideTypeProp} />)
}

describe('TemplateBrowser', () => {
    beforeEach(() => {
        h.slideTypeProp = undefined
        onSelect.mockReset()
        useAppStore.setState((s) => ({
            settings: { ...s.settings, defaultTemplates: {} },
            sessionDefaultTemplates: null,
        }))
    })

    describe('filters', () => {
        it('shows every template with no filter applied', () => {
            renderBrowser()
            expect(visibleNames()).toHaveLength(TEMPLATES.length)
        })

        it('filters by the slide type a template works with', () => {
            renderBrowser()
            fireEvent.click(screen.getByTitle('Templates that work with Songs'))
            expect(visibleNames().sort()).toEqual(['Songs Only', 'Unconstrained', 'Universal'])
        })

        it('keeps an "Any Type" template visible under every slide-type filter', () => {
            renderBrowser()
            for (const label of ['Songs', 'Bible Verses', 'Countdowns']) {
                fireEvent.click(screen.getByTitle(`Templates that work with ${label}`))
                expect(visibleNames()).toContain('Universal')
                expect(visibleNames()).toContain('Unconstrained')
            }
        })

        it('clears the slide-type filter again', () => {
            renderBrowser()
            fireEvent.click(screen.getByTitle('Templates that work with Bible Verses'))
            expect(visibleNames()).not.toContain('Songs Only')
            fireEvent.click(screen.getByTitle('Any slide type'))
            expect(visibleNames()).toContain('Songs Only')
        })

        it('does not offer the filter when the caller already scoped the panel', () => {
            h.slideTypeProp = 'bible'
            renderBrowser()
            expect(screen.queryByTitle('Templates that work with Songs')).toBeNull()
            expect(visibleNames().sort()).toEqual(['Bible Only', 'Unconstrained', 'Universal'])
        })

        it('shows the church’s favourites', () => {
            renderBrowser()
            fireEvent.click(screen.getByTitle('Your church\'s favourites'))
            expect(visibleNames()).toEqual(['Bible Only'])
        })

        it('no longer files templates by category', () => {
            renderBrowser()
            expect(screen.queryByTitle('Prayer')).toBeNull()
            expect(screen.queryByTitle('Worship')).toBeNull()
        })
    })

    describe('defaults', () => {
        it('offers a default only for the kinds of slide a template works with', () => {
            renderBrowser()
            fireEvent.click(screen.getByRole('button', { name: 'Songs Only' }))
            const defaults = within(screen.getByRole('group', { name: 'Default for' }))
            expect(defaults.getByRole('button', { name: 'Songs' })).toBeInTheDocument()
            expect(defaults.queryByRole('button', { name: 'Bible verses' })).toBeNull()
        })

        it('sets and clears this device’s default from the card', () => {
            renderBrowser()
            fireEvent.click(screen.getByRole('button', { name: 'Bible Only' }))
            const toggle = screen.getByRole('button', { name: 'Bible verses' })

            fireEvent.click(toggle)
            expect(useAppStore.getState().settings.defaultTemplates?.scripture).toBe('b')
            expect(toggle).toHaveAttribute('aria-pressed', 'true')
            expect(within(screen.getByRole('button', { name: 'Bible Only' })).getByTitle('Your default for Bible')).toBeInTheDocument()

            fireEvent.click(toggle)
            expect(useAppStore.getState().settings.defaultTemplates?.scripture).toBeNull()
        })

        it('marks the operator’s defaults in a live session', () => {
            useAppStore.setState({ sessionDefaultTemplates: { song: 'a' } })
            renderBrowser()
            expect(within(screen.getByRole('button', { name: 'Songs Only' })).getByTitle('The operator\'s default for Songs')).toBeInTheDocument()
        })
    })

    describe('actions', () => {
        it('adds a text-capable template as a slide', () => {
            renderBrowser()
            fireEvent.click(screen.getByRole('button', { name: 'Universal' }))
            fireEvent.click(screen.getByRole('button', { name: 'Add as slide' }))
            expect(onSelect).toHaveBeenCalledWith(TEMPLATES[2])
        })

        it('doesn’t offer "Add as slide" for a template that isn’t for text', () => {
            renderBrowser()
            fireEvent.click(screen.getByRole('button', { name: 'Bible Only' }))
            expect(screen.queryByRole('button', { name: 'Add as slide' })).toBeNull()
        })

        it('offers edit and delete only on the caller’s own templates', () => {
            renderBrowser()
            expect(within(screen.getByRole('button', { name: 'Unconstrained' })).getByLabelText('Edit template')).toBeInTheDocument()
            expect(within(screen.getByRole('button', { name: 'Colleague’s' })).queryByLabelText('Edit template')).toBeNull()
            expect(within(screen.getByRole('button', { name: 'Universal' })).queryByLabelText('Delete template')).toBeNull()
        })
    })
})
