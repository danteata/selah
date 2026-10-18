import { describe, it, expect } from 'vitest'
import { heardVersesFrom, heardAgo, MAX_HEARD_VERSES } from '../heardVerses'
import type { DetectedVerse } from '../verseDetection'

function verse(reference: string, at: number | undefined, over: Partial<DetectedVerse> = {}): DetectedVerse {
    const [book, cv] = reference.split(' ')
    const [chapter, v] = cv.split(':').map(Number)
    return {
        raw: reference, reference, book, chapter, verseStart: v, startIndex: 0, endIndex: 0,
        confidence: 'high', isBestMatch: true, lastActivatedAt: at, ...over,
    }
}

describe('heardVersesFrom', () => {
    it('lists the newest first, once per reference, at its latest hearing', () => {
        const heard = heardVersesFrom([verse('John 3:16', 1), verse('Romans 8:28', 2), verse('John 3:16', 3)], 'KJV')
        expect(heard.map((h) => [h.reference, h.heardAt])).toEqual([['John 3:16', 3], ['Romans 8:28', 2]])
        expect(heard[0].version).toBe('KJV')
    })

    it('leaves out alternatives and anything without a time', () => {
        const heard = heardVersesFrom([verse('John 3:16', 1, { isBestMatch: false }), verse('Romans 8:28', undefined)], 'KJV')
        expect(heard).toEqual([])
    })

    it(`keeps the newest ${MAX_HEARD_VERSES}`, () => {
        const many = Array.from({ length: 8 }, (_, i) => verse(`Psalms 23:${i + 1}`, i))
        const heard = heardVersesFrom(many, undefined)
        expect(heard).toHaveLength(MAX_HEARD_VERSES)
        expect(heard[0].reference).toBe('Psalms 23:8')
        expect(heard[0]).not.toHaveProperty('version')
    })

    it('carries a range, but not a one-verse "range"', () => {
        const [range] = heardVersesFrom([verse('John 3:16', 1, { verseEnd: 18 })], undefined)
        expect(range.verseEnd).toBe(18)
        const [single] = heardVersesFrom([verse('John 3:16', 1, { verseEnd: 16 })], undefined)
        expect(single).not.toHaveProperty('verseEnd')
    })
})

describe('heardAgo', () => {
    it('reads naturally', () => {
        expect(heardAgo(1000, 5000)).toBe('just now')
        expect(heardAgo(0, 40_000)).toBe('40s ago')
        expect(heardAgo(0, 180_000)).toBe('3m ago')
    })
})
