import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { useTextBuildIn } from '../useTextBuildIn'
import { wrapUnits, type TextAnimation } from '../../lib/animation/textBuildIn'

function Harness({ html, animation, replayKey = 'a' }: { html: string; animation: TextAnimation | null; replayKey?: string }) {
    const [el, setEl] = useState<HTMLDivElement | null>(null)
    useTextBuildIn(el, animation, replayKey)
    return <div ref={setEl} dangerouslySetInnerHTML={{ __html: html }} />
}

const units = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-u]'))

describe('useTextBuildIn', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('brings the units in over the build-in and clears their styles at the end', () => {
        const animation: TextAnimation = { preset: 'typewriter', duration: 1 }
        const { container } = render(<Harness html={wrapUnits('<p>Hello</p>', 'typewriter')} animation={animation} />)
        expect(units(container).every((el) => el.style.opacity === '0')).toBe(true)

        act(() => { vi.advanceTimersByTime(500) })
        const midway = units(container).map((el) => el.style.opacity)
        expect(midway[0]).toBe('')
        expect(midway[4]).toBe('0')

        act(() => { vi.advanceTimersByTime(600) })
        expect(units(container).every((el) => el.style.opacity === '' && el.style.transform === '')).toBe(true)
    })

    it('waits out its delay', () => {
        const animation: TextAnimation = { preset: 'typewriter', duration: 1, delay: 1 }
        const { container } = render(<Harness html={wrapUnits('<p>Hi</p>', 'typewriter')} animation={animation} />)
        act(() => { vi.advanceTimersByTime(900) })
        expect(units(container).every((el) => el.style.opacity === '0')).toBe(true)
    })

    it('reveals everything if torn down mid-way, so text is never left hidden', () => {
        const animation: TextAnimation = { preset: 'word-rise', duration: 1 }
        const { container, unmount } = render(<Harness html={wrapUnits('<p>One two three</p>', 'word-rise')} animation={animation} />)
        const spans = units(container)
        act(() => { vi.advanceTimersByTime(300) })
        unmount()
        expect(spans.every((el) => el.style.opacity === '' && el.style.transform === '')).toBe(true)
    })
})
