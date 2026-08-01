import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TemplateItem, SlideType } from '../../../hooks/useTemplates'

/**
 * The two filter axes of the templates panel.
 *
 * `category` ("how is this template filed?") and `appliesTo` ("which slide types
 * may use it?") are independent, and the panel used to filter on category alone —
 * `appliesTo` was rendered as badges and never acted on. That made the panel
 * quietly misleading: an operator who scoped a template to Songs had no way to
 * find it by that, and the Prayer *category* chip looked like it ought to.
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
    template({ _id: 'b', name: 'Bible Only', category: 'sermon', appliesTo: ['bible'] }),
    template({ _id: 'c', name: 'Universal', category: 'general', appliesTo: ['any'] }),
    template({ _id: 'd', name: 'Unconstrained', category: 'prayer' }),
    template({ _id: 'e', name: 'Prayer Filed Songs', category: 'prayer', appliesTo: ['song'] }),
]

const h = vi.hoisted(() => ({ slideTypeProp: undefined as SlideType | undefined }))

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ isSignedIn: true }) }))
vi.mock('../../modals', () => ({ CreateTemplateModal: () => null }))
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
            // The real implementation, so the panel and the inline pickers can't
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
    return TEMPLATES.map((t) => t.name).filter((name) => screen.queryAllByText(name).length > 0)
}

function renderBrowser() {
    return render(<TemplateBrowser onSelect={vi.fn()} slideType={h.slideTypeProp} />)
}

describe('TemplateBrowser filters', () => {
    beforeEach(() => {
        h.slideTypeProp = undefined
    })

    it('shows every template with no filter applied', () => {
        renderBrowser()
        expect(visibleNames()).toHaveLength(TEMPLATES.length)
    })

    it('filters by category, independently of appliesTo', () => {
        renderBrowser()
        fireEvent.click(screen.getByTitle('Prayer'))
        expect(visibleNames().sort()).toEqual(['Prayer Filed Songs', 'Unconstrained'])
    })

    it('filters by the slide type a template works with', () => {
        // The new axis. "Bible Only" is excluded; the wildcard and unconstrained
        // templates are not.
        renderBrowser()
        fireEvent.click(screen.getByTitle('Templates that work with Songs'))
        expect(visibleNames().sort()).toEqual([
            'Prayer Filed Songs', 'Songs Only', 'Unconstrained', 'Universal',
        ])
    })

    it('keeps an "Any Type" template visible under every slide-type filter', () => {
        // The behaviour the confusion was really about: a template saved as
        // applying to "Any Type" genuinely does apply here, so it must not
        // disappear when the operator narrows by slide type.
        renderBrowser()
        for (const label of ['Songs', 'Bible Verses', 'Countdowns']) {
            fireEvent.click(screen.getByTitle(`Templates that work with ${label}`))
            expect(visibleNames()).toContain('Universal')
            expect(visibleNames()).toContain('Unconstrained')
        }
    })

    it('composes the two axes', () => {
        renderBrowser()
        fireEvent.click(screen.getByTitle('Prayer'))
        fireEvent.click(screen.getByTitle('Templates that work with Songs'))
        // Filed under Prayer AND usable on a song slide. 'Unconstrained' is also
        // Prayer and unconstrained, so it survives too; 'Songs Only' is Worship.
        expect(visibleNames().sort()).toEqual(['Prayer Filed Songs', 'Unconstrained'])
    })

    it('clears the slide-type filter again', () => {
        renderBrowser()
        fireEvent.click(screen.getByTitle('Templates that work with Bible Verses'))
        expect(visibleNames()).not.toContain('Songs Only')
        fireEvent.click(screen.getByTitle('Any slide type'))
        expect(visibleNames()).toContain('Songs Only')
    })

    it('does not offer the filter when the caller already scoped the panel', () => {
        // `slideType` is the caller's own constraint; a competing picker could
        // only fight it.
        h.slideTypeProp = 'bible'
        renderBrowser()
        expect(screen.queryByTitle('Templates that work with Songs')).toBeNull()
        expect(visibleNames().sort()).toEqual(['Bible Only', 'Unconstrained', 'Universal'])
    })
})
