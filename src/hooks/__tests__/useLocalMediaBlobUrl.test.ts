import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const getLocalMediaBlob = vi.hoisted(() => vi.fn())
vi.mock('../useIndexedDB', () => ({ getLocalMediaBlob }))

import { useLocalMediaBlobUrl, forgetLocalMediaBlobUrl } from '../useLocalMediaBlobUrl'

describe('useLocalMediaBlobUrl', () => {
    beforeEach(() => {
        getLocalMediaBlob.mockReset()
        getLocalMediaBlob.mockResolvedValue(new Blob(['frame']))
        URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`)
        URL.revokeObjectURL = vi.fn()
    })

    it('reads a file once, however often the media panel opens', async () => {
        // Each open read every tile's full file again and made a new URL.
        const first = renderHook(() => useLocalMediaBlobUrl('m1'))
        await waitFor(() => expect(first.result.current).toMatch(/^blob:/))
        const url = first.result.current
        first.unmount()
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()

        const again = renderHook(() => useLocalMediaBlobUrl('m1'))
        expect(again.result.current).toBe(url)
        expect(getLocalMediaBlob).toHaveBeenCalledTimes(1)
        forgetLocalMediaBlobUrl('m1')
    })

    it('lets go of a deleted item', async () => {
        const { result } = renderHook(() => useLocalMediaBlobUrl('m2'))
        await waitFor(() => expect(result.current).toMatch(/^blob:/))
        forgetLocalMediaBlobUrl('m2')
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.current)
    })
})
