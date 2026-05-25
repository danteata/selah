/**
 * Default background images for slide types
 * This is the single source of truth for default backgrounds across the app
 */

export interface DefaultBackground {
    backgroundType: 'image' | 'gradient' | 'video'
    background: string
    backgroundVideoKey: string | null
}

export const DEFAULT_BACKGROUNDS: Record<string, DefaultBackground> = {
    hymn: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
        backgroundVideoKey: null
    },
    song: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
        backgroundVideoKey: null
    },
    bible: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
        backgroundVideoKey: null
    },
    text: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
        backgroundVideoKey: null
    },
    worship: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
        backgroundVideoKey: null
    },
    sermon: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
        backgroundVideoKey: null
    },
    announcement: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
        backgroundVideoKey: null
    },
    prayer: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1740',
        backgroundVideoKey: null
    },
    general: {
        backgroundType: 'image',
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
        backgroundVideoKey: null
    }
}

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