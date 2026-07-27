import { describe, it, expect } from 'vitest'
import { findQueuedBibleSlide } from '../findQueuedBibleSlide'
import type { Scripture, Slide } from '../../types'

/** A scripture spanning `start`..`end` of one chapter. Book/chapter are the raw ids slide data carries. */
function scripture(label: string, book: string, chapter: string, start: number, end = start, version = 'kjv'): Scripture {
    const content = []
    for (let verse = start; verse <= end; verse++) {
        content.push({ book, chapter, verse: String(verse), scripture: `text ${verse}` })
    }
    return { label, labelShortFormat: label, version, content }
}

function bibleSlide(id: string, data: Scripture): Slide {
    return {
        id,
        index: 0,
        name: data.label,
        type: 'bible',
        layout: 'bible',
        userId: 'u',
        churchId: 'c',
        scheduleId: 's',
        contents: [data.label],
        title: data.label,
        data,
    }
}

const proverbs24_3 = scripture('Proverbs 24:3', '20', '24', 3)
const proverbs24_3to4 = scripture('Proverbs 24:3-4', '20', '24', 3, 4)
const psalms34_7 = scripture('Psalms 34:7', '19', '34', 7)
const psalms34_7to8 = scripture('Psalms 34:7-8', '19', '34', 7, 8)
const joshua24_1 = scripture('Joshua 24:1', '6', '24', 1)
const joshua24_15 = scripture('Joshua 24:15', '6', '24', 15)

describe('findQueuedBibleSlide', () => {
    it('finds the slide already queued for the reference', () => {
        const slides = [bibleSlide('a', psalms34_7), bibleSlide('b', proverbs24_3to4)]
        const match = findQueuedBibleSlide(slides, proverbs24_3to4, ['a', 'b'])
        expect(match?.slide.id).toBe('b')
        expect(match?.needsRefresh).toBe(false)
    })

    it('matches across versions so a version switch reuses the entry', () => {
        const slides = [bibleSlide('a', scripture('Psalms 34:7', '19', '34', 7, 7, 'niv'))]
        expect(findQueuedBibleSlide(slides, psalms34_7, ['a'])?.slide.id).toBe('a')
    })

    it('returns undefined when the reference is not queued', () => {
        const slides = [bibleSlide('a', psalms34_7)]
        expect(findQueuedBibleSlide(slides, scripture('John 3:16', '43', '3', 16), ['a'])).toBeUndefined()
    })

    it('ignores non-bible slides with the same title', () => {
        const song = { ...bibleSlide('a', psalms34_7), type: 'song', data: undefined }
        expect(findQueuedBibleSlide([song], psalms34_7, ['a'])).toBeUndefined()
    })

    it('widens a queued narrower span of the same chapter', () => {
        // "Proverbs 24" then "three through four" navigates to 24:3; the regex
        // pass then resolves the full 24:3-4 range from the same sentence.
        const slides = [bibleSlide('a', proverbs24_3)]
        const match = findQueuedBibleSlide(slides, proverbs24_3to4, ['a'])
        expect(match?.slide.id).toBe('a')
        expect(match?.needsRefresh).toBe(true)
    })

    it('widens on the leading edge too', () => {
        const slides = [bibleSlide('a', psalms34_7to8)]
        const match = findQueuedBibleSlide(slides, scripture('Psalms 34:6-8', '19', '34', 6, 8), ['a'])
        expect(match?.slide.id).toBe('a')
        expect(match?.needsRefresh).toBe(true)
    })

    it('does not narrow a queued range down to one verse inside it', () => {
        const slides = [bibleSlide('a', psalms34_7to8)]
        expect(findQueuedBibleSlide(slides, psalms34_7, ['a'])).toBeUndefined()
    })

    it('does not treat a partial overlap as widening', () => {
        const slides = [bibleSlide('a', scripture('Psalms 34:7-8', '19', '34', 7, 8))]
        expect(findQueuedBibleSlide(slides, scripture('Psalms 34:8-9', '19', '34', 8, 9), ['a'])).toBeUndefined()
    })

    it('does not widen across a chapter boundary', () => {
        const slides = [bibleSlide('a', scripture('Psalms 35:1', '19', '35', 1))]
        expect(findQueuedBibleSlide(slides, scripture('Psalms 34:7-8', '19', '34', 7, 8), ['a'])).toBeUndefined()
    })

    it('rewrites the placeholder slide the caller asks it to supersede', () => {
        // Bare "Joshua 24" queued verse 1; "verse 15" is the reference actually
        // announced, so it takes over that entry instead of adding a second.
        const slides = [bibleSlide('a', joshua24_1)]
        const match = findQueuedBibleSlide(slides, joshua24_15, ['a'], 'Joshua 24:1')
        expect(match?.slide.id).toBe('a')
        expect(match?.needsRefresh).toBe(true)
    })

    it('leaves a verse-1 slide alone when it was not named as a placeholder', () => {
        const slides = [bibleSlide('a', joshua24_1)]
        expect(findQueuedBibleSlide(slides, joshua24_15, ['a'])).toBeUndefined()
    })

    it('prefers the exact reference over a placeholder to supersede', () => {
        const slides = [bibleSlide('a', joshua24_1), bibleSlide('b', joshua24_15)]
        const match = findQueuedBibleSlide(slides, joshua24_15, ['a', 'b'], 'Joshua 24:1')
        expect(match?.slide.id).toBe('b')
        expect(match?.needsRefresh).toBe(false)
    })

    it('does not revive a slide the operator dropped from the live output order', () => {
        const slides = [bibleSlide('a', psalms34_7)]
        expect(findQueuedBibleSlide(slides, psalms34_7, ['other'])).toBeUndefined()
    })

    it('treats a null output order as "everything active is queued"', () => {
        const slides = [bibleSlide('a', psalms34_7)]
        expect(findQueuedBibleSlide(slides, psalms34_7, null)?.slide.id).toBe('a')
    })

    it('returns undefined for a scripture with no label', () => {
        const slides = [bibleSlide('a', psalms34_7)]
        expect(findQueuedBibleSlide(slides, undefined, null)).toBeUndefined()
    })

    it('falls back to label matching for string-content scripture', () => {
        const stringContent: Scripture = {
            label: 'Psalms 34:7',
            labelShortFormat: 'Ps 34:7',
            version: 'kjv',
            content: 'The angel of the LORD encampeth round about them that fear him',
        }
        expect(findQueuedBibleSlide([bibleSlide('a', stringContent)], stringContent, null)?.slide.id).toBe('a')
    })
})
