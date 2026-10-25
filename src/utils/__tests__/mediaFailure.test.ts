import { describe, it, expect, vi, afterEach } from 'vitest'
import { explainMediaFailure, mediaFailureText } from '../mediaFailure'

const notSupported = { code: 4, message: '' } as MediaError

describe('explainMediaFailure', () => {
    afterEach(() => vi.unstubAllGlobals())

    it("says a local file that isn't on this computer is on another one", async () => {
        // A slide carries the adding computer's path; this desk had no such file.
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
        expect(await explainMediaFailure('http://asset.localhost/C%3A%5CUsers%5Cop%5Cclip.MOV', notSupported)).toBe('elsewhere')
    })

    it("says a local file that's here but won't play is the format", async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 206 })))
        expect(await explainMediaFailure('asset://localhost/%2Fhome%2Fop%2Fclip.MOV', notSupported)).toBe('format')
    })

    it('reads an unsupported cloud file as the format, anything else as unavailable', async () => {
        expect(await explainMediaFailure('https://x.convex.cloud/api/storage/abc', notSupported)).toBe('format')
        expect(await explainMediaFailure('https://x.convex.cloud/api/storage/abc', { code: 2, message: '' } as MediaError)).toBe('unavailable')
    })

    it('words each for a video', () => {
        expect(mediaFailureText('elsewhere', 'video')).toMatch(/^This video is on another computer/)
        expect(mediaFailureText('format', 'video')).toMatch(/Converting it to MP4/)
        expect(mediaFailureText('unavailable', 'video')).toBe("Couldn't load this media")
    })
})
