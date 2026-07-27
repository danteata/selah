import { describe, it, expect } from 'vitest'
import { stripEphemeralBackground } from '../useLocalBackground'

describe('stripEphemeralBackground', () => {
    // A blob: URL only resolves inside the process that minted it. Persisting
    // one into a template meant every later session reloaded a slide pointing
    // at a dead URL — observed as net::ERR_FILE_NOT_FOUND with the SAME uuid
    // recurring across separate runs.
    it('drops a blob: background', () => {
        const slide = { background: 'blob:http://localhost:3000/abc-123', backgroundType: 'image' }
        expect(stripEphemeralBackground(slide)).toEqual({ background: '', backgroundType: 'image' })
    })

    it('keeps backgroundStorageId so the background can be re-resolved', () => {
        const slide = { background: 'blob:http://localhost:3000/abc', backgroundStorageId: 'kg2abc' }
        const cleaned = stripEphemeralBackground(slide)
        expect(cleaned.background).toBe('')
        expect(cleaned.backgroundStorageId).toBe('kg2abc')
    })

    it('leaves durable backgrounds untouched, by reference', () => {
        // Returning the same reference is what lets callers skip a needless
        // JSON re-stringify when there was nothing to strip.
        for (const background of [
            'https://cdn.example.com/bg.jpg',
            'asset://localhost/Users/me/bg.png',
            'data:image/png;base64,iVBORw0KGgo=',
            'linear-gradient(180deg, #000, #fff)',
            '#112233',
            '',
        ]) {
            const slide = { background }
            expect(stripEphemeralBackground(slide)).toBe(slide)
        }
    })

    it('passes through values that are not slide objects', () => {
        expect(stripEphemeralBackground(null)).toBeNull()
        expect(stripEphemeralBackground(undefined)).toBeUndefined()
        expect(stripEphemeralBackground('not-a-slide')).toBe('not-a-slide')
    })

    it('ignores a non-string background', () => {
        const slide = { background: 42 }
        expect(stripEphemeralBackground(slide)).toBe(slide)
    })
})
