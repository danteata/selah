/**
 * A dictation commit is not instant: `finish()` waits out the engine's drain
 * (`FINAL_UTTERANCE_GRACE_MS`), then places the text and hides the pill. For
 * all of that the session is no longer "active", so a second hotkey press used
 * to be accepted — and the in-flight `finish()` would then walk over the
 * session that press had just started, taking its first words into the
 * previous insert, resetting the state to idle, and hiding the pill with the
 * microphone still open.
 *
 * These tests drive the public `startDictation`/`stopDictation`, which is the
 * same path the hotkey takes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { serviceMock, pillMock, insertMock, shortcutMock } = vi.hoisted(() => ({
    serviceMock: {
        start: vi.fn(),
        stop: vi.fn(),
        isBusy: vi.fn(),
        getIsRunning: vi.fn(),
    },
    pillMock: {
        showPill: vi.fn().mockResolvedValue(undefined),
        hidePill: vi.fn().mockResolvedValue(undefined),
        setPillState: vi.fn().mockResolvedValue(undefined),
        preloadPill: vi.fn().mockResolvedValue(undefined),
        destroyPill: vi.fn().mockResolvedValue(undefined),
    },
    insertMock: {
        insertTextAtCaret: vi.fn().mockReturnValue({ ok: true }),
        copyToClipboard: vi.fn().mockResolvedValue(true),
    },
    shortcutMock: {
        setGlobalShortcuts: vi.fn().mockResolvedValue([]),
        clearGlobalShortcuts: vi.fn().mockResolvedValue(undefined),
        onShortcut: vi.fn().mockResolvedValue(() => {}),
    },
}))

vi.mock('../../platform', () => ({ isDesktop: () => true, platform: {} }))
vi.mock('../../store/appStore', () => ({
    useAppStore: (selector: (s: unknown) => unknown) =>
        selector({ settings: { dictation: { enabled: true, mode: 'toggle' } } }),
}))
vi.mock('../../services/sermon-listener/nativeTranscription', () => ({
    default: serviceMock,
    nativeTranscriptionService: serviceMock,
}))
vi.mock('../../services/dictation/pill', () => pillMock)
vi.mock('../../services/dictation/insertText', () => insertMock)
vi.mock('../../services/dictation/globalShortcuts', () => ({
    ...shortcutMock,
    ShortcutAction: {
        DictationPushToTalk: 'dictation.push-to-talk',
        DictationToggle: 'dictation.toggle',
    },
    DEFAULT_DICTATION_HOTKEY: 'CommandOrControl+Shift+D',
}))
vi.mock('sonner', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import { useDictation } from '../useDictation'

/** A promise plus its resolver, for holding an await open mid-test. */
function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
        resolve = r
    })
    return { promise, resolve }
}

describe('useDictation — a second press during the commit', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        pillMock.showPill.mockResolvedValue(undefined)
        pillMock.hidePill.mockResolvedValue(undefined)
        pillMock.setPillState.mockResolvedValue(undefined)
        insertMock.insertTextAtCaret.mockReturnValue({ ok: true })
        serviceMock.start.mockResolvedValue(true)
        serviceMock.stop.mockResolvedValue(undefined)
        // The service is free; the guard under test is the hook's own.
        serviceMock.isBusy.mockReturnValue(false)
        serviceMock.getIsRunning.mockReturnValue(false)
    })

    it('is refused while the engine is still draining', async () => {
        const draining = deferred()
        serviceMock.stop.mockReturnValue(draining.promise)

        const { result } = renderHook(() => useDictation())

        await act(async () => {
            result.current.startDictation()
        })
        expect(serviceMock.start).toHaveBeenCalledTimes(1)

        // Stop, but hold the drain open.
        act(() => {
            result.current.stopDictation()
        })
        await act(async () => {
            result.current.startDictation()
        })

        expect(serviceMock.start).toHaveBeenCalledTimes(1)

        await act(async () => {
            draining.resolve()
        })
        expect(result.current.state).toBe('idle')
    })

    it('is refused while the pill is still being hidden', async () => {
        // The window the engine's own busy flag cannot cover: `stop()` has
        // already resolved, so the service reports itself free, but `finish()`
        // is still awaiting `hidePill()`. A session started here is the one
        // whose pill gets hidden out from under it.
        const hiding = deferred()
        pillMock.hidePill.mockReturnValue(hiding.promise)

        const { result } = renderHook(() => useDictation())

        await act(async () => {
            result.current.startDictation()
        })
        expect(serviceMock.start).toHaveBeenCalledTimes(1)

        act(() => {
            result.current.stopDictation()
        })
        // Let stop() resolve so only hidePill() is outstanding.
        await act(async () => {
            await Promise.resolve()
        })
        await act(async () => {
            result.current.startDictation()
        })

        expect(serviceMock.start).toHaveBeenCalledTimes(1)

        await act(async () => {
            hiding.resolve()
        })
    })

    it('accepts the next press once the commit is complete', async () => {
        const { result } = renderHook(() => useDictation())

        await act(async () => {
            result.current.startDictation()
        })
        await act(async () => {
            result.current.stopDictation()
        })
        await act(async () => {
            result.current.startDictation()
        })

        expect(serviceMock.start).toHaveBeenCalledTimes(2)
    })
})
