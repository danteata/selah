import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAppStore } from '../../../store/appStore'
import type { Schedule, Slide } from '../../../types'
import { applyCommand, LanHost, LOCAL_ONLY, setLocalMode, SlideTracker, useLanHostStatus, type SessionMirror } from '../host'

const schedule = { _id: 'sch1', name: 'Sunday', authorId: '', editorIds: [], churchId: 'c1' } as Schedule

function slide(id: string, over: Partial<Slide> = {}): Slide {
    return { id, name: id, type: 'scripture', layout: 'single', contents: [`${id} text`], scheduleId: 'sch1', ...over } as unknown as Slide
}

function seed(slides: Slide[], over: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
    useAppStore.setState({
        activeSchedule: schedule,
        schedules: [schedule],
        activeSlides: slides,
        liveOutputSlidesId: slides.map((s) => s.id),
        sharedQueueSlideIds: [],
        liveSlideId: null,
        liveOutputBlanked: false,
        activeOverlay: 'none',
        sessionHeardVerses: [],
        ...over,
    })
}

const state = () => useAppStore.getState()

describe("the desk applying a phone's requests", () => {
    beforeEach(() => {
        localStorage.clear()
        seed([slide('a'), slide('b')])
    })

    it('puts a slide live, adding it first if the phone made it', async () => {
        await applyCommand({ k: 'live', slideId: 'new', slide: slide('new', { scheduleId: 'phone-schedule' }) }, 'operator', LOCAL_ONLY)
        expect(state().liveSlideId).toBe('new')
        // Joined the desk's service order, not the deck.
        expect(state().activeSlides.find((s) => s.id === 'new')?.scheduleId).toBe('sch1')
        expect(state().liveOutputSlidesId).toEqual(['a', 'b'])
    })

    it("refuses a contributor's live change in review mode, and leaves the screen alone", async () => {
        setLocalMode('moderated')
        await expect(applyCommand({ k: 'live', slideId: 'b' }, 'contributor', LOCAL_ONLY)).rejects.toThrow(/operator/)
        expect(state().liveSlideId).toBeNull()
    })

    it("suggests a contributor's slides in review mode and adds them to the deck in open mode", async () => {
        setLocalMode('moderated')
        await applyCommand({ k: 'add', slides: [slide('s1')] }, 'contributor', LOCAL_ONLY)
        expect(state().sharedQueueSlideIds).toEqual(['s1'])
        expect(state().liveOutputSlidesId).toEqual(['a', 'b'])

        setLocalMode('open')
        await applyCommand({ k: 'add', slides: [slide('o1'), slide('o2')], position: 1 }, 'contributor', LOCAL_ONLY)
        expect(state().liveOutputSlidesId).toEqual(['a', 'o1', 'o2', 'b'])
    })

    it('accepts a suggestion into the deck', async () => {
        seed([slide('a'), slide('s1')], { liveOutputSlidesId: ['a'], sharedQueueSlideIds: ['s1'] })
        await applyCommand({ k: 'accept', slideIds: ['s1'] }, 'operator', LOCAL_ONLY)
        expect(state().sharedQueueSlideIds).toEqual([])
        expect(state().liveOutputSlidesId).toEqual(['a', 's1'])
    })

    it("keeps the desk's own copy of local media when a phone edits the slide", async () => {
        seed([slide('a', { localFilePath: 'C:\\clip.mp4', background: 'asset://clip.mp4', backgroundType: 'video' } as Partial<Slide>)])
        await applyCommand({ k: 'slides', upserts: [slide('a', { name: 'Renamed', contents: ['new'] })], deletes: [] }, 'operator', LOCAL_ONLY)
        const a = state().activeSlides.find((s) => s.id === 'a')!
        expect(a.name).toBe('Renamed')
        expect(a.background).toBe('asset://clip.mp4')
        expect(a.localFilePath).toBe('C:\\clip.mp4')
    })

    it('removes slides the operator deleted on their phone, from the deck too', async () => {
        await applyCommand({ k: 'slides', upserts: [], deletes: ['a'] }, 'operator', LOCAL_ONLY)
        expect(state().activeSlides.map((s) => s.id)).toEqual(['b'])
        expect(state().liveOutputSlidesId).toEqual(['b'])
    })

    it('goes through the Convex session when the desk has one, so phones elsewhere hear it', async () => {
        const mirror: SessionMirror = {
            ...LOCAL_ONLY,
            connected: true,
            convexSessionId: 'sess1',
            convexMode: 'moderated',
            setLiveSlide: vi.fn(async () => {}),
            addToQueue: vi.fn(async () => {}),
            toggleBlank: vi.fn(async () => {}),
        }
        await applyCommand({ k: 'live', slideId: 'b' }, 'operator', mirror)
        expect(mirror.setLiveSlide).toHaveBeenCalledWith('b')
        await applyCommand({ k: 'add', slides: [slide('s1')] }, 'contributor', mirror)
        expect(mirror.addToQueue).toHaveBeenCalledWith(['s1'], undefined)
        await applyCommand({ k: 'blank', on: true }, 'operator', mirror)
        expect(state().liveOutputBlanked).toBe(true)
        expect(mirror.toggleBlank).toHaveBeenCalledWith(true)
        // Convex's mode rules, not the desk's local one.
        setLocalMode('open')
        await expect(applyCommand({ k: 'live', slideId: 'a' }, 'contributor', mirror)).rejects.toThrow()
    })
})

describe('what the phones are sent', () => {
    it('only the slides that changed, and the ones that went', () => {
        const tracker = new SlideTracker()
        expect(tracker.diff([slide('a'), slide('b')]).upserts.map((s) => s.id)).toEqual(['a', 'b'])
        const next = tracker.diff([slide('a', { name: 'A2' }), slide('c')])
        expect(next.upserts.map((s) => s.id)).toEqual(['a', 'c'])
        expect(next.deletes).toEqual(['b'])
        expect(tracker.diff([slide('a', { name: 'A2' }), slide('c')])).toEqual({ upserts: [], deletes: [] })
    })
})

describe('the host', () => {
    beforeEach(() => {
        localStorage.clear()
        seed([slide('a'), slide('b')])
    })

    function hostWithPhone() {
        const sent: Array<{ client?: number; message: Record<string, unknown> }> = []
        const host = new LanHost({
            send: async (client, text) => { sent.push({ client, message: JSON.parse(text) }) },
            broadcast: async (text) => { sent.push({ message: JSON.parse(text) }) },
        })
        host.deskUser = { id: 'u1', churchId: 'c1' }
        return { host, sent }
    }

    it("welcomes a phone with the session and its slides, and knows the desk's own user runs the screen", async () => {
        const { host, sent } = hostWithPhone()
        useAppStore.setState({ liveSlideId: 'b' })
        await host.event({ kind: 'joined', client: 7, device: { id: 'p1', name: 'Pixel' }, user: { id: 'u1' }, pairedNow: true })
        const welcome = sent[0]
        expect(welcome.client).toBe(7)
        expect(welcome.message.t).toBe('welcome')
        expect(welcome.message.role).toBe('operator')
        expect((welcome.message.session as { liveSlideId: string }).liveSlideId).toBe('b')
        expect((welcome.message.slides as Slide[]).map((s) => s.id)).toEqual(['a', 'b'])
        expect(useLanHostStatus.getState().phones).toEqual([{ client: 7, name: 'Pixel', role: 'operator' }])
    })

    it("applies a phone's request, tells every phone, then answers the phone that asked", async () => {
        const { host, sent } = hostWithPhone()
        await host.event({ kind: 'joined', client: 7, device: { id: 'p1', name: 'Pixel' }, user: { id: 'u1' }, pairedNow: false })
        host.flush()
        sent.length = 0

        await host.event({ kind: 'message', client: 7, text: JSON.stringify({ t: 'cmd', id: 3, cmd: { k: 'live', slideId: 'a' } }) })
        expect(state().liveSlideId).toBe('a')
        const session = sent.find((s) => s.message.t === 'session')
        expect((session?.message.session as { liveSlideId: string }).liveSlideId).toBe('a')
        expect(sent.at(-1)).toEqual({ client: 7, message: { t: 'result', id: 3, ok: true } })
    })

    it('answers a refused request with why', async () => {
        const { host, sent } = hostWithPhone()
        setLocalMode('strict')
        await host.event({ kind: 'joined', client: 8, device: { id: 'p2', name: 'Helper' }, user: { id: 'u9' }, pairedNow: false })
        await host.event({ kind: 'message', client: 8, text: JSON.stringify({ t: 'cmd', id: 1, cmd: { k: 'live', slideId: 'a' } }) })
        expect(state().liveSlideId).toBeNull()
        expect(sent.at(-1)?.message).toMatchObject({ t: 'result', id: 1, ok: false, error: expect.stringMatching(/operator/) })
    })

    it('forgets a phone that left', async () => {
        const { host } = hostWithPhone()
        await host.event({ kind: 'joined', client: 7, device: { id: 'p1', name: 'Pixel' }, user: null, pairedNow: false })
        await host.event({ kind: 'left', client: 7 })
        expect(useLanHostStatus.getState().phones).toEqual([])
    })
})
