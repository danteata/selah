import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { Slide } from '../../../types'
import { useAppStore } from '../../../store/appStore'

const h = vi.hoisted(() => ({
    session: {
        isConnected: false,
        isOperator: false,
        isContributor: false,
        isOpen: false,
        sessionScheduleId: null as string | null,
        setLiveSlide: vi.fn(async () => {}),
    },
}))
vi.mock('../../../hooks/useLiveSession', () => ({ useLiveSession: () => h.session }))

import { StagedSlideShortcut } from '../StagedSlideShortcut'

function slide(id: string, scheduleId = 'sched'): Slide {
    return { id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId, contents: [] } as Slide
}

function pressEnter(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
}

describe('StagedSlideShortcut', () => {
    beforeEach(() => {
        useAppStore.getState().signOut()
        useAppStore.setState({
            activeSlides: [slide('a'), slide('b'), slide('other', 'elsewhere')],
            activeSchedule: { _id: 'sched' } as never,
            stagedSlideId: 'b',
            liveSlideId: 'a',
        })
        Object.assign(h.session, { isConnected: false, isOperator: false, isContributor: false, isOpen: false, sessionScheduleId: null })
        h.session.setLiveSlide.mockClear()
    })
    afterEach(() => {
        cleanup()
        document.body.innerHTML = ''
    })

    it('sends the staged slide on air, whichever panel has focus', () => {
        render(<StagedSlideShortcut />)
        const event = pressEnter()
        expect(h.session.setLiveSlide).toHaveBeenCalledWith('b')
        expect(event.defaultPrevented).toBe(true)
    })

    it('does nothing while typing', () => {
        render(<StagedSlideShortcut />)
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it('leaves Enter to a focused button', () => {
        render(<StagedSlideShortcut />)
        const button = document.createElement('button')
        document.body.appendChild(button)
        button.focus()
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it('ignores Enter with a modifier, and while a dialog is open', () => {
        render(<StagedSlideShortcut />)
        pressEnter({ shiftKey: true })
        pressEnter({ metaKey: true })
        act(() => { useAppStore.setState({ commandBarOpen: true }) })
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it('does nothing when the staged slide is already on air, or nothing is staged', () => {
        render(<StagedSlideShortcut />)
        act(() => { useAppStore.setState({ stagedSlideId: 'a' }) })
        pressEnter()
        act(() => { useAppStore.setState({ stagedSlideId: null }) })
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it('does nothing when the staged slide has left the service order', () => {
        render(<StagedSlideShortcut />)
        act(() => { useAppStore.setState({ stagedSlideId: 'other' }) })
        pressEnter()
        act(() => { useAppStore.setState({ stagedSlideId: 'gone' }) })
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it("does nothing for a session viewer who can't send to air", () => {
        Object.assign(h.session, { isConnected: true, isOperator: false, isContributor: false })
        render(<StagedSlideShortcut />)
        pressEnter()
        expect(h.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it("uses the session's schedule while collaborating", () => {
        Object.assign(h.session, { isConnected: true, isOperator: true, sessionScheduleId: 'elsewhere' })
        act(() => { useAppStore.setState({ stagedSlideId: 'other' }) })
        render(<StagedSlideShortcut />)
        pressEnter()
        expect(h.session.setLiveSlide).toHaveBeenCalledWith('other')
    })
})
