import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlideCreation, calculateScreenFontSize, generateSlideName, generateObjectId } from '../useSlideCreation'
import type { Slide, Scripture, Hymn } from '../../types'

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
    defaultTemplates: {},
}

let mockActiveSlides: Slide[] = []
let mockActiveSchedule = { _id: 'schedule-1' }

// Mock the store (must come BEFORE useSlideCreation import)
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

// Mock useTemplates so the hook doesn't need a Convex provider
vi.mock('../useTemplates', () => ({
    useTemplates: () => ({ templates: [], getTemplate: () => null }),
}))

describe('useSlideCreation', () => {
    beforeEach(() => {
        mockActiveSlides = []
        mockActiveSchedule = { _id: 'schedule-1' }
    })

    describe('calculateScreenFontSize', () => {
        it('returns 6 for short content (<100 chars)', () => {
            expect(calculateScreenFontSize('Short text')).toBe(6)
        })

        it('returns 5 for medium content (100-199 chars)', () => {
            const mediumText = 'a'.repeat(150)
            expect(calculateScreenFontSize(mediumText)).toBe(5)
        })

        it('returns 3.5 for 300-399 char content', () => {
            // Branch: < 400 → 3.5, < 500 → 3, < 700 → 2.5, else 2.2
            // This boundary test pins the current behavior so refactors can't silently shift it.
            expect(calculateScreenFontSize('a'.repeat(300))).toBe(3.5)
            expect(calculateScreenFontSize('a'.repeat(399))).toBe(3.5)
        })

        it('returns 3 for 400-499 char content', () => {
            expect(calculateScreenFontSize('a'.repeat(400))).toBe(3)
            expect(calculateScreenFontSize('a'.repeat(499))).toBe(3)
        })

        it('returns 2.5 for content 500-699 chars', () => {
            expect(calculateScreenFontSize('a'.repeat(500))).toBe(2.5)
            expect(calculateScreenFontSize('a'.repeat(600))).toBe(2.5)
            expect(calculateScreenFontSize('a'.repeat(699))).toBe(2.5)
        })

        it('returns default 3.5 for empty content (falsy length)', () => {
            // Implementation: length === 0 → 3.5, length < 100 → 6
            // The branch only checks === 0, so empty string falls into the 3.5 default.
            expect(calculateScreenFontSize('')).toBe(3.5)
        })

        it('returns 2.2 for very long content (>= 700 chars)', () => {
            const text = 'a'.repeat(800)
            expect(calculateScreenFontSize(text)).toBe(2.2)
        })

        it('boundary: length exactly 99 returns 6, length 100 returns 5', () => {
            // The boundary is strict-less-than (< 100, < 200, etc.)
            // length 99 → < 100 → 6
            // length 100 → not < 100 but < 200 → 5
            expect(calculateScreenFontSize('a'.repeat(99))).toBe(6)
            expect(calculateScreenFontSize('a'.repeat(100))).toBe(5)
        })
    })

    describe('generateSlideName', () => {
        it('returns existing name if not Untitled', () => {
            const slide = { name: 'My Slide', type: 'text' } as Slide
            expect(generateSlideName(slide)).toBe('My Slide')
        })

        it('returns Bible Slide for bible type without title', () => {
            const slide = { name: 'Untitled', type: 'bible' } as Slide
            expect(generateSlideName(slide)).toBe('Bible Slide')
        })

        it('returns "<title>" for bible type with title', () => {
            const slide = { name: 'Untitled', type: 'bible', title: 'John 3:16' } as Slide
            expect(generateSlideName(slide)).toBe('John 3:16')
        })

        it('returns "Text Slide" for text type', () => {
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
            expect(slide.contents).toEqual([''])
            expect(slide.id).toBeDefined()
            // The hook sets alignment to 'left' for text slides
            expect(slide.slideStyle?.alignment).toBe('left')
        })

        it('generates unique IDs across calls', () => {
            const { result } = renderHook(() => useSlideCreation())
            const a = result.current.createTextSlide()
            const b = result.current.createTextSlide()
            expect(a.id).not.toBe(b.id)
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
            // The hook wraps the verse number with <sup> and joins with the scripture text
            const joined = slide.contents.join('\n')
            expect(joined).toContain('For God so loved...')
            expect(joined).toContain('<sup>16</sup>')
        })

        it('creates a bible slide from string content', () => {
            const { result } = renderHook(() => useSlideCreation())

            const scripture: Scripture = {
                label: 'Psalm 23:1',
                labelShortFormat: '19:23:1',
                version: 'NIV',
                content: 'The Lord is my shepherd',
            }

            const slide = result.current.createBibleSlide(scripture)
            const joined = slide.contents.join('\n')
            expect(joined).toContain('The Lord is my shepherd')
            expect(joined).toContain('Psalm 23:1')
            expect(joined).toContain('NIV')
        })

        it('embeds bible version in slideStyle for downstream rendering', () => {
            const { result } = renderHook(() => useSlideCreation())

            const scripture: Scripture = {
                label: 'John 3:16',
                labelShortFormat: '43:3:16',
                version: 'ESV',
                content: [{ book: '43', chapter: '3', verse: '16', scripture: 'For God so loved...' }],
            }

            const slide = result.current.createBibleSlide(scripture)
            expect((slide.slideStyle as { bibleVersion?: string } | undefined)?.bibleVersion).toBe('ESV')
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

        it('preserves top-level properties', () => {
            const { result } = renderHook(() => useSlideCreation())

            const original: Slide = {
                id: 'original',
                index: 5,
                name: 'Test',
                type: 'text',
                layout: 'full-text',
                userId: 'u1',
                churchId: 'c1',
                scheduleId: 's1',
                contents: [],
                background: 'bg.jpg',
                backgroundType: 'image',
            }

            const dup = result.current.duplicateSlide(original)!
            expect(dup.index).toBe(5)
            expect(dup.background).toBe('bg.jpg')
            expect(dup.backgroundType).toBe('image')
            expect(dup.userId).toBe('u1')
            expect(dup.churchId).toBe('c1')
            expect(dup.scheduleId).toBe('s1')
        })
    })
})

describe('generateObjectId', () => {
    it('produces 24-character hex strings', () => {
        const id = generateObjectId()
        expect(id).toMatch(/^[0-9a-f]{24}$/)
    })

    it('produces unique IDs across many calls', () => {
        const ids = new Set<string>()
        for (let i = 0; i < 1000; i++) {
            ids.add(generateObjectId())
        }
        // With 24 hex chars, collisions in 1000 calls are astronomically unlikely
        expect(ids.size).toBe(1000)
    })
})
