import { describe, it, expect, beforeEach, vi } from 'vitest'

const { invokeMock, emitMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    emitMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ emit: emitMock }))
vi.mock('../../../platform', () => ({ isDesktop: () => true }))

import { hidePill, preloadPill, setPillState, showPill } from '../pill'

describe('dictation pill', () => {
    beforeEach(() => {
        invokeMock.mockReset().mockResolvedValue(undefined)
        emitMock.mockReset().mockResolvedValue(undefined)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('sets the state before showing the window', async () => {
        await showPill('transcribing')

        // The page reads its label from the event. Showing first would flash
        // "Listening…" before a pill that opened straight into transcribing.
        expect(emitMock).toHaveBeenCalledWith('dictation://state', { state: 'transcribing' })
        const emitOrder = emitMock.mock.invocationCallOrder[0]
        const showOrder = invokeMock.mock.invocationCallOrder[0]
        expect(emitOrder).toBeLessThan(showOrder)
        expect(invokeMock).toHaveBeenCalledWith('show_dictation_pill')
    })

    it('defaults to listening', async () => {
        await showPill()

        expect(emitMock).toHaveBeenCalledWith('dictation://state', { state: 'listening' })
    })

    it('warms the window without showing it', async () => {
        await preloadPill()

        expect(invokeMock).toHaveBeenCalledWith('ensure_dictation_pill')
        expect(invokeMock).not.toHaveBeenCalledWith('show_dictation_pill')
    })

    it('never throws when the window command fails', async () => {
        invokeMock.mockRejectedValue(new Error('no window'))

        // A missing indicator is cosmetic. Rejecting here would propagate into
        // `begin()` and turn it into a dictation that never records.
        await expect(showPill()).resolves.toBeUndefined()
        await expect(hidePill()).resolves.toBeUndefined()
        await expect(preloadPill()).resolves.toBeUndefined()
    })

    it('never throws when the state broadcast fails', async () => {
        emitMock.mockRejectedValue(new Error('no bus'))

        await expect(setPillState('listening')).resolves.toBeUndefined()
    })
})

describe('dictation pill off the desktop', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        emitMock.mockReset()
        vi.resetModules()
    })

    it('does nothing in the browser build', async () => {
        vi.doMock('../../../platform', () => ({ isDesktop: () => false }))
        const pill = await import('../pill')

        await pill.showPill()
        await pill.hidePill()
        await pill.preloadPill()

        expect(invokeMock).not.toHaveBeenCalled()
        expect(emitMock).not.toHaveBeenCalled()
    })
})
