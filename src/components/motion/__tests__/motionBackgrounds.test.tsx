import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MOTION_BACKGROUNDS, motionBackgroundFor, seededRandom } from '../motionBackgrounds'
import { MotionCanvas } from '../MotionCanvas'

/** A 2D context that accepts every call, for drawing without a real canvas. */
function fakeContext(): CanvasRenderingContext2D {
    const gradient = { addColorStop: () => {} }
    return new Proxy({} as Record<string, unknown>, {
        get: (target, key) => {
            if (key in target) return target[key as string]
            if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
            return () => {}
        },
        set: (target, key, value) => {
            target[key as string] = value
            return true
        },
    }) as unknown as CanvasRenderingContext2D
}

describe('motion backgrounds', () => {
    it('finds a scene by slide background', () => {
        expect(motionBackgroundFor('motion:galaxy')?.name).toBe('Galaxy')
        expect(motionBackgroundFor('motion:nope')).toBeNull()
        expect(motionBackgroundFor('https://images.unsplash.com/x.jpg')).toBeNull()
        expect(motionBackgroundFor(undefined)).toBeNull()
    })

    it.each(MOTION_BACKGROUNDS)('$name draws frames at projector and thumbnail sizes', (m) => {
        for (const [w, h] of [[1280, 720], [160, 90]]) {
            const state = m.scene.setup(w, h, seededRandom(1))
            for (const t of [0, 1.5, 600]) expect(() => m.scene.draw(fakeContext(), w, h, t, state)).not.toThrow()
        }
    })

    it('draws the same scene from the same seed', () => {
        const a = seededRandom(42)
        const b = seededRandom(42)
        expect([a(), a(), a()]).toEqual([b(), b(), b()])
    })

    it('matches the built-in templates the server seeds', () => {
        // A template naming a scene the app doesn't have would render nothing.
        const server = readFileSync(join(__dirname, '../../../../convex/templates.ts'), 'utf8')
        const seeded = [...server.matchAll(/\["[^"]+", "[^"]+", "([a-z-]+)", "/g)].map((m) => m[1])
        expect(seeded.length).toBeGreaterThan(0)
        for (const id of seeded) expect(motionBackgroundFor(`motion:${id}`), id).not.toBeNull()
    })

    it('renders a canvas that fills its frame', () => {
        const { container } = render(<MotionCanvas background="motion:aurora" />)
        const canvas = container.querySelector('canvas')!
        expect(canvas).toBeTruthy()
        expect(canvas.style.width).toBe('100%')
        expect(canvas.style.height).toBe('100%')
    })

    it('renders nothing for an unknown scene', () => {
        const { container } = render(<MotionCanvas background="motion:nope" />)
        expect(container.querySelector('canvas')).toBeNull()
    })
})
