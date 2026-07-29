import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UpdatePrompt } from '../UpdatePrompt'
import { __resetAppUpdaterForTests } from '../../../hooks/useAppUpdater'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('../../../hooks/useAnalytics', () => ({
    useAnalytics: () => ({ trackEvent: vi.fn() }),
}))

const AVAILABLE = {
    version: '0.1.10',
    currentVersion: '0.1.9',
    notes: 'Adds a dictionary you can project.',
    date: '2026-07-28T00:00:00Z',
}

/** The hook only runs in the desktop build. */
function pretendDesktop() {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

describe('UpdatePrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useRealTimers()
        __resetAppUpdaterForTests()
        localStorage.clear()
        pretendDesktop()
    })

    it('shows nothing until an update is found', () => {
        invoke.mockResolvedValue(null)
        const { container } = render(<UpdatePrompt />)
        expect(container.firstChild).toBeNull()
    })

    it('surfaces the new version in the always-visible chrome', async () => {
        vi.useFakeTimers()
        invoke.mockResolvedValue(AVAILABLE)
        render(<UpdatePrompt />)

        // The background check is deliberately delayed past first render.
        await vi.advanceTimersByTimeAsync(6_000)
        vi.useRealTimers()

        expect(await screen.findByTitle('Selah 0.1.10 is available')).toBeInTheDocument()
        expect(screen.getByText('Update to 0.1.10')).toBeInTheDocument()
    })

    describe('once an update is known', () => {
        beforeEach(async () => {
            vi.useFakeTimers()
            invoke.mockResolvedValue(AVAILABLE)
            render(<UpdatePrompt />)
            await vi.advanceTimersByTimeAsync(6_000)
            vi.useRealTimers()
            await screen.findByText('Update to 0.1.10')
            invoke.mockClear()
        })

        it('does not install on its own', () => {
            expect(invoke).not.toHaveBeenCalled()
        })

        it('shows what the update is before installing anything', () => {
            fireEvent.click(screen.getByText('Update to 0.1.10'))

            expect(screen.getByRole('dialog', { name: 'Update Selah' })).toBeInTheDocument()
            expect(screen.getByText(/Adds a dictionary you can project/)).toBeInTheDocument()
            expect(screen.getByText('Selah closes and reopens to install.')).toBeInTheDocument()
            expect(invoke).not.toHaveBeenCalled()
        })

        it('installs only when asked', async () => {
            invoke.mockImplementation(() => new Promise(() => {}))
            fireEvent.click(screen.getByText('Update to 0.1.10'))
            fireEvent.click(screen.getByText('Install and restart'))

            await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_update'))
            expect(screen.getByText('Installing…')).toBeInTheDocument()
        })

        it('reports an install that fails instead of hanging on the spinner', async () => {
            invoke.mockRejectedValue('Could not reach the update server.')
            fireEvent.click(screen.getByText('Update to 0.1.10'))
            fireEvent.click(screen.getByText('Install and restart'))

            expect(await screen.findByText('Could not reach the update server.')).toBeInTheDocument()
        })

        it('stops prompting for a version the operator skipped', async () => {
            fireEvent.click(screen.getByText('Update to 0.1.10'))
            fireEvent.click(screen.getByText('Skip this version'))

            await waitFor(() => expect(screen.queryByText('Update to 0.1.10')).not.toBeInTheDocument())
            expect(localStorage.getItem('selah-dismissed-update')).toBe('0.1.10')
        })
    })

    it('prompts again for a version newer than the skipped one', async () => {
        localStorage.setItem('selah-dismissed-update', '0.1.10')
        __resetAppUpdaterForTests()

        vi.useFakeTimers()
        invoke.mockResolvedValue({ ...AVAILABLE, version: '0.1.11' })
        render(<UpdatePrompt />)
        await vi.advanceTimersByTimeAsync(6_000)
        vi.useRealTimers()

        expect(await screen.findByText('Update to 0.1.11')).toBeInTheDocument()
    })

    it('stays out of the way in the web build', async () => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        __resetAppUpdaterForTests()

        vi.useFakeTimers()
        const { container } = render(<UpdatePrompt />)
        await vi.advanceTimersByTimeAsync(6_000)
        vi.useRealTimers()

        expect(container.firstChild).toBeNull()
        expect(invoke).not.toHaveBeenCalled()
    })
})
