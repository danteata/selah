import { describe, it, expect, beforeEach, vi } from 'vitest'

const desktop = vi.hoisted(() => ({ value: true }))
vi.mock('../../../platform', () => ({ isDesktop: () => desktop.value }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}` }))
const prefetch = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../../hooks/useTemplates', () => ({ prefetchTemplateBackground: prefetch }))

import type { ConvexReactClient } from 'convex/react'
import {
    localSourceOf,
    resetTemplateMedia,
    storageIdOf,
    syncTemplateMedia,
    templateMediaState,
    type TemplateLike,
} from '../templateMediaSync'

const MB = 1024 * 1024

const template = (id: string, snapshot: object, extra: Partial<TemplateLike> = {}): TemplateLike => ({
    _id: id,
    createdBy: 'user_1',
    slideId: JSON.stringify(snapshot),
    ...extra,
})

/** Files on "this computer", by asset URL, and their sizes. */
function disk(files: Record<string, number>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://upload') {
            return new Response(JSON.stringify({ storageId: `stored_${(init?.body as Blob).size}` }), { status: 200 })
        }
        const path = decodeURIComponent(url.replace('asset://localhost/', ''))
        if (path in files) return new Response(new Blob([new Uint8Array(files[path])]), { status: 200 })
        return new Response('', { status: 404 })
    }))
}

function convex(usedBytes = 0, limitBytes = 100 * MB) {
    const attach = vi.fn(async (args: { templateId: string; storageId: string }) => ({ ok: true, usedBytes: usedBytes + 1, limitBytes, ...args }))
    const client = {
        query: vi.fn(async () => ({ usedBytes, limitBytes })),
        mutation: vi.fn(async (_fn: unknown, args: Record<string, string>) => ('templateId' in args ? attach(args as never) : 'https://upload')),
    }
    return { client: client as unknown as ConvexReactClient, attach }
}

describe('template backgrounds', () => {
    beforeEach(() => {
        desktop.value = true
        resetTemplateMedia()
        prefetch.mockClear()
        vi.unstubAllGlobals()
    })

    it('reads where a template keeps its background', () => {
        expect(storageIdOf(template('a', { backgroundStorageId: 'snap' }, { backgroundStorageId: 'top' }))).toBe('top')
        expect(storageIdOf(template('a', { backgroundStorageId: 'snap' }))).toBe('snap')
        expect(localSourceOf(template('a', { localFilePath: 'C:\\Users\\x\\clip.mp4' }))).toEqual({ path: 'C:\\Users\\x\\clip.mp4' })
        expect(localSourceOf(template('a', { background: 'asset://localhost/%2Fa.mp4' }))).toEqual({ assetUrl: 'asset://localhost/%2Fa.mp4' })
        expect(localSourceOf(template('a', { background: 'https://images.unsplash.com/x.jpg' }))).toBeNull()
    })

    it('uploads a background this computer has and attaches it', async () => {
        disk({ '/Users/me/Galaxy.mp4': 2 * MB })
        const { client, attach } = convex()
        await syncTemplateMedia(client, [template('t1', { backgroundType: 'video', localFilePath: '/Users/me/Galaxy.mp4' })])
        expect(attach).toHaveBeenCalledWith({ templateId: 't1', storageId: `stored_${2 * MB}` })
        expect(templateMediaState('t1')).toBe('uploaded')
    })

    it("marks a background that's on another computer, without uploading", async () => {
        disk({})
        const { client, attach } = convex()
        await syncTemplateMedia(client, [template('t1', { localFilePath: 'C:\\Users\\danab\\Desktop\\Red.mp4' })])
        expect(attach).not.toHaveBeenCalled()
        expect(templateMediaState('t1')).toBe('missing')
    })

    it("doesn't upload past the church's limit", async () => {
        disk({ '/Users/me/Big.mp4': 30 * MB })
        const { client, attach } = convex(80 * MB)
        await syncTemplateMedia(client, [template('t1', { localFilePath: '/Users/me/Big.mp4' })])
        expect(attach).not.toHaveBeenCalled()
        expect(templateMediaState('t1')).toBe('over-limit')
    })

    it('leaves system templates and already-uploaded ones alone, and downloads the uploaded ones', async () => {
        disk({ '/Users/me/a.mp4': MB })
        const { client, attach } = convex()
        await syncTemplateMedia(client, [
            template('system', { localFilePath: '/Users/me/a.mp4' }, { createdBy: undefined }),
            template('done', { localFilePath: '/Users/me/a.mp4' }, { backgroundStorageId: 'kg2a8s' }),
        ])
        expect(attach).not.toHaveBeenCalled()
        expect(prefetch).toHaveBeenCalledWith(client, 'kg2a8s')
    })

    it('on the web, marks local-file backgrounds as elsewhere', async () => {
        desktop.value = false
        const { client } = convex()
        await syncTemplateMedia(client, [template('t1', { localFilePath: '/Users/me/a.mp4' })])
        expect(templateMediaState('t1')).toBe('missing')
    })
})
