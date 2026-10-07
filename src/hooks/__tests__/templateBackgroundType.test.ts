import { describe, it, expect } from 'vitest'
import { isImageUrl, templateBackgroundType } from '../useLocalBackground'

describe('isImageUrl', () => {
    it('recognises pictures', () => {
        expect(isImageUrl('https://images.unsplash.com/photo-1506056820413?q=80&w=1740')).toBe(true)
        expect(isImageUrl('data:image/png;base64,abc')).toBe(true)
        expect(isImageUrl('asset://localhost/%2FUsers%2Fme%2Fbg.JPG')).toBe(true)
    })

    it("doesn't take videos or blank for pictures", () => {
        expect(isImageUrl('asset://localhost/%2FUsers%2Fme%2Fclip.mp4')).toBe(false)
        expect(isImageUrl('blob:http://x/123')).toBe(false)
        expect(isImageUrl('')).toBe(false)
    })
})

describe('templateBackgroundType', () => {
    const photo = 'https://images.unsplash.com/photo-1?q=80'

    it('shows a "video" template with only a picture as the picture', () => {
        expect(templateBackgroundType({}, { backgroundType: 'video' }, photo)).toBe('image')
    })

    it('keeps video when there is a video to play', () => {
        expect(templateBackgroundType({ backgroundStorageId: 'kg2' }, { backgroundType: 'video' }, '')).toBe('video')
        expect(templateBackgroundType({}, { backgroundType: 'video', localFilePath: '/a.mp4' }, photo)).toBe('video')
    })

    it('leaves other types alone', () => {
        expect(templateBackgroundType({}, { backgroundType: 'gradient' }, 'linear-gradient(red, blue)')).toBe('gradient')
        expect(templateBackgroundType({}, null, '')).toBe('gradient')
    })
})
