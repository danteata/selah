import { describe, it, expect } from 'vitest'
import { bibleSlideRange, steppedRange } from '../bibleSlideRange'
import type { Slide } from '../../types'

const bible = (labelShortFormat: string, version = 'KJV') =>
    ({ id: 's', type: 'bible', data: { labelShortFormat, version } }) as unknown as Slide

describe('bibleSlideRange', () => {
    it('reads the book, chapter and verses from the short label', () => {
        expect(bibleSlideRange(bible('43:3:16-18'))).toEqual({
            bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 16, endVerse: 18, version: 'KJV',
        })
        expect(bibleSlideRange(bible('19:23:1'))).toMatchObject({ bookName: 'Psalms', startVerse: 1, endVerse: 1 })
    })

    it('is null for other slides and unreadable labels', () => {
        expect(bibleSlideRange({ id: 's', type: 'song' } as unknown as Slide)).toBeNull()
        expect(bibleSlideRange(bible('43'))).toBeNull()
        expect(bibleSlideRange(null)).toBeNull()
    })
})

describe('steppedRange', () => {
    it('steps by the width of the range', () => {
        const range = bibleSlideRange(bible('43:3:16-18'))!
        expect(steppedRange(range, 'next')).toEqual({ startVerse: 19, endVerse: 21 })
        expect(steppedRange(range, 'prev')).toEqual({ startVerse: 13, endVerse: 15 })
    })

    it('stops at either end of the chapter', () => {
        expect(steppedRange(bibleSlideRange(bible('19:23:1'))!, 'prev')).toBeNull()
        expect(steppedRange(bibleSlideRange(bible('19:23:6'))!, 'next')).toBeNull()
        expect(steppedRange(bibleSlideRange(bible('43:3:2-3'))!, 'prev')).toEqual({ startVerse: 1, endVerse: 2 })
    })
})
