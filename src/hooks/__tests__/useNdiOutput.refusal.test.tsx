import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook, act, waitFor } from '@testing-library/react'

// vi.mock factories are hoisted above const initialisers, so this has to be too.
const { startOutput } = vi.hoisted(() => ({ startOutput: vi.fn() }))

vi.mock('../../services/ndi-output', () => ({
    ndiOutputService: {
        isAvailable: async () => true,
        isSupported: async () => true,
        getState: async () => ({
            isAvailable: true,
            isRunning: false,
            sourceName: 'Selah Live Output',
            framesSent: 0,
            error: null,
        }),
        startOutput,
        stopOutput: vi.fn(),
        discoverSources: async () => [],
    },
}))

import { useNdiOutput, NDI_LIVE_WINDOW_MISSING, type NdiStartRefusal } from '../useNdiOutput'

describe('useNdiOutput start refusals', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uses the same code the backend sends', () => {
        // Two halves of one contract in two languages: if the Rust constant is
        // renamed, the UI silently stops offering to open the live output and
        // just prints the reason again.
        const rust = readFileSync(
            join(process.cwd(), 'src-tauri/src/ndi_output/commands.rs'),
            'utf8',
        )
        const match = rust.match(/LIVE_WINDOW_MISSING_CODE: &str = "([^"]+)"/)
        expect(match?.[1]).toBe(NDI_LIVE_WINDOW_MISSING)
    })

    it('reports a missing live output window as an actionable refusal', async () => {
        startOutput.mockRejectedValue(
            new Error(`${NDI_LIVE_WINDOW_MISSING}: NDI sends what the live output window shows, and it isn't open yet.`),
        )

        const { result } = renderHook(() => useNdiOutput())
        const out: { refusal?: NdiStartRefusal | null } = {}
        await act(async () => { out.refusal = await result.current.startOutput() })

        expect(out.refusal?.code).toBe(NDI_LIVE_WINDOW_MISSING)
        // The code is machine-readable plumbing; the operator must not see it.
        expect(out.refusal?.message).not.toContain(NDI_LIVE_WINDOW_MISSING)
        expect(out.refusal?.message).toContain('live output window')
    })

    it('passes any other refusal through as advice', async () => {
        startOutput.mockRejectedValue(new Error('Selah needs Screen Recording permission…'))

        const { result } = renderHook(() => useNdiOutput())
        const out: { refusal?: NdiStartRefusal | null } = {}
        await act(async () => { out.refusal = await result.current.startOutput() })

        expect(out.refusal).toEqual({ code: 'unknown', message: 'Selah needs Screen Recording permission…' })
    })

    it('never rejects, so a caller cannot leak an uncaught promise', async () => {
        startOutput.mockRejectedValue(new Error('anything at all'))

        const { result } = renderHook(() => useNdiOutput())
        // The bug this pins: `void ndiStart()` in Settings put the refusal in the
        // devtools console, where no operator would ever read it.
        await expect(result.current.startOutput()).resolves.toBeTruthy()
    })

    it('resolves null when output actually starts', async () => {
        startOutput.mockResolvedValue(undefined)

        const { result } = renderHook(() => useNdiOutput())
        await waitFor(() => expect(result.current.isAvailable).toBe(true))

        const out: { refusal?: NdiStartRefusal | null } = {}
        await act(async () => { out.refusal = await result.current.startOutput() })
        expect(out.refusal).toBeNull()
    })
})
