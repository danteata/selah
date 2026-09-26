import { describe, it, expect } from 'vitest'
import { mergeWithDefaults, useAppStore } from '../appStore'

describe('restoring persisted settings', () => {
    it('keeps defaults for settings added since the data was saved', () => {
        const defaults = { font: 'Inter', slideStyles: { verseRefPosition: 'bottom', newOption: true } }
        const saved = { font: 'Georgia', slideStyles: { verseRefPosition: 'top' } }

        expect(mergeWithDefaults(defaults, saved)).toEqual({
            font: 'Georgia',
            slideStyles: { verseRefPosition: 'top', newOption: true },
        })
    })

    it('lets saved arrays and values replace, not merge', () => {
        expect(mergeWithDefaults({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] })
        expect(mergeWithDefaults({ on: true }, { on: false })).toEqual({ on: false })
    })

    it('always uses the shipped Bible version list, not a saved one', async () => {
        const options = useAppStore.persist.getOptions()
        const current = useAppStore.getState()
        const merged = options.merge!({ bibleVersions: [{ id: 'KJV' }] }, current) as typeof current
        expect(merged.bibleVersions).toBe(current.bibleVersions)

        const migrated = (await options.migrate!({ bibleVersions: [{ id: 'KJV' }], bannerVisible: false }, 0)) as Record<string, unknown>
        expect(migrated).not.toHaveProperty('bibleVersions')
        expect(migrated.bannerVisible).toBe(false)
    })
})
