import { describe, expect, it } from 'vitest'
import { paintCssGradient, parseCssGradient, resolveStops } from '../cssGradient'

describe('parseCssGradient', () => {
    it('reads an angled linear gradient with positioned stops', () => {
        expect(parseCssGradient('linear-gradient(135deg, #667eea 0%, #764ba2 100%)')).toEqual({
            kind: 'linear',
            angleDeg: 135,
            stops: [{ color: '#667eea', offset: 0 }, { color: '#764ba2', offset: 1 }],
        })
    })

    it('reads side keywords, defaults to top-to-bottom, and keeps rgb() whole', () => {
        expect(parseCssGradient('linear-gradient(to right, red, blue)')?.kind).toBe('linear')
        expect(parseCssGradient('linear-gradient(to right, red, blue)')).toMatchObject({ angleDeg: 90 })
        expect(parseCssGradient('linear-gradient(rgb(1, 2, 3), rgba(4, 5, 6, 0.5))')).toEqual({
            kind: 'linear',
            angleDeg: 180,
            stops: [{ color: 'rgb(1, 2, 3)', offset: null }, { color: 'rgba(4, 5, 6, 0.5)', offset: null }],
        })
    })

    it('reads a radial gradient, dropping its shape clause', () => {
        expect(parseCssGradient('radial-gradient(circle at center, #fff 0%, #000 100%)')).toEqual({
            kind: 'radial',
            stops: [{ color: '#fff', offset: 0 }, { color: '#000', offset: 1 }],
        })
    })

    it('is null for anything else', () => {
        expect(parseCssGradient('#ffffff')).toBeNull()
        expect(parseCssGradient('photo.jpg')).toBeNull()
        expect(parseCssGradient('linear-gradient(red)')).toBeNull()
    })
})

describe('resolveStops', () => {
    it('spreads unpositioned stops evenly between their neighbours', () => {
        expect(resolveStops([{ color: 'a', offset: null }, { color: 'b', offset: null }, { color: 'c', offset: null }]).map((s) => s.offset))
            .toEqual([0, 0.5, 1])
        expect(resolveStops([{ color: 'a', offset: 0 }, { color: 'b', offset: null }, { color: 'c', offset: null }, { color: 'd', offset: 0.9 }]).map((s) => s.offset))
            .toEqual([0, 0.3, 0.6, 0.9])
    })
})

describe('paintCssGradient', () => {
    it('lays a 90° gradient across the frame, through its centre', () => {
        const calls: unknown[] = []
        const ctx = {
            createLinearGradient: (...args: number[]) => {
                calls.push(args.map((n) => Math.round(n)))
                return { addColorStop: (o: number, c: string) => calls.push([o, c]) }
            },
            fillStyle: '' as string | object,
            fillRect: () => calls.push('fill'),
        }
        const g = parseCssGradient('linear-gradient(90deg, red, blue)')
        if (!g) throw new Error('parse failed')
        paintCssGradient(ctx, g, 200, 100)
        expect(calls).toEqual([[0, 50, 200, 50], [0, 'red'], [1, 'blue'], 'fill'])
    })
})
