import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
    useKeyboardShortcut,
    useKeyboardShortcuts,
    useNumberShortcuts,
    useCtrlOrMetaActive,
} from '../useKeyboardShortcuts'

function fireKeyDown(key: string, options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: EventTarget }) {
    const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: options?.ctrlKey || false,
        metaKey: options?.metaKey || false,
        shiftKey: options?.shiftKey || false,
        altKey: options?.altKey || false,
        bubbles: true,
        cancelable: true,
    })
    if (options?.target) {
        Object.defineProperty(event, 'target', { value: options.target })
    }
    window.dispatchEvent(event)
    return event
}

describe('useKeyboardShortcut', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('calls callback when key matches', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('a', callback))

        fireKeyDown('a')
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('calls callback with Ctrl modifier', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('s', callback, { ctrlOrMeta: true }))

        fireKeyDown('s', { ctrlKey: true })
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('calls callback with Meta modifier', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('s', callback, { ctrlOrMeta: true }))

        fireKeyDown('s', { metaKey: true })
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('does NOT call callback when modifier is missing but required', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('s', callback, { ctrlOrMeta: true }))

        fireKeyDown('s')
        expect(callback).not.toHaveBeenCalled()
    })

    it('does NOT call callback when input is focused', () => {
        const callback = vi.fn()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        renderHook(() => useKeyboardShortcut('a', callback))

        fireKeyDown('a')
        expect(callback).not.toHaveBeenCalled()

        document.body.removeChild(input)
    })

    it('calls callback when input is focused but ignoreInputFocus is true', () => {
        const callback = vi.fn()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        renderHook(() => useKeyboardShortcut('a', callback, { ignoreInputFocus: true }))

        fireKeyDown('a')
        expect(callback).toHaveBeenCalledTimes(1)

        document.body.removeChild(input)
    })

    it('respects shift modifier', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('a', callback, { shift: true }))

        fireKeyDown('a', { shiftKey: true })
        expect(callback).toHaveBeenCalledTimes(1)

        fireKeyDown('a')
        expect(callback).toHaveBeenCalledTimes(1) // still 1
    })

    it('respects alt modifier', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('a', callback, { alt: true }))

        fireKeyDown('a', { altKey: true })
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('prevents default by default', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('a', callback))

        const event = fireKeyDown('a')
        expect(event.defaultPrevented).toBe(true)
    })

    it('does not prevent default when preventDefault is false', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('a', callback, { preventDefault: false }))

        const event = fireKeyDown('a')
        expect(event.defaultPrevented).toBe(false)
    })

    it('ignores case when matching', () => {
        const callback = vi.fn()
        renderHook(() => useKeyboardShortcut('A', callback))

        fireKeyDown('a')
        expect(callback).toHaveBeenCalledTimes(1)
    })
})

describe('useKeyboardShortcuts', () => {
    it('calls correct callback for each shortcut', () => {
        const cbA = vi.fn()
        const cbB = vi.fn()

        renderHook(() => useKeyboardShortcuts([
            { key: 'a', callback: cbA },
            { key: 'b', callback: cbB },
        ]))

        fireKeyDown('a')
        expect(cbA).toHaveBeenCalledTimes(1)
        expect(cbB).not.toHaveBeenCalled()

        fireKeyDown('b')
        expect(cbB).toHaveBeenCalledTimes(1)
    })

    it('skips shortcuts that opt out of input-focus guard', () => {
        const cbA = vi.fn()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        renderHook(() => useKeyboardShortcuts([
            { key: 'a', callback: cbA, options: { ignoreInputFocus: true } },
        ]))

        fireKeyDown('a')
        expect(cbA).not.toHaveBeenCalled()

        document.body.removeChild(input)
    })

    it('applies ctrlOrMeta per shortcut', () => {
        const cbA = vi.fn()
        const cbB = vi.fn()

        renderHook(() => useKeyboardShortcuts([
            { key: 'a', callback: cbA, options: { ctrlOrMeta: true } },
            { key: 'b', callback: cbB },
        ]))

        fireKeyDown('a', { ctrlKey: true })
        expect(cbA).toHaveBeenCalledTimes(1)

        fireKeyDown('b')
        expect(cbB).toHaveBeenCalledTimes(1)
    })
})

describe('useNumberShortcuts', () => {
    it('calls callback with parsed number on Ctrl+number', () => {
        const callback = vi.fn()
        renderHook(() => useNumberShortcuts(callback))

        fireKeyDown('5', { ctrlKey: true })
        expect(callback).toHaveBeenCalledWith(5)
    })

    it('does not fire without Ctrl modifier', () => {
        const callback = vi.fn()
        renderHook(() => useNumberShortcuts(callback))

        fireKeyDown('5')
        expect(callback).not.toHaveBeenCalled()
    })

    it('ignores when input is focused', () => {
        const callback = vi.fn()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        renderHook(() => useNumberShortcuts(callback))

        fireKeyDown('5', { ctrlKey: true })
        expect(callback).not.toHaveBeenCalled()

        document.body.removeChild(input)
    })
})

describe('useCtrlOrMetaActive', () => {
    // The implementation uses event.ctrlKey and event.metaKey — happy-dom
    // supports both on synthetic KeyboardEvent objects (see the
    // useKeyboardShortcut tests above that use { ctrlKey: true }).
    //
    // React state updates from event handlers are batched, so we use
    // act() to flush them before reading result.current.

    it('starts as false', () => {
        const { result } = renderHook(() => useCtrlOrMetaActive())
        expect(result.current).toBe(false)
    })

    it('returns true while Ctrl is held (keydown)', async () => {
        const { result } = renderHook(() => useCtrlOrMetaActive())
        expect(result.current).toBe(false)

        await act(async () => {
            const down = new KeyboardEvent('keydown', {
                key: 'Control',
                ctrlKey: true,
            })
            window.dispatchEvent(down)
        })

        await waitFor(() => {
            expect(result.current).toBe(true)
        })
    })

    it('returns false on keyup', async () => {
        const { result } = renderHook(() => useCtrlOrMetaActive())

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
        })
        await waitFor(() => {
            expect(result.current).toBe(true)
        })

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
        })
        await waitFor(() => {
            expect(result.current).toBe(false)
        })
    })

    it('returns true while Meta is held (keydown)', async () => {
        const { result } = renderHook(() => useCtrlOrMetaActive())

        await act(async () => {
            const event = new KeyboardEvent('keydown', { key: 'Meta', metaKey: true })
            window.dispatchEvent(event)
        })
        await waitFor(() => {
            expect(result.current).toBe(true)
        })
    })

    it('ignores non-modifier key presses', async () => {
        const { result } = renderHook(() => useCtrlOrMetaActive())

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
        })

        // Wait a tick to make sure the state would have updated if the
        // handler were going to set it (it shouldn't)
        await new Promise(r => setTimeout(r, 10))
        expect(result.current).toBe(false)
    })
})
