import { describe, it, expect } from 'vitest'
import type { SerializedDockview } from 'dockview-react'
import { layoutSignature, sameArrangement } from '../layoutSignature'

type Node = { type: 'leaf'; data: { views: string[]; activeView?: string; id: string }; size: number } | { type: 'branch'; data: Node[]; size: number }

const leaf = (views: string[], size: number, activeView = views[0]): Node => ({ type: 'leaf', data: { views, activeView, id: views.join('-') }, size })
const branch = (data: Node[], size = 0): Node => ({ type: 'branch', data, size })
const layout = (root: Node, width = 1200): SerializedDockview =>
    ({ grid: { root, width, height: 800, orientation: 'HORIZONTAL' }, panels: {} }) as unknown as SerializedDockview

describe('layoutSignature', () => {
    const base = layout(branch([leaf(['serviceOrder'], 300), leaf(['live'], 600), leaf(['bible', 'music'], 300)]))

    it('ignores pixel sizes, the window, and which tab is in front', () => {
        const scaled = layout(branch([leaf(['serviceOrder'], 400), leaf(['live'], 800), leaf(['bible', 'music'], 400, 'music')]), 1600)
        expect(layoutSignature(scaled)).toBe(layoutSignature(base))
    })

    it('ignores a nudge smaller than the rounding step', () => {
        const nudged = layout(branch([leaf(['serviceOrder'], 310), leaf(['live'], 590), leaf(['bible', 'music'], 300)]))
        expect(layoutSignature(nudged)).toBe(layoutSignature(base))
    })

    it('notices a real resize', () => {
        const resized = layout(branch([leaf(['serviceOrder'], 500), leaf(['live'], 400), leaf(['bible', 'music'], 300)]))
        expect(layoutSignature(resized)).not.toBe(layoutSignature(base))
    })

    it('notices a panel moved to another stack, reordered, or split off', () => {
        const moved = layout(branch([leaf(['serviceOrder', 'bible'], 300), leaf(['live'], 600), leaf(['music'], 300)]))
        const reordered = layout(branch([leaf(['serviceOrder'], 300), leaf(['live'], 600), leaf(['music', 'bible'], 300)]))
        const split = layout(branch([leaf(['serviceOrder'], 300), branch([leaf(['live'], 400), leaf(['bible', 'music'], 200)], 600)]))
        for (const changed of [moved, reordered, split]) {
            expect(layoutSignature(changed)).not.toBe(layoutSignature(base))
        }
    })
})

describe('sameArrangement', () => {
    const a = layout(branch([leaf(['serviceOrder'], 300), leaf(['live'], 600)]))
    const resized = layout(branch([leaf(['serviceOrder'], 600), leaf(['live'], 300)]))
    const moved = layout(branch([leaf(['live'], 600), leaf(['serviceOrder'], 300)]))

    it('is true when only proportions differ, false when panels moved', () => {
        expect(sameArrangement(layoutSignature(a), layoutSignature(resized))).toBe(true)
        expect(sameArrangement(layoutSignature(a), layoutSignature(moved))).toBe(false)
    })
})
