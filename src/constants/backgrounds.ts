/**
 * Default backgrounds for slide types: the single source of truth for them
 * across the app.
 *
 * Motion backgrounds (src/components/motion/motionBackgrounds.ts), drawn by
 * the app itself. These were Unsplash photos linked by URL, and one was
 * removed from Unsplash, leaving a broken image where a template stood.
 * Nothing here can go missing, and nothing needs downloading or licensing.
 */

export interface DefaultBackground {
    backgroundType: 'image' | 'gradient' | 'video' | 'motion'
    background: string
    backgroundVideoKey: string | null
}

const motion = (id: string): DefaultBackground => ({ backgroundType: 'motion', background: `motion:${id}`, backgroundVideoKey: null })

export const DEFAULT_BACKGROUNDS: Record<string, DefaultBackground> = {
    hymn: motion('warm-glow'),
    song: motion('warm-glow'),
    worship: motion('warm-glow'),
    bible: motion('galaxy'),
    sermon: motion('galaxy'),
    text: motion('aurora'),
    announcement: motion('aurora'),
    prayer: motion('embers'),
    general: motion('aurora'),
}

/**
 * The Unsplash photos the defaults used to be. A device whose saved default is
 * still one of these never chose it, so it moves to the motion default
 * (appStore's persisted-settings merge).
 */
export const RETIRED_DEFAULT_PHOTOS = new Set([
    'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
    'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
    'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1740',
    'https://images.unsplash.com/photo-1508962924756-ee9b9f294d52?q=80&w=1740',
])

/**
 * Get the default background for a slide type
 */
export function getDefaultBackground(type: string): DefaultBackground {
    return DEFAULT_BACKGROUNDS[type] || DEFAULT_BACKGROUNDS.general
}

/**
 * Get all default backgrounds as an object compatible with AppSettings
 */
export function getDefaultBackgroundSettings(): Record<string, DefaultBackground> {
    return { ...DEFAULT_BACKGROUNDS }
}