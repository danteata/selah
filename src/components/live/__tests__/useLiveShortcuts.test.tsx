import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { Slide } from '../../../types'
import { useAppStore } from '../../../store/appStore'
import { useLiveShortcuts } from '../useLiveShortcuts'

function slide(id: string, synced = true): Slide {
    return { id, _id: synced ? `db-${id}` : undefined, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [] } as Slide
}

function press(key: string, init: KeyboardEventInit = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useLiveShortcuts', () => {
    const deck = [slide('a'), slide('b'), slide('c', false)]
    const setOnAir = vi.fn()

    beforeEach(() => {
        useAppStore.getState().signOut()
        setOnAir.mockClear()
        renderHook(() => useLiveShortcuts({ deck, previous: deck[0], nextUp: deck[2], setOnAir }))
    })
    afterEach(cleanup)

    it('steps with the arrow keys', () => {
        press('ArrowDown')
        press('ArrowUp')
        expect(setOnAir.mock.calls).toEqual([['c'], ['a']])
    })

    it('leaves the arrow keys alone with a modifier', () => {
        press('ArrowDown', { altKey: true })
        press('ArrowUp', { metaKey: true })
        expect(setOnAir).not.toHaveBeenCalled()
    })

    it('jumps with Ctrl/Cmd + a number, to slides the server knows', () => {
        press('1', { ctrlKey: true })
        press('2', { metaKey: true })
        press('3', { ctrlKey: true })
        expect(setOnAir.mock.calls).toEqual([['a'], ['b']])
    })

    it('does nothing while a dialog is open', () => {
        useAppStore.setState({ commandBarOpen: true })
        press('ArrowDown')
        press('1', { ctrlKey: true })
        expect(setOnAir).not.toHaveBeenCalled()
    })
})
