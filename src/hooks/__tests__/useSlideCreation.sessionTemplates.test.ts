/**
 * In someone else's live session the operator's default templates are the
 * house style: a slide created here without an explicit template takes the
 * operator's default for its type, and this device's own default only covers
 * a type the operator hasn't set (or a template this device can't see).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlideCreation } from '../useSlideCreation'
import type { Scripture, SessionDefaultTemplates } from '../../types'

const template = (id: string, background: string) => ({
    _id: id,
    name: id,
    slideId: { background, backgroundType: 'image', layout: 'bible' },
})

const TEMPLATES = [
    template('operator-scripture', 'operator.jpg'),
    template('mine-scripture', 'mine.jpg'),
    template('picked', 'picked.jpg'),
]

const mockSettings = {
    defaultFont: 'Inter',
    defaultBackground: {
        default: { backgroundType: 'image', background: 'default.jpg', backgroundVideoKey: null },
        text: { backgroundType: 'image', background: 'default.jpg', backgroundVideoKey: null },
        bible: { backgroundType: 'image', background: 'default.jpg', backgroundVideoKey: null },
        hymn: { backgroundType: 'image', background: 'default.jpg', backgroundVideoKey: null },
        song: { backgroundType: 'image', background: 'default.jpg', backgroundVideoKey: null },
    },
    slideStyles: { alignment: 'center', fontSizePercent: 100, lettercase: '', lineSpacing: 'normal', textOutlined: false },
    defaultTemplates: { scripture: 'mine-scripture' } as Record<string, string | null>,
}

let mockSessionTemplates: SessionDefaultTemplates | null = null

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector?: (state: unknown) => unknown) => {
        const state = {
            activeSlides: [],
            settings: mockSettings,
            activeSchedule: { _id: 'schedule-1' },
            sessionDefaultTemplates: mockSessionTemplates,
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../useTemplates', () => ({
    useTemplates: () => ({ templates: TEMPLATES, getTemplate: () => null }),
}))

const JOHN_3_16: Scripture = {
    label: 'John 3:16',
    labelShortFormat: '43:3:16',
    version: 'KJV',
    content: 'For God so loved the world',
}

function bibleSlideBackground(options?: Parameters<ReturnType<typeof useSlideCreation>['createBibleSlide']>[1]) {
    const { result } = renderHook(() => useSlideCreation())
    return result.current.createBibleSlide(JOHN_3_16, options).background
}

describe('session default templates', () => {
    beforeEach(() => {
        mockSessionTemplates = null
    })

    it('uses this device’s default outside a session', () => {
        expect(bibleSlideBackground()).toBe('mine.jpg')
    })

    it('uses the operator’s default over this device’s in their session', () => {
        mockSessionTemplates = { scripture: 'operator-scripture' }
        expect(bibleSlideBackground()).toBe('operator.jpg')
    })

    it('keeps an explicitly picked template over the operator’s default', () => {
        mockSessionTemplates = { scripture: 'operator-scripture' }
        expect(bibleSlideBackground({ template: TEMPLATES[2] as never })).toBe('picked.jpg')
    })

    it('falls back to this device’s default where the operator has none', () => {
        mockSessionTemplates = { scripture: null }
        expect(bibleSlideBackground()).toBe('mine.jpg')
    })

    it('falls back to this device’s default when the operator’s template isn’t visible here', () => {
        mockSessionTemplates = { scripture: 'not-shared-with-me' }
        expect(bibleSlideBackground()).toBe('mine.jpg')
    })
})
