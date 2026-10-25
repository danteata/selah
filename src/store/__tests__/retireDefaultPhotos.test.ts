import { describe, it, expect } from 'vitest'
import { retireDefaultPhotos, useAppStore } from '../appStore'
import { DEFAULT_BACKGROUNDS } from '../../constants/backgrounds'
import type { AppSettings } from '../../types'

const OLD_SONG_PHOTO = 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740'

describe('retireDefaultPhotos', () => {
    const defaults = useAppStore.getState().settings

    it('moves a default that is still the old stock photo to the motion default', () => {
        const saved = { ...defaults, defaultBackground: { ...defaults.defaultBackground, song: { backgroundType: 'image', background: OLD_SONG_PHOTO, backgroundVideoKey: null } } } as AppSettings
        const settings = retireDefaultPhotos(saved, defaults)
        expect(settings.defaultBackground.song).toEqual(DEFAULT_BACKGROUNDS.song)
        expect(settings.defaultBackground.song.background).toBe('motion:warm-glow')
    })

    it('keeps a background someone chose', () => {
        const chosen = { backgroundType: 'image', background: 'https://example.org/our-church.jpg', backgroundVideoKey: null }
        const saved = { ...defaults, defaultBackground: { ...defaults.defaultBackground, song: chosen } } as AppSettings
        expect(retireDefaultPhotos(saved, defaults).defaultBackground.song).toEqual(chosen)
    })
})
