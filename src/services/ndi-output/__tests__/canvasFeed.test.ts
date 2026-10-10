import { describe, expect, it } from 'vitest'
import { fadeProgress, sceneAnimates } from '../canvasFeed'
import { backdropFor } from '../../../lib/graphics/renderBackdrop'
import type { Slide } from '../../../types'

const slide = (over: Partial<Slide> = {}) => ({ id: 's', type: 'text', layout: 'full_text', contents: ['x'], ...over }) as unknown as Slide

describe('canvas feed timing', () => {
    it('runs a crossfade over its length, and cuts when it has none', () => {
        expect(fadeProgress(1000, 1000, 0.5)).toBe(0)
        expect(fadeProgress(1250, 1000, 0.5)).toBe(0.5)
        expect(fadeProgress(2000, 1000, 0.5)).toBe(1)
        expect(fadeProgress(1000, 1000, 0)).toBe(1)
    })

    it('keeps drawing only what moves on its own', () => {
        expect(sceneAnimates(slide(), backdropFor(slide(), null))).toBe(false)
        const motion = slide({ background: 'motion:galaxy' })
        expect(sceneAnimates(motion, backdropFor(motion, null))).toBe(true)
        // Keyed (alpha) feeds draw no backdrop, so a motion background doesn't move them.
        expect(sceneAnimates(motion, null)).toBe(false)
        expect(sceneAnimates(slide({ type: 'countdown', contents: ['Soon', '00:05:00'] }), null)).toBe(true)
        expect(sceneAnimates(null, null)).toBe(false)
        const video = slide({ background: 'clip.mp4', backgroundType: 'video' })
        expect(sceneAnimates(video, backdropFor(video, 'asset://clip.mp4'))).toBe(true)
    })
})

describe('backdropFor', () => {
    it('tells colours, gradients, images, motion and video apart', () => {
        expect(backdropFor(slide({ background: '#123456' }), null)).toEqual({ kind: 'color', color: '#123456' })
        expect(backdropFor(slide({ background: 'linear-gradient(red, blue)' }), null).kind).toBe('gradient')
        expect(backdropFor(slide({ background: 'photo.jpg' }), 'asset://photo.jpg'))
            .toEqual({ kind: 'image', url: 'asset://photo.jpg', fit: 'cover', media: false })
        expect(backdropFor(slide({ background: 'motion:aurora' }), null).kind).toBe('motion')
        expect(backdropFor(slide({ background: 'clip.mp4', backgroundType: 'video' }), 'asset://clip.mp4'))
            .toEqual({ kind: 'video', url: 'asset://clip.mp4', fit: 'cover', media: false })
        expect(backdropFor(slide({ type: 'external' as Slide['type'], backgroundType: 'external' }), null).kind).toBe('unsupported')
        expect(backdropFor(slide(), null).kind).toBe('none')
    })

    it('fits media as the slide asks, and backdrops always cover', () => {
        const media = slide({ type: 'media', background: 'clip.mp4', backgroundType: 'video', slideStyle: { backgroundFillType: 'fit' } })
        expect(backdropFor(media, 'asset://clip.mp4')).toEqual({ kind: 'video', url: 'asset://clip.mp4', fit: 'contain', media: true })
    })
})
