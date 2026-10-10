/**
 * Browser-side helpers for golden-image tests. See `commands.ts` for the
 * comparison itself and how to re-record.
 */

import { commands, page } from '@vitest/browser/context'
import { expect } from 'vitest'
import type { GoldenResult, GoldenTolerance } from './commands'

declare module '@vitest/browser/context' {
    interface BrowserCommands {
        compareGolden: (name: string, png: string, tolerance: GoldenTolerance) => Promise<GoldenResult>
    }
}

/** Golden frame size: big enough to read, small enough to commit. */
export const GOLDEN_WIDTH = 640
export const GOLDEN_HEIGHT = 360

export function goldenCanvas(width = GOLDEN_WIDTH, height = GOLDEN_HEIGHT): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

/** Compare a canvas, or an element's screenshot, with its golden. */
export async function expectGolden(
    name: string,
    source: HTMLCanvasElement | HTMLElement,
    tolerance: GoldenTolerance,
): Promise<void> {
    const png = source instanceof HTMLCanvasElement
        ? source.toDataURL('image/png')
        : await page.screenshot({ element: source, save: false })
    const result = await commands.compareGolden(name, png, tolerance)
    expect(result.pass, result.message).toBe(true)
}

/**
 * Load a font's faces and fail if they didn't arrive. A golden rendered in a
 * fallback font would pass against itself and mean nothing.
 */
export async function requireFont(family: string, weights: string[] = ['400', '600', '700']): Promise<void> {
    for (const weight of weights) {
        const spec = `${weight} 32px "${family}"`
        await document.fonts.load(spec)
        expect(document.fonts.check(spec), `${family} ${weight} did not load`).toBe(true)
    }
}
