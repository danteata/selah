import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../platform', () => ({ isDesktop: () => false, isTauriMobile: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))

import { useVoiceSearch } from '../useVoiceSearch'

describe('useVoiceSearch in the phone app', () => {
    beforeEach(() => h.invoke.mockReset())

    it("uses the phone's recognizer, since its web view has no Web Speech", async () => {
        // "Voice search isn't available in this browser" in the Android app.
        h.invoke.mockImplementation(async (cmd: string) => (cmd === 'speech_listen' ? 'John 3:16.' : undefined))
        const onFinal = vi.fn()
        const { result } = renderHook(() => useVoiceSearch({ onFinal }))
        expect(result.current.isSupported).toBe(true)

        act(() => result.current.start())
        await waitFor(() => expect(onFinal).toHaveBeenCalledWith('John 3:16'))
        expect(h.invoke).toHaveBeenCalledWith('speech_listen')
        expect(result.current.isListening).toBe(false)
    })

    it("says what went wrong, and stays quiet when nothing was said", async () => {
        h.invoke.mockRejectedValueOnce(new Error('Voice search needs the internet on this phone.'))
        const { result } = renderHook(() => useVoiceSearch({ onFinal: vi.fn() }))
        act(() => result.current.start())
        await waitFor(() => expect(result.current.error).toBe('Voice search needs the internet on this phone.'))

        h.invoke.mockResolvedValueOnce('')
        const onFinal = vi.fn()
        const quiet = renderHook(() => useVoiceSearch({ onFinal }))
        act(() => quiet.result.current.start())
        await waitFor(() => expect(quiet.result.current.isListening).toBe(false))
        expect(onFinal).not.toHaveBeenCalled()
        expect(quiet.result.current.error).toBeNull()
    })
})
