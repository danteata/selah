import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../useTemplates', () => ({ useFileUrl: () => null }))
vi.mock('../useLocalBackground', () => ({ useLocalBackground: (bg?: string) => bg || '' }))
vi.mock('../useLocalMediaBlobUrl', () => ({ useLocalMediaBlobUrl: (id?: string) => (id ? 'blob:fresh-from-library' : null) }))

import { useSlideBackgroundUrl } from '../useSlideBackgroundUrl'

const slide = (extra: object) => ({ id: 's', background: 'blob:from-another-tab', ...extra }) as never

describe('useSlideBackgroundUrl', () => {
    it("loads a slide's library copy rather than another tab's object URL", () => {
        const { result } = renderHook(() => useSlideBackgroundUrl(slide({ localMediaId: 'm1' })))
        expect(result.current).toBe('blob:fresh-from-library')
    })

    it('uses the stored background when there is no library copy', () => {
        const { result } = renderHook(() => useSlideBackgroundUrl(slide({ background: 'https://x/bg.jpg' })))
        expect(result.current).toBe('https://x/bg.jpg')
    })
})
