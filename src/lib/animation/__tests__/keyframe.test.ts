import { describe, expect, it } from 'vitest'
import { bez, easeProgress, eased, evaluate, evaluateNumber, hold, key, setKey, velocity, type Ease, type Keyframe } from '../keyframe'

// Expected values carried over from effectcraft's keyframe tests.

describe('keyframe evaluation', () => {
    it('matches live After Effects with overlapping influences', () => {
        // Original Rotation probe via AEsync 2.0.4, AE 26.3x87, 2026-10-05.
        // AE retains each handle's requested influence even when their sum exceeds 100%.
        const cases: [number, number, number, number, number, number, [number, number][]][] = [
            [0, 100, 0, 0.8, 0, 0.8, [[0.1, 0.59243939036327], [0.25, 4.76438030608764], [0.4, 18.4284394271562], [0.75, 95.2356196939123]]],
            [0, 100, 20, 0.8, 80, 0.6, [[0.1, 2.25754942621577], [0.25, 6.99841889412931], [0.4, 14.9334636959052], [0.75, 73.8196785378389]]],
            [100, 0, -20, 0.6, -80, 0.8, [[0.1, 97.6395466334594], [0.25, 91.597048571292], [0.4, 74.5367957474338], [0.75, 22.3789127753126]]],
        ]
        for (const [from, to, outSpeed, outInf, inSpeed, inInf, samples] of cases) {
            const a: Keyframe = { ...key(0, from), outInterp: 'bezier', outEase: [{ speed: outSpeed, influence: outInf }] }
            const b: Keyframe = { ...key(1, to), inInterp: 'bezier', inEase: [{ speed: inSpeed, influence: inInf }] }
            for (const [time, expected] of samples) {
                expect(Math.abs(evaluateNumber([a, b], time) - expected)).toBeLessThan(1e-7)
                const normalized = easeProgress(outSpeed / (to - from), outInf, inSpeed / (to - from), inInf, time)
                expect(Math.abs(from + normalized * (to - from) - expected)).toBeLessThan(1e-7)
            }
        }
    })

    it('resolves the flat midpoint of a 100%/100% time curve', () => {
        for (const time of [0.5 - 1e-9, 0.5 - 1e-12, 0.5, 0.5 + 1e-12, 0.5 + 1e-9]) {
            // At 100%/100%, x = 0.5 + 4*(u - 0.5)^3 exactly.
            const u = 0.5 + Math.cbrt((time - 0.5) / 4)
            const expected = bez(0, 0, 1, 1, u)
            expect(Math.abs(easeProgress(0, 1, 0, 1, time) - expected)).toBeLessThan(1e-10)
        }
    })

    it('interpolates linearly, clamps outside the keys, and holds', () => {
        const keys = [key(0, 0), key(2, 100)]
        expect(evaluate(keys, 1)).toBe(50)
        expect(evaluate(keys, -1)).toBe(0)
        expect(evaluate(keys, 3)).toBe(100)
        const held = [hold(key(0, 0)), key(2, 100)]
        expect(evaluate(held, 1.999)).toBe(0)
        expect(evaluate([], 1)).toBeUndefined()
    })

    it('keeps the segment into a hold key linear', () => {
        // Hold on the second key holds what comes after it, not the motion into it.
        expect(evaluate([key(0, 0), hold(key(2, 100))], 0.5)).toBe(25)
    })

    it('makes Easy Ease symmetric and slow at the ends', () => {
        const keys = [eased(key(0, 0)), eased(key(1, 100))]
        expect(Math.abs(evaluateNumber(keys, 0.5) - 50)).toBeLessThan(1e-6)
        const early = evaluateNumber(keys, 0.1)
        expect(early).toBeGreaterThan(0)
        expect(early).toBeLessThan(10)
        expect(velocity(keys, 0.01)[0]).toBeLessThan(velocity(keys, 0.5)[0])
    })

    it('matches linear when a Bezier ease has the linear speed', () => {
        const linearEase: Ease = { speed: 50, influence: 1 / 3 }
        const keys: Keyframe[] = [
            { ...key(0, 0), outInterp: 'bezier', outEase: [linearEase] },
            { ...key(2, 100), inInterp: 'bezier', inEase: [linearEase] },
        ]
        for (let i = 0; i <= 20; i++) {
            const t = i * 0.1
            expect(Math.abs(evaluateNumber(keys, t) - 50 * t)).toBeLessThan(1e-6)
        }
    })

    it('interpolates each dimension of a list value', () => {
        expect(evaluate([key(0, [0, 0, 0, 1]), key(1, [1, 0.5, 0, 1])], 0.5)).toEqual([0.5, 0.25, 0, 1])
    })

    it('replaces a key at the same time, keeping its interpolation', () => {
        const keys: Keyframe[] = []
        setKey(keys, eased(key(1, 1)))
        setKey(keys, key(0, 0))
        setKey(keys, key(1, 5))
        expect(keys).toHaveLength(2)
        expect(keys[1].value).toBe(5)
        expect(keys[1].inInterp).toBe('bezier')
    })

    it('keeps eased values within their range', () => {
        // A seeded sweep standing in for upstream's property test.
        let seed = 1
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let n = 0; n < 500; n++) {
            const t = random()
            const a: Keyframe = { ...eased(key(0, 0)), outEase: [{ speed: 0, influence: 0.01 + random() * 0.99 }] }
            const b: Keyframe = { ...eased(key(1, 10)), inEase: [{ speed: 0, influence: 0.01 + random() * 0.99 }] }
            const v = evaluateNumber([a, b], t)
            expect(v).toBeGreaterThanOrEqual(-1e-9)
            expect(v).toBeLessThanOrEqual(10 + 1e-9)
        }
    })
})
