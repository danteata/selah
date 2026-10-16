import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { SlideType, TemplateItem } from './useTemplates'

/** A kind of slide that can have a default template: the keys of
 *  `settings.defaultTemplates` that `useSlideCreation` actually reads. */
export type DefaultTemplateSlot = 'scripture' | 'song' | 'hymn' | 'dictionary' | 'text'

/** Every slot, with the slide type a template must work with to fill it.
 *  Adding one means adding its lookup in `useSlideCreation` too. */
export const DEFAULT_TEMPLATE_SLOTS: ReadonlyArray<{ slot: DefaultTemplateSlot; slideType: SlideType; label: string }> = [
    { slot: 'scripture', slideType: 'bible', label: 'Bible verses' },
    { slot: 'song', slideType: 'song', label: 'Songs' },
    { slot: 'hymn', slideType: 'hymn', label: 'Hymns' },
    { slot: 'dictionary', slideType: 'dictionary', label: 'Definitions' },
    { slot: 'text', slideType: 'text', label: 'Text slides' },
]

/** Whether a template is offered for a slide type: no `appliesTo`, or `any`,
 *  means every type (the same rule as `getTemplatesForSlideType`). */
export function templateWorksWith(template: Pick<TemplateItem, 'appliesTo'>, slideType: SlideType): boolean {
    const applies = template.appliesTo || ['any']
    return applies.includes('any') || applies.includes(slideType)
}

/**
 * The default template for each kind of slide: this device's own, and — while
 * this device is a collaborator in someone's live session — the operator's,
 * which new slides here take first (see useSlideCreation).
 */
export function useDefaultTemplates() {
    const mine = useAppStore((s) => s.settings.defaultTemplates)
    const operators = useAppStore((s) => s.sessionDefaultTemplates)
    const setDefaultTemplate = useAppStore((s) => s.setDefaultTemplate)

    const isMine = useCallback(
        (slot: DefaultTemplateSlot, templateId: string) => mine?.[slot] === templateId,
        [mine],
    )
    const isOperators = useCallback(
        (slot: DefaultTemplateSlot, templateId: string) => operators?.[slot] === templateId,
        [operators],
    )
    /** Make the template this device's default for the slot, or clear it if it already is. */
    const toggle = useCallback(
        (slot: DefaultTemplateSlot, templateId: string) => {
            setDefaultTemplate(slot, mine?.[slot] === templateId ? null : templateId)
        },
        [mine, setDefaultTemplate],
    )

    return { mine, operators, inSession: operators !== null, isMine, isOperators, toggle, setDefaultTemplate }
}
