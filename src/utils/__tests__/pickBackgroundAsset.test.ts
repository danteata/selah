import { describe, it, expect, vi } from 'vitest'

const saved = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), items: [] as { id: string }[] }))
vi.mock('../../platform', () => ({ isDesktop: () => false }))
vi.mock('../fileDialog', () => ({
    openFileDialog: vi.fn(async () => [new File(['x'], 'galaxy.mp4', { type: 'video/mp4' })]),
}))
vi.mock('../../hooks/useIndexedDB', () => ({
    saveLocalMediaBlob: vi.fn(async (id: string, blob: Blob) => { saved.blobs.set(id, blob) }),
    saveLocalMediaItem: vi.fn(async (item: { id: string }) => { saved.items.push(item) }),
}))

import { pickLocalBackgroundAsset } from '../pickBackgroundAsset'

describe('pickLocalBackgroundAsset on the web', () => {
    it('keeps an uploaded video in the local media library, so other windows can load it', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:preview')
        const picked = await pickLocalBackgroundAsset('video')

        expect(picked?.backgroundType).toBe('video')
        expect(picked?.localMediaId).toBeTruthy()
        expect(saved.blobs.has(picked!.localMediaId!)).toBe(true)
        expect(saved.items[0]).toMatchObject({ id: picked!.localMediaId, type: 'video', hasBlob: true })
    })
})
