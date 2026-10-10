import { describe, expect, it } from 'vitest'
import { DEFAULT_RANGE, ease, modeCombine, modeInitial, rangeValue, type Range, type Shape } from '../textSelectors'

// Expected values carried over from effectcraft's selector tests.

const r = (start: number, end: number, shape: Shape): Range => ({ ...DEFAULT_RANGE, start, end, shape })
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('range selector', () => {
    it('covers units partially, with smoothness', () => {
        // 4 units, range 0..0.375: unit 0 fully, 1 half (smoothness 100%), 2 none.
        const rg = r(0, 0.375, 'square')
        close(rangeValue(rg, 0, 4), 1)
        close(rangeValue(rg, 1, 4), 0.5)
        expect(rangeValue(rg, 2, 4)).toBe(0)
        // Smoothness 0: a hard edge at the unit centre.
        const hard = { ...rg, smoothness: 0 }
        expect(rangeValue(hard, 1, 4)).toBe(1)
        expect(rangeValue({ ...hard, end: 0.3 }, 1, 4)).toBe(0)
        // Everything selected by default.
        for (let i = 0; i < 7; i++) close(rangeValue(DEFAULT_RANGE, i, 7), 1)
    })

    it('profiles each shape', () => {
        const n = 5
        const up = Array.from({ length: n }, (_, i) => rangeValue(r(0, 1, 'rampUp'), i, n))
        up.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(up[i]))
        close(up[0], 0.1)
        close(up[4], 0.9)
        close(rangeValue(r(0, 1, 'rampDown'), 0, n), 0.9)
        const tri = Array.from({ length: n }, (_, i) => rangeValue(r(0, 1, 'triangle'), i, n))
        close(tri[2], 1)
        close(tri[0], tri[4])
        expect(tri[0]).toBeLessThan(0.5)
        expect(rangeValue(r(0, 1, 'round'), 0, n)).toBeGreaterThan(tri[0])
        expect(rangeValue(r(0, 1, 'smooth'), 0, n)).toBeLessThan(tri[0])
        // Ramp Up holds after the end, Ramp Down before the start; others are 0 outside.
        expect(rangeValue(r(0, 0.2, 'rampUp'), 4, n)).toBe(1)
        expect(rangeValue(r(0.8, 1, 'rampDown'), 0, n)).toBe(1)
        expect(rangeValue(r(0, 0.2, 'triangle'), 4, n)).toBe(0)
        // Offset moves the range.
        const off = { ...r(0, 0.2, 'square'), offset: 0.6 }
        expect(rangeValue(off, 0, n)).toBe(0)
        close(rangeValue(off, 3, n), 1)
        // Amount scales, and may invert.
        close(rangeValue({ ...DEFAULT_RANGE, amount: -0.5 }, 2, n), -0.5)
    })

    it('eases high and low', () => {
        expect(ease(0.3, 0, 0)).toBe(0.3)
        expect(Math.abs(ease(0, 1, 1))).toBeLessThan(1e-12)
        expect(Math.abs(ease(1, 1, 1) - 1)).toBeLessThan(1e-12)
        // Ease Low 100% flattens the start, Ease High 100% the top.
        expect(ease(0.1, 0, 1)).toBeLessThan(0.1)
        expect(ease(0.9, 1, 0)).toBeGreaterThan(0.9)
        // Negative makes it abrupt.
        expect(ease(0.1, 0, -1)).toBeGreaterThan(0.1)
        // Monotonic.
        const v = Array.from({ length: 21 }, (_, i) => ease(i / 20, -1, 1))
        v.slice(1).forEach((x, i) => expect(x).toBeGreaterThanOrEqual(v[i]))
    })

    it('combines selectors by mode', () => {
        expect(modeCombine('add', 0.5, 0.75)).toBe(1)
        expect(modeCombine('subtract', 1, 0.25)).toBe(0.75)
        expect(modeCombine('intersect', 0.5, 0.5)).toBe(0.25)
        expect(modeCombine('min', 0.3, 0.6)).toBe(0.3)
        expect(modeCombine('max', 0.3, 0.6)).toBe(0.6)
        close(modeCombine('difference', 0.3, 1), 0.7)
        // A lone subtract inverts.
        expect(modeCombine('subtract', modeInitial('subtract'), 1)).toBe(0)
        expect(modeCombine('subtract', modeInitial('subtract'), 0)).toBe(1)
    })
})
