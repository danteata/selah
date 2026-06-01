import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AutoFitText } from '../AutoFitText'

/**
 * jsdom has no layout engine, so `scrollWidth`/`scrollHeight` and `clientWidth`/`clientHeight`
 * default to 0. We stub them per-test to simulate "content overflows" vs "content fits"
 * and assert that AutoFitText writes a sensible font-size to the measurement node.
 */

interface MockMetrics {
    /** Pixel width threshold at which content starts overflowing horizontally. */
    overflowAtPx: number
    container: { width: number; height: number }
}

function installLayoutMocks(metrics: MockMetrics) {
    // Container size — read once per fit() call.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
            // The outer container has display: flex (set by AutoFitText). The inner
            // measure node has width: 100%. We tag them by role of currentSize:
            // outer = no inline fontSize set by us; inner = has inline fontSize.
            if (!this.style.fontSize) return metrics.container.width
            // Inner measure node — width matches container.
            return metrics.container.width
        },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
            if (!this.style.fontSize) return metrics.container.height
            return metrics.container.height
        },
    })
    // scrollWidth/scrollHeight grow linearly with font-size, hitting overflow at `overflowAtPx`.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get(this: HTMLElement) {
            const px = parseFloat(this.style.fontSize || '0')
            if (!px) return 0
            // Pretend text width scales linearly with font-size from baseline 1px == 1 unit.
            return Math.round((px / metrics.overflowAtPx) * metrics.container.width)
        },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
            const px = parseFloat(this.style.fontSize || '0')
            if (!px) return 0
            return Math.round((px / metrics.overflowAtPx) * metrics.container.height)
        },
    })
}

describe('AutoFitText', () => {
    beforeEach(() => {
        // Reset overrides between tests.
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
        Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
        // Stub ResizeObserver — jsdom doesn't ship one.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(globalThis as any).ResizeObserver = class {
            observe() { /* noop */ }
            unobserve() { /* noop */ }
            disconnect() { /* noop */ }
        }
    })

    it('renders the supplied HTML', () => {
        installLayoutMocks({ overflowAtPx: 1000, container: { width: 500, height: 200 } })
        const { container } = render(<AutoFitText html="<p>Hello</p>" minPx={12} maxPx={120} />)
        expect(container.querySelector('p')?.textContent).toBe('Hello')
    })

    it('pins to minPx when html is empty', () => {
        installLayoutMocks({ overflowAtPx: 1000, container: { width: 500, height: 200 } })
        const { container } = render(<AutoFitText html="" minPx={16} maxPx={120} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('16px')
    })

    it('pins to minPx when html is only whitespace tags', () => {
        installLayoutMocks({ overflowAtPx: 1000, container: { width: 500, height: 200 } })
        const { container } = render(<AutoFitText html="<p>&nbsp;</p><p>   </p>" minPx={20} maxPx={120} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('20px')
    })

    it('chooses maxPx when even the largest size fits', () => {
        // overflow only triggers above 10 000 px — so 120 px must fit easily.
        installLayoutMocks({ overflowAtPx: 10_000, container: { width: 500, height: 200 } })
        const { container } = render(<AutoFitText html="<p>tiny</p>" minPx={12} maxPx={120} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('120px')
    })

    it('binary-searches to the largest font-size that fits', () => {
        // Width-only overflow at exactly 50 px in a 500 px container → 50 px should be the answer.
        installLayoutMocks({ overflowAtPx: 50, container: { width: 500, height: 5_000 } })
        const { container } = render(<AutoFitText html="<p>medium length text</p>" minPx={12} maxPx={200} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        const px = parseFloat(measure.style.fontSize)
        // 14 iterations of binary search over [12, 200] should land within ~1 px of 50.
        expect(px).toBeGreaterThanOrEqual(48)
        expect(px).toBeLessThanOrEqual(50)
    })

    it('pins to minPx and clips when even minPx overflows', () => {
        // overflow at 5 px — minPx (12) already overflows.
        installLayoutMocks({ overflowAtPx: 5, container: { width: 500, height: 200 } })
        const { container } = render(<AutoFitText html="<p>too big to ever fit</p>" minPx={12} maxPx={120} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('12px')
    })

    it('applies className and inline style props', () => {
        installLayoutMocks({ overflowAtPx: 1000, container: { width: 500, height: 200 } })
        const { container } = render(
            <AutoFitText
                html="<p>x</p>"
                className="text-center"
                style={{ color: 'red', textAlign: 'center' }}
                minPx={12}
                maxPx={120}
            />
        )
        const outer = container.firstChild as HTMLElement
        expect(outer.className).toContain('text-center')
        expect(outer.style.color).toBe('red')
        expect(outer.style.textAlign).toBe('center')
        expect(outer.style.overflow).toBe('hidden')
    })

    it('does not throw when container is zero-sized', () => {
        installLayoutMocks({ overflowAtPx: 100, container: { width: 0, height: 0 } })
        // Should bail in fit() without applying a font-size or crashing.
        expect(() => render(<AutoFitText html="<p>anything</p>" minPx={12} maxPx={120} />)).not.toThrow()
    })

    it('re-fits when html changes', () => {
        installLayoutMocks({ overflowAtPx: 10_000, container: { width: 500, height: 200 } })
        const { container, rerender } = render(<AutoFitText html="<p>short</p>" minPx={12} maxPx={120} />)
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('120px')

        // Tighten overflow so the same content no longer fits at max.
        installLayoutMocks({ overflowAtPx: 60, container: { width: 500, height: 200 } })
        rerender(<AutoFitText html="<p>different</p>" minPx={12} maxPx={120} />)
        const px = parseFloat(measure.style.fontSize)
        expect(px).toBeLessThan(120)
        expect(px).toBeGreaterThanOrEqual(12)
    })

    it('respects document.fonts.ready and re-fits after fonts load', async () => {
        installLayoutMocks({ overflowAtPx: 10_000, container: { width: 500, height: 200 } })
        // Stub document.fonts with a promise we resolve later.
        let resolveFonts: () => void = () => { /* assigned below */ }
        const fontsReady = new Promise<void>((res) => { resolveFonts = res })
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: fontsReady },
        })
        const { container } = render(<AutoFitText html="<p>x</p>" minPx={12} maxPx={120} />)
        resolveFonts()
        await fontsReady
        const measure = container.querySelector('[style*="font-size"]') as HTMLElement
        expect(measure.style.fontSize).toBe('120px')
    })
})
