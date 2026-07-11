import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScripture, formatVerseGroups } from '../useScripture'
import type { BibleVerse } from '../../types'

const mockSettings = { defaultBibleVersion: 'KJV' }

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector?: (state: unknown) => unknown) => {
        const state = {
            settings: mockSettings,
            setDefaultBibleVersion: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

// Genesis 1 has 3 verses in this fixture, then Genesis 2 begins — a request
// for more verses than Genesis 1 actually has must not spill into Genesis 2.
const FIXTURE: BibleVerse[] = [
    { book: '1', chapter: '1', verse: '1', scripture: 'In the beginning...' },
    { book: '1', chapter: '1', verse: '2', scripture: 'And the earth was...' },
    { book: '1', chapter: '1', verse: '3', scripture: 'And God said...' },
    { book: '1', chapter: '2', verse: '1', scripture: 'Thus the heavens...' },
    { book: '1', chapter: '2', verse: '2', scripture: 'And on the seventh day...' },
]

let indexedDbData: BibleVerse[] | null = null

vi.mock('../useIndexedDB', () => ({
    getIndexedDB: () => ({
        bibleAndHymns: {
            get: vi.fn(async () => (indexedDbData ? { id: 'KJV', data: indexedDbData } : undefined)),
            put: vi.fn(async () => undefined),
        },
    }),
}))

describe('useScripture — fetchScripture range clamping', () => {
    it('clamps a verse range that requests more verses than the chapter has', async () => {
        indexedDbData = FIXTURE
        const { result } = renderHook(() => useScripture())

        const scripture = await result.current.fetchScripture('1:1:1-999')

        expect(scripture).not.toBeNull()
        // Only 3 real verses exist in Genesis 1 in this fixture — must not
        // spill into Genesis 2's content.
        const content = scripture!.content as BibleVerse[]
        expect(content).toHaveLength(3)
        expect(content.every((v) => Number(v.chapter) === 1)).toBe(true)
        // The label must reflect what was actually returned, not the
        // originally-requested (out-of-range) end verse.
        expect(scripture!.label).toBe('Genesis 1:1-3')
    })

    it('returns the exact range when it fits entirely within the chapter', async () => {
        indexedDbData = FIXTURE
        const { result } = renderHook(() => useScripture())

        const scripture = await result.current.fetchScripture('1:1:1-2')

        expect(scripture).not.toBeNull()
        expect(scripture!.content).toHaveLength(2)
        expect(scripture!.label).toBe('Genesis 1:1-2')
    })

    it('returns a single verse unaffected by clamping', async () => {
        indexedDbData = FIXTURE
        const { result } = renderHook(() => useScripture())

        const scripture = await result.current.fetchScripture('1:1:2')

        expect(scripture).not.toBeNull()
        expect(scripture!.content).toHaveLength(1)
        expect(scripture!.label).toBe('Genesis 1:2')
    })
})

describe('formatVerseGroups', () => {
    it('groups consecutive runs and separates gaps with a comma', () => {
        expect(formatVerseGroups([10, 11, 12, 14, 17])).toBe('10-12, 14, 17')
    })

    it('formats a single contiguous run without a trailing comma list', () => {
        expect(formatVerseGroups([5, 6, 7])).toBe('5-7')
    })

    it('formats a single verse as just the number', () => {
        expect(formatVerseGroups([5])).toBe('5')
    })

    it('de-duplicates and sorts unordered input', () => {
        expect(formatVerseGroups([3, 1, 2, 1])).toBe('1-3')
    })
})

describe('useScripture — fetchScriptureByVerseNumbers (sparse selection)', () => {
    it('fetches a non-contiguous set of verse numbers and merges them into one Scripture', async () => {
        indexedDbData = FIXTURE
        const { result } = renderHook(() => useScripture())

        const scripture = await result.current.fetchScriptureByVerseNumbers(1, 1, [1, 3])

        expect(scripture).not.toBeNull()
        const content = scripture!.content as BibleVerse[]
        expect(content.map((v) => v.verse)).toEqual(['1', '3'])
        expect(scripture!.label).toBe('Genesis 1:1, 3')
        // labelShortFormat stays a plain bounding range, not the sparse form —
        // existing parsers (BibleList.tsx, BibleVerseNavigator.tsx) expect
        // exactly "book:chapter:start(-end)".
        expect(scripture!.labelShortFormat).toBe('1:1:1-3')
    })

    it('never attributes a verse from a different chapter to the requested one', async () => {
        indexedDbData = FIXTURE
        const { result } = renderHook(() => useScripture())

        // Genesis 1 only has verses 1-3 in the fixture; verse 1 of chapter 2
        // must not leak into a chapter-1 request even though "1" is requested.
        const scripture = await result.current.fetchScriptureByVerseNumbers(1, 1, [1, 99])

        expect(scripture).not.toBeNull()
        const content = scripture!.content as BibleVerse[]
        expect(content).toHaveLength(1)
        expect(content[0].verse).toBe('1')
    })
})
