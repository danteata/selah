import type { TemplateCategory, TemplateItem } from '../hooks/useTemplates'

/**
 * The built-in motion templates, drawn by the app itself
 * (components/motion/motionBackgrounds.ts). Convex seeds the same list for
 * every church (convex/templates.ts `MOTION_TEMPLATES`; a test keeps the two
 * equal). This copy is what the app lists when it can't reach Convex: they
 * were missing offline, and from a device that had never been online, though
 * nothing about them needs a server.
 */
export const BUILT_IN_MOTION_TEMPLATES: ReadonlyArray<{
    name: string
    description: string
    motionId: string
    category: TemplateCategory
}> = [
    { name: 'Galaxy', description: 'Drifting stars and a slow-turning nebula', motionId: 'galaxy', category: 'worship' },
    { name: 'Aurora', description: 'Soft green and violet light', motionId: 'aurora', category: 'worship' },
    { name: 'Warm Glow', description: 'Gold and rose light leaks', motionId: 'warm-glow', category: 'worship' },
    { name: 'Embers', description: 'Rising sparks over a dark fire', motionId: 'embers', category: 'prayer' },
    { name: 'Silk', description: 'Ribbons of colour flowing across the screen', motionId: 'silk', category: 'general' },
    { name: 'Light Rays', description: 'Beams of light from above', motionId: 'light-rays', category: 'sermon' },
]

/** Ids of the app's own copies, so they never collide with Convex's. */
const BUILT_IN_ID_PREFIX = 'builtin:'

/** The built-in templates as the template list holds them. */
export function builtInTemplates(): TemplateItem[] {
    return BUILT_IN_MOTION_TEMPLATES.map(({ name, description, motionId, category }) => ({
        _id: `${BUILT_IN_ID_PREFIX}${motionId}`,
        name,
        description,
        slideId: JSON.stringify({
            type: 'text',
            layout: 'full-text',
            contents: ['Your content here'],
            background: `motion:${motionId}`,
            backgroundType: 'motion',
        }),
        category,
        appliesTo: ['any'],
        createdAt: '',
        updatedAt: '',
    }))
}

/** Convex's built-ins are the templates nobody created. */
const isSystemTemplate = (template: TemplateItem) => !template.createdBy

/**
 * `templates` plus the built-ins it lacks: a built-in Convex already listed
 * (by name, as Convex seeds them) isn't added twice.
 */
export function withBuiltInTemplates(templates: TemplateItem[]): TemplateItem[] {
    const listed = new Set(templates.filter(isSystemTemplate).map((template) => template.name))
    return [...templates, ...builtInTemplates().filter((template) => !listed.has(template.name))]
}

/**
 * The template `id` names, in `templates`. A built-in picked while offline
 * (`builtin:embers`) is Convex's copy of it once online, so a default chosen
 * offline keeps working.
 */
export function findTemplate(templates: TemplateItem[] | undefined, id: string | null | undefined): TemplateItem | null {
    if (!templates || !id) return null
    const exact = templates.find((template) => template._id === id)
    if (exact) return exact
    if (!id.startsWith(BUILT_IN_ID_PREFIX)) return null
    const builtIn = BUILT_IN_MOTION_TEMPLATES.find((template) => `${BUILT_IN_ID_PREFIX}${template.motionId}` === id)
    return builtIn ? templates.find((template) => isSystemTemplate(template) && template.name === builtIn.name) ?? null : null
}
