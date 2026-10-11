import { describe, it, expect } from 'vitest'
import type { Slide } from '../../types'
import { slideBackgroundFilter } from '../slideBackground'

const slide = (fields: Partial<Slide>) => fields as Slide

describe('slideBackgroundFilter', () => {
    it('dims photos and videos to half unless the slide says otherwise', () => {
        expect(slideBackgroundFilter(slide({ background: 'https://images.unsplash.com/x.jpg' }))).toBe('blur(0px) brightness(50%)')
        expect(slideBackgroundFilter(slide({ background: 'x.jpg', slideStyle: { brightness: 0 } as Slide['slideStyle'] }))).toBe('blur(0px) brightness(0%)')
    })

    it("leaves motion backgrounds at full brightness: they're drawn dark already", () => {
        expect(slideBackgroundFilter(slide({ background: 'motion:embers', backgroundType: 'motion' }))).toBe('blur(0px) brightness(100%)')
        expect(slideBackgroundFilter(slide({ background: 'motion:embers', slideStyle: { brightness: 70 } as Slide['slideStyle'] }))).toBe('blur(0px) brightness(70%)')
    })
})
