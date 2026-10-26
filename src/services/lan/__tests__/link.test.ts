import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const tauri = vi.hoisted(() => ({
    invoke: vi.fn(),
    handler: null as null | ((event: { payload: unknown }) => void),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, cb: (event: { payload: unknown }) => void) => {
        tauri.handler = cb
        return () => {}
    }),
}))

import { useAppStore } from '../../../store/appStore'
import type { Slide } from '../../../types'
import { deskToken, rememberDeskToken } from '../identity'
import { connectToDesk, disconnectFromDesk, knownDesks, sendCommand, useLanLink, type DeskAddress } from '../link'
import type { SessionMeta } from '../protocol'

const desk: DeskAddress = { id: 'd1', name: 'Main desk', addresses: ['192.168.1.20'], port: 17494 }

function slide(id: string): Slide {
    return { id, name: id, type: 'scripture', contents: [id], scheduleId: 'sch1' } as unknown as Slide
}

const session = (over: Partial<SessionMeta> = {}): SessionMeta => ({
    scheduleId: 'sch1',
    scheduleName: 'Sunday',
    churchId: 'c1',
    mode: 'moderated',
    liveSlideId: 'b',
    blank: false,
    overlay: 'none',
    deck: ['a', 'b'],
    queue: [],
    defaultTemplates: null,
    heardVerses: [],
    convexSessionId: null,
    ...over,
})

/** The desk saying something on link `link`. */
function fromDesk(message: unknown, link = 1) {
    tauri.handler?.({ payload: { link, message: JSON.stringify(message) } })
}

function connectsAs(link: number, token: string | null = null) {
    tauri.invoke.mockImplementation(async (command: string) => {
        if (command === 'lan_connect') return { link, desk: { id: 'd1', name: 'Main desk' }, token }
        if (command === 'lan_link_send') return true
        return undefined
    })
}

const state = () => useAppStore.getState()

describe('the phone linked to the desk', () => {
    beforeEach(async () => {
        localStorage.clear()
        tauri.invoke.mockReset()
        useAppStore.setState({ activeSchedule: null, activeSlides: [slide('mine')], liveOutputSlidesId: ['mine'], liveSlideId: null, sharedQueueSlideIds: [] })
        tauri.invoke.mockResolvedValue(undefined)
        await disconnectFromDesk()
        useLanLink.setState({ status: 'idle', desk: null, error: null, autoConnect: true })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('asks for the code for a desk it has never paired with', async () => {
        expect(await connectToDesk(desk)).toBe(false)
        expect(useLanLink.getState().status).toBe('needs-code')
        expect(tauri.invoke).not.toHaveBeenCalledWith('lan_connect', expect.anything())
    })

    it('pairs with the code, keeps the token, and mirrors the desk once welcomed', async () => {
        connectsAs(1, 'tok')
        expect(await connectToDesk(desk, '123456')).toBe(true)
        expect(tauri.invoke).toHaveBeenCalledWith('lan_connect', expect.objectContaining({ code: '123456', token: null, port: 17494 }))
        expect(deskToken('d1')).toBe('tok')
        expect(knownDesks()[0]).toMatchObject({ id: 'd1', addresses: ['192.168.1.20'] })

        fromDesk({ t: 'welcome', role: 'contributor', session: session(), slides: [slide('a'), slide('b')] })
        expect(useLanLink.getState()).toMatchObject({ status: 'connected', role: 'contributor' })
        expect(state().activeSchedule?._id).toBe('sch1')
        expect(state().liveSlideId).toBe('b')
        expect(state().liveOutputSlidesId).toEqual(['a', 'b'])
        expect(state().activeSlides.map((s) => s.id)).toEqual(['a', 'b'])

        fromDesk({ t: 'slides', upserts: [slide('c')], deletes: ['a'] })
        expect(state().activeSlides.map((s) => s.id)).toEqual(['b', 'c'])
        fromDesk({ t: 'session', session: session({ liveSlideId: 'c', deck: ['b', 'c'] }) })
        expect(state().liveSlideId).toBe('c')
    })

    it('takes a welcome that arrives before the connect call returns', async () => {
        rememberDeskToken('d1', 'tok')
        tauri.invoke.mockImplementation(async (command: string) => {
            if (command !== 'lan_connect') return undefined
            fromDesk({ t: 'welcome', role: 'operator', session: session(), slides: [slide('a')] }, 2)
            return { link: 2, desk: { id: 'd1' }, token: null }
        })
        await connectToDesk(desk)
        expect(useLanLink.getState()).toMatchObject({ status: 'connected', role: 'operator' })
    })

    it('ignores the goodbye of a link it already replaced', async () => {
        rememberDeskToken('d1', 'tok')
        connectsAs(3)
        await connectToDesk(desk)
        fromDesk({ t: 'welcome', role: 'contributor', session: session(), slides: [] }, 3)
        tauri.handler?.({ payload: { link: 2, closed: 'disconnected' } })
        expect(useLanLink.getState().status).toBe('connected')
        tauri.handler?.({ payload: { link: 3, closed: 'the desk stopped answering' } })
        expect(useLanLink.getState().status).toBe('idle')
    })

    it('forgets a token the desk no longer accepts, and asks for the code again', async () => {
        rememberDeskToken('d1', 'stale')
        tauri.invoke.mockImplementation(async (command: string) => {
            if (command === 'lan_connect') throw 'denied: unpaired'
            return undefined
        })
        expect(await connectToDesk(desk)).toBe(false)
        expect(useLanLink.getState().status).toBe('needs-code')
        expect(deskToken('d1')).toBeNull()
    })

    it("resolves a request on the desk's yes and rejects with its reason", async () => {
        rememberDeskToken('d1', 'tok')
        connectsAs(4)
        await connectToDesk(desk)
        fromDesk({ t: 'welcome', role: 'contributor', session: session(), slides: [] }, 4)

        const ok = sendCommand({ k: 'unqueue', slideIds: ['x'] })
        await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('lan_link_send', expect.anything()))
        const sentId = (call: unknown[]) => JSON.parse((call[1] as { text: string }).text).id as number
        const sends = () => tauri.invoke.mock.calls.filter((call) => call[0] === 'lan_link_send')
        fromDesk({ t: 'result', id: sentId(sends()[0]), ok: true }, 4)
        await expect(ok).resolves.toBeUndefined()

        const no = sendCommand({ k: 'live', slideId: 'a' })
        await vi.waitFor(() => expect(sends()).toHaveLength(2))
        fromDesk({ t: 'result', id: sentId(sends()[1]), ok: false, error: 'Only the operator can change the live slide' }, 4)
        await expect(no).rejects.toThrow('Only the operator')
    })

    it("on the operator's own phone, sends slides added there and the new deck to the desk", async () => {
        rememberDeskToken('d1', 'tok')
        connectsAs(5)
        await connectToDesk(desk)
        fromDesk({ t: 'welcome', role: 'operator', session: session(), slides: [slide('a'), slide('b')] }, 5)

        state().appendActiveSlides([slide('song-1'), slide('song-2')])
        await vi.waitFor(() => {
            const sent = tauri.invoke.mock.calls
                .filter((call) => call[0] === 'lan_link_send')
                .map((call) => JSON.parse((call[1] as { text: string }).text).cmd)
            expect(sent).toContainEqual(expect.objectContaining({ k: 'slides', deletes: [] }))
            expect(sent.find((cmd) => cmd.k === 'slides').upserts.map((s: Slide) => s.id)).toEqual(['song-1', 'song-2'])
            expect(sent).toContainEqual({ k: 'deck', slideIds: ['a', 'b', 'song-1', 'song-2'] })
        })
    })

    it("doesn't echo the desk's own changes back to it", async () => {
        rememberDeskToken('d1', 'tok')
        connectsAs(6)
        await connectToDesk(desk)
        fromDesk({ t: 'welcome', role: 'operator', session: session(), slides: [slide('a'), slide('b')] }, 6)
        fromDesk({ t: 'slides', upserts: [slide('c')], deletes: [] }, 6)
        fromDesk({ t: 'session', session: session({ deck: ['a', 'b', 'c'] }) }, 6)
        await new Promise((resolve) => setTimeout(resolve, 250))
        expect(tauri.invoke.mock.calls.filter((call) => call[0] === 'lan_link_send')).toEqual([])
    })
})
