/**
 * Tests for the useVoiceSearch hook.
 *
 * The Web Speech API is browser-only and not present in jsdom, so we
 * stub window.SpeechRecognition on each test with a controllable fake
 * and assert that the hook drives it correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVoiceSearch } from '../useVoiceSearch'

type Listener = (event: unknown) => void

class FakeSpeechRecognition {
    static instances: FakeSpeechRecognition[] = []
    static reset() {
        FakeSpeechRecognition.instances = []
    }

    lang = 'en-US'
    continuous = false
    interimResults = false
    maxAlternatives = 1

    onresult: Listener | null = null
    onerror: Listener | null = null
    onend: Listener | null = null
    onstart: Listener | null = null

    startCount = 0
    stopCount = 0
    aborted = false

    constructor() {
        FakeSpeechRecognition.instances.push(this)
    }

    start() {
        this.startCount += 1
        // Browsers fire onstart asynchronously after permissions and audio
        // capture are ready. Mirror that to keep the hook honest about
        // when "isListening" actually flips.
        queueMicrotask(() => this.onstart?.({}))
    }
    stop() {
        this.stopCount += 1
        // Browsers fire onend asynchronously; mirror that here so the
        // hook's onend handler runs the same way it would in production.
        queueMicrotask(() => this.onend?.({}))
    }
    abort() {
        this.aborted = true
    }

    // Test helpers
    emitResult(text: string, isFinal: boolean) {
        // The Web Speech API puts `isFinal` on the SpeechRecognitionResult
        // (slice) and `transcript` on the SpeechRecognitionAlternative
        // (slice[0]). Mirror that exact shape — putting isFinal on the
        // alternative means the hook never marks anything as final,
        // so the ref stays empty and onFinal never fires.
        const handler = this.onresult as ((e: any) => void) | null
        if (!handler) return
        const result = { isFinal, 0: { transcript: text, confidence: 1 } }
        handler({
            resultIndex: 0,
            results: [result],
        })
    }

    emitError(code: string) {
        this.onerror?.({ error: code, message: code })
    }
}

function installFakeRecognition() {
    FakeSpeechRecognition.reset()
    const fake = FakeSpeechRecognition
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = fake
    return fake
}

afterEach(() => {
    FakeSpeechRecognition.reset()
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    vi.useRealTimers()
})

describe('useVoiceSearch', () => {
    it('reports isSupported=false when the browser has no SpeechRecognition', () => {
        const { result } = renderHook(() => useVoiceSearch())
        expect(result.current.isSupported).toBe(false)
    })

    it('reports isSupported=true when window.SpeechRecognition exists', () => {
        installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch())
        expect(result.current.isSupported).toBe(true)
    })

    it('start() creates a recognition instance and begins listening', async () => {
        const Fake = installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch({ onFinal: vi.fn() }))

        await act(async () => {
            result.current.start()
            await Promise.resolve()
        })
        expect(Fake.instances).toHaveLength(1)
        expect(Fake.instances[0]?.startCount).toBe(1)
        expect(result.current.isListening).toBe(true)
    })

    it('commits a single final transcript and exposes it on onFinal', async () => {
        const Fake = installFakeRecognition()
        const onFinal = vi.fn()
        const { result } = renderHook(() => useVoiceSearch({ onFinal }))

        act(() => result.current.start())
        const instance = Fake.instances[0]!
        // The Web Speech API delivers the finalized utterance as a
        // single final result. The hook commits it as-is — no
        // concatenation, no duplication of earlier interim slices.
        act(() => {
            instance.emitResult('John 3:16', true)
        })
        expect(result.current.transcript).toBe('John 3:16')

        // stop() triggers onend, which fires onFinal
        await act(async () => {
            result.current.stop()
            await Promise.resolve()
        })
        expect(onFinal).toHaveBeenCalledWith('John 3:16')
        expect(result.current.isListening).toBe(false)
    })

    it('does not duplicate earlier interim slices when a final result arrives', () => {
        // This is the bug the new finals/interims split fixes: the
        // browser can fire interim "John" → "John 3" → "John 3:16"
        // before a final arrives. With the old "prev + interim"
        // accumulation this produced "JohnJohn 3John 3:16". The new
        // shape only keeps the latest interim, then commits the final.
        const Fake = installFakeRecognition()
        const onFinal = vi.fn()
        const { result } = renderHook(() => useVoiceSearch({ onFinal }))

        act(() => result.current.start())
        const instance = Fake.instances[0]!
        act(() => {
            instance.emitResult('John', false)
        })
        expect(result.current.transcript).toBe('John')
        act(() => {
            instance.emitResult('John 3', false)
        })
        // The interim slice replaced the earlier one — no "JohnJohn 3".
        expect(result.current.transcript).toBe('John 3')
        act(() => {
            instance.emitResult('John 3:16', true)
        })
        // Final commits. Interim cleared on onend below.
        expect(result.current.transcript).toBe('John 3:16')
        expect(onFinal).not.toHaveBeenCalled()
    })

    it('clears the previous instance when start() is called twice in a row', () => {
        const Fake = installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch())

        act(() => result.current.start())
        const first = Fake.instances[0]!
        act(() => result.current.start())
        const second = Fake.instances[1]!

        expect(first.aborted).toBe(true)
        expect(second.startCount).toBe(1)
    })

    it('translates not-allowed errors into a friendly message', () => {
        const Fake = installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch())

        act(() => result.current.start())
        act(() => {
            Fake.instances[0]?.emitError('not-allowed')
        })
        expect(result.current.error).toMatch(/permission/i)
    })

    it('does not surface an error for benign no-speech events', () => {
        const Fake = installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch())

        act(() => result.current.start())
        act(() => {
            Fake.instances[0]?.emitError('no-speech')
        })
        expect(result.current.error).toBeNull()
    })

    it('reset() clears transcript and error without touching the recognition instance', () => {
        const Fake = installFakeRecognition()
        const { result } = renderHook(() => useVoiceSearch({ onFinal: vi.fn() }))

        act(() => result.current.start())
        act(() => {
            Fake.instances[0]?.emitResult('hello', true)
        })
        expect(result.current.transcript).toBe('hello')
        act(() => result.current.reset())
        expect(result.current.transcript).toBe('')
        // Listening state and the live instance are unaffected.
        expect(Fake.instances[0]?.aborted).toBe(false)
    })

    it('aborts an in-flight session on unmount', () => {
        const Fake = installFakeRecognition()
        const { result, unmount } = renderHook(() => useVoiceSearch())
        act(() => result.current.start())
        const instance = Fake.instances[0]!
        unmount()
        expect(instance.aborted).toBe(true)
    })
})
