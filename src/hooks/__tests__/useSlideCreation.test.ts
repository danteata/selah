import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlideCreation, calculateScreenFontSize, generateSlideName } from '../useSlideCreation'
import type { Slide, Scripture, Hymn, Song, Countdown } from '../../types'

// Mock data
const mockSettings = {
    appVersion: '1.0.0',
    defaultBibleVersion: 'KJV',
    defaultFont: 'Inter',
    defaultBackground: {
        default: { backgroundType: 'image', background: 'test.jpg', backgroundVideoKey: null },
        text: { backgroundType: 'image', background: 'text-bg.jpg', backgroundVideoKey: null },
        bible: { backgroundType: 'image', background: 'bible-bg.jpg', backgroundVideoKey: null },
        hymn: { backgroundType: 'image', background: 'hymn-bg.jpg', backgroundVideoKey: null },
    },
    slideStyles: {
        alignment: 'center',
        fontSizePercent: 100,
        lettercase: '',
        lineSpacing: 'normal',
        textOutlined: false,
    },
    bibleVersions: [],
    songAndHymnLabelsVisibility: true,
}

let mockActiveSlides: Slide[] = []
let mockActiveSchedule = { _id: 'schedule-1' }

// Mock the store
vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector?: (state: unknown) => unknown) => {
        const state = {
            activeSlides: mockActiveSlides,
            settings: mockSettings,
            activeSchedule: mockActiveSchedule,
            appendActiveSlide: vi.fn((slide: Slide) => {
                mockActiveSlides.push(slide)
            }),
        }
        return selector ? selector(state) : state
    }),
}))

describe('useSlideCreation', () => {
    describe('calculateScreenFontSize', () => {
        it('returns 8 for short content', () => {
            expect(calculateScreenFontSize('Short text')).toBe(8)
        })

        it('returns 6.5 for medium content', () => {
            const mediumText = 'a'.repeat(150)
            expect(calculateScreenFontSize(mediumText)).toBe(6.5)
        })

        it('returns 3.5 for very long content', () => {
            const longText = 'a'.repeat(600)
            expect(calculateScreenFontSize(longText)).toBe(3.5)
        })

        it('returns default for empty content', () => {
            expect(calculateScreenFontSize('')).toBe(3.5)
        })
    })

    describe('generateSlideName', () => {
        it('returns existing name if not Untitled', () => {
            const slide = { name: 'My Slide', type: 'text' } as Slide
            expect(generateSlideName(slide)).toBe('My Slide')
        })

        it('returns Bible Slide for bible type', () => {
            const slide = { name: 'Untitled', type: 'bible', title: 'John 3:16' } as Slide
            expect(generateSlideName(slide)).toBe('John 3:16')
        })

        it('returns Text Slide for text type', () => {
            const slide = { name: 'Untitled', type: 'text' } as Slide
            expect(generateSlideName(slide)).toBe('Text Slide')
        })
    })

    describe('createTextSlide', () => {
        it('creates a text slide with correct defaults', () => {
            const { result } = renderHook(() => useSlideCreation())
            const slide = result.current.createTextSlide()

            expect(slide.type).toBe('text')
            expect(slide.layout).toBe('full-text')
            expect(slide.contents).toEqual([])
            expect(slide.id).toBeDefined()
        })
    })

    describe('createBibleSlide', () => {
        it('creates a bible slide with scripture data', () => {
            const { result } = renderHook(() => useSlideCreation())

            const scripture: Scripture = {
                label: 'John 3:16',
                labelShortFormat: '43:3:16',
                version: 'KJV',
                content: [{ book: '43', chapter: '3', verse: '16', scripture: 'For God so loved...' }],
            }

            const slide = result.current.createBibleSlide(scripture)

            expect(slide.type).toBe('bible')
            expect(slide.layout).toBe('bible')
            expect(slide.title).toBe('John 3:16')
            expect(slide.contents).toContain('For God so loved...')
        })
    })

    describe('createHymnSlide', () => {
        it('creates a hymn slide with hymn data', () => {
            const { result } = renderHook(() => useSlideCreation())

            const hymn: Hymn = {
                number: '1',
                title: 'Amazing Grace',
                chorus: 'Amazing grace, how sweet the sound',
                verses: ['Verse 1 content'],
                author: 'John Newton',
                source: 'Hymnal',
                meta: 'amazing-grace',
            }

            const slide = result.current.createHymnSlide(hymn)

            expect(slide.type).toBe('hymn')
            expect(slide.layout).toBe('bible')
            expect(slide.songId).toBe('1')
            expect(slide.hasChorus).toBe(true)
            expect(slide.title).toBe('Verse 1')
        })
    })

    describe('duplicateSlide', () => {
        it('creates a new slide with new id', () => {
            const { result } = renderHook(() => useSlideCreation())

            const original: Slide = {
                id: 'original-id',
                _id: 'db-id',
                index: 0,
                name: 'Original',
                type: 'text',
                layout: 'full-text',
                userId: 'user-1',
                churchId: 'church-1',
                scheduleId: 'schedule-1',
                contents: ['Content'],
            }

            const duplicate = result.current.duplicateSlide(original)

            expect(duplicate).not.toBeNull()
            expect(duplicate!.id).not.toBe('original-id')
            expect(duplicate!._id).toBeUndefined()
            expect(duplicate!.name).toBe('Original')
            expect(duplicate!.contents).toEqual(['Content'])
        })

        it('returns null for undefined slide', () => {
            const { result } = renderHook(() => useSlideCreation())
            expect(result.current.duplicateSlide(undefined)).toBeNull()
        })
    })
})
