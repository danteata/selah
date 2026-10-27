import { describe, it, expect } from 'vitest'
import { MOTION_TEMPLATES } from '../../../convex/templates'
import { BUILT_IN_MOTION_TEMPLATES, builtInTemplates, findTemplate, withBuiltInTemplates } from '../motionTemplates'
import type { TemplateItem } from '../../hooks/useTemplates'

const template = (over: Partial<TemplateItem> & { _id: string; name: string }): TemplateItem =>
    ({ category: 'general', slideId: '{}', createdAt: '', updatedAt: '', ...over }) as TemplateItem

describe('the built-in motion templates the app carries', () => {
    it('are the ones Convex seeds', () => {
        expect(BUILT_IN_MOTION_TEMPLATES.map(({ name, description, motionId, category }) => [name, description, motionId, category]))
            .toEqual(MOTION_TEMPLATES.map(([name, description, motionId, category]) => [name, description, motionId, category]))
    })

    it('draw their motion background', () => {
        const embers = builtInTemplates().find((t) => t.name === 'Embers')!
        expect(JSON.parse(embers.slideId as string)).toMatchObject({ background: 'motion:embers', backgroundType: 'motion' })
        expect(embers.createdBy).toBeUndefined()
    })

    it("join a list without doubling the ones Convex's copy already has", () => {
        const list = withBuiltInTemplates([
            template({ _id: 'srv-galaxy', name: 'Galaxy' }),
            template({ _id: 'mine', name: 'Embers', createdBy: 'u1' }), // someone's own, not the built-in
        ])
        expect(list.filter((t) => t.name === 'Galaxy').map((t) => t._id)).toEqual(['srv-galaxy'])
        expect(list.filter((t) => t.name === 'Embers').map((t) => t._id)).toEqual(['mine', 'builtin:embers'])
        expect(list).toHaveLength(2 + BUILT_IN_MOTION_TEMPLATES.length - 1)
    })

    it("find a default picked offline in Convex's list once online", () => {
        const online = [template({ _id: 'srv-embers', name: 'Embers' }), template({ _id: 'x', name: 'Mine', createdBy: 'u1' })]
        expect(findTemplate(online, 'builtin:embers')?._id).toBe('srv-embers')
        expect(findTemplate(online, 'x')?._id).toBe('x')
        expect(findTemplate(online, 'gone')).toBeNull()
        expect(findTemplate(withBuiltInTemplates([]), 'builtin:silk')?.name).toBe('Silk')
        expect(findTemplate(undefined, 'x')).toBeNull()
    })
})
