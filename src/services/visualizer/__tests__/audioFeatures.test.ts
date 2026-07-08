import { describe, it, expect, beforeEach } from 'vitest'
import { extractBands, audioFeatures, ZERO_FEATURES } from '../audioFeatures'

describe('extractBands', () => {
    it('returns zeros for an empty array', () => {
        expect(extractBands(new Uint8Array(0))).toEqual(ZERO_FEATURES)
    })

    it('detects bass energy concentrated in the low bins', () => {
        const arr = new Uint8Array(100)
        for (let i = 0; i < 15; i++) arr[i] = 255 // fill the bass band (0..15%)
        const f = extractBands(arr)
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.treble).toBe(0)
        expect(f.mid).toBe(0)
    })

    it('detects treble energy concentrated in the high bins', () => {
        const arr = new Uint8Array(100)
        for (let i = 60; i < 100; i++) arr[i] = 255 // top 40% loud
        const f = extractBands(arr)
        expect(f.treble).toBeGreaterThan(0.9)
        expect(f.bass).toBe(0)
    })

    it('produces a full-scale rms for a saturated spectrum', () => {
        const arr = new Uint8Array(64).fill(255)
        const f = extractBands(arr)
        expect(f.rms).toBeCloseTo(1, 5)
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.mid).toBeCloseTo(1, 5)
        expect(f.treble).toBeCloseTo(1, 5)
    })

    it('clamps all bands to 0..1', () => {
        const arr = new Uint8Array(50).fill(128)
        const f = extractBands(arr)
        for (const v of Object.values(f)) {
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
        }
    })

    it('honours custom band boundaries', () => {
        const arr = new Uint8Array(100)
        for (let i = 0; i < 50; i++) arr[i] = 255
        // With bassEnd at 50%, all the energy is bass.
        const f = extractBands(arr, { bassEnd: 0.5, midEnd: 0.75 })
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.treble).toBe(0)
    })
})

describe('audioFeatureBus', () => {
    beforeEach(() => audioFeatures.reset())

    it('is stale after reset', () => {
        expect(audioFeatures.isStale()).toBe(true)
        expect(audioFeatures.current).toEqual(ZERO_FEATURES)
    })

    it('publishes the latest features and clears staleness', () => {
        const arr = new Uint8Array(64).fill(200)
        audioFeatures.publish(arr)
        expect(audioFeatures.current.rms).toBeGreaterThan(0)
        expect(audioFeatures.isStale()).toBe(false)
    })

    it('resets back to zero', () => {
        audioFeatures.publish(new Uint8Array(64).fill(255))
        audioFeatures.reset()
        expect(audioFeatures.current).toEqual(ZERO_FEATURES)
    })
})
