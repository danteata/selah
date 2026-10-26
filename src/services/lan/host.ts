/**
 * The desk's side of the local-network session (see protocol.ts).
 *
 * The desk's own store is the session: phones are told what it holds, and a
 * phone's request is applied to it, so the projector, the desk's screens and
 * every phone stay one picture. When the desk is also in a Convex session and
 * Convex is reachable, requests go through the desk's live-session actions
 * instead, so phones away from the building and the session's record see
 * them too; when it isn't, the store change is the whole of it.
 *
 * One host for the life of the app, not per mount: the Dashboard comes and
 * goes as the operator opens Settings, and the phones shouldn't notice.
 */

import { create } from 'zustand'
import { useAppStore } from '../../store/appStore'
import { sessionTemplatesFrom, toSyncableSlide } from '../../hooks/liveSlideSync'
import type { Slide } from '../../types'
import {
    addsToDeck,
    refusal,
    roleFor,
    type CollaborationMode,
    type DeskMessage,
    type LanCommand,
    type LanRole,
    type LanUser,
    type PhoneMessage,
    type SessionMeta,
} from './protocol'

type AppState = ReturnType<typeof useAppStore.getState>

/** The desk's Convex session, as far as the host needs it. */
export interface SessionMirror {
    /** In a Convex session, and Convex is reachable. */
    connected: boolean
    convexSessionId: string | null
    /** The Convex session's mode, while connected. */
    convexMode: CollaborationMode | null
    setLiveSlide: (slideId: string | null) => Promise<void>
    addToQueue: (slideIds: string[], position?: number) => Promise<void>
    removeFromQueue: (slideIds: string[]) => Promise<void>
    acceptFromQueue: (slideIds: string[]) => Promise<void>
    reorderQueue: (slideIds: string[]) => Promise<void>
    toggleBlank: (isBlank: boolean) => Promise<void>
    setOverlay: (overlay?: string, alertId?: string) => Promise<void>
    updateCollaborationMode: (mode: CollaborationMode) => Promise<void>
}

const noop = async () => {}

/** No Convex session: everything happens on the desk alone. */
export const LOCAL_ONLY: SessionMirror = {
    connected: false,
    convexSessionId: null,
    convexMode: null,
    setLiveSlide: noop,
    addToQueue: noop,
    removeFromQueue: noop,
    acceptFromQueue: noop,
    reorderQueue: noop,
    toggleBlank: noop,
    setOverlay: async (overlay) => useAppStore.getState().setActiveOverlay(overlay || 'none'),
    updateCollaborationMode: noop,
}

// --- Who may drive the screen without Convex ---------------------------------

const MODE_KEY = 'selah-lan-mode'
const MODES: readonly CollaborationMode[] = ['strict', 'moderated', 'open']

/**
 * The session's mode when the desk isn't in a Convex session: the last one
 * it had, so a service that loses the internet keeps its rules. Review
 * ("moderated") by default, like a new Convex session.
 */
export function localMode(): CollaborationMode {
    try {
        const saved = localStorage.getItem(MODE_KEY) as CollaborationMode | null
        return saved && MODES.includes(saved) ? saved : 'moderated'
    } catch {
        return 'moderated'
    }
}

export function setLocalMode(mode: CollaborationMode): void {
    try {
        localStorage.setItem(MODE_KEY, mode)
    } catch {
        // Unsaved: the mode holds until the app restarts.
    }
}

// --- What the phones are told ------------------------------------------------

/** The slides of the desk's service order, as a phone can use them. */
export function sharedSlides(state: AppState): Slide[] {
    const scheduleId = state.activeSchedule?._id ?? ''
    return state.activeSlides
        .filter((slide) => !slide.scheduleId || slide.scheduleId === scheduleId)
        .map((slide, index) => ({ ...toSyncableSlide(slide, index), scheduleId: slide.scheduleId || scheduleId }) as unknown as Slide)
}

export function sessionMetaOf(state: AppState, mirror: SessionMirror, deskUser: LanUser | null): SessionMeta {
    return {
        scheduleId: state.activeSchedule?._id ?? null,
        scheduleName: state.activeSchedule?.name ?? null,
        churchId: deskUser?.churchId || null,
        mode: mirror.convexMode ?? localMode(),
        liveSlideId: state.liveSlideId || null,
        blank: state.liveOutputBlanked,
        overlay: state.activeOverlay,
        deck: state.liveOutputSlidesId ?? state.activeSlides.map((slide) => slide.id),
        queue: state.sharedQueueSlideIds,
        defaultTemplates: sessionTemplatesFrom(state.settings.defaultTemplates),
        heardVerses: state.sessionHeardVerses,
        convexSessionId: mirror.convexSessionId,
    }
}

/** The slides the phones already have, so only changes are sent. */
export class SlideTracker {
    private sent = new Map<string, string>()

    diff(slides: Slide[]): { upserts: Slide[]; deletes: string[] } {
        const next = new Map(slides.map((slide) => [slide.id, JSON.stringify(slide)]))
        const upserts = slides.filter((slide) => this.sent.get(slide.id) !== next.get(slide.id))
        const deletes = [...this.sent.keys()].filter((id) => !next.has(id))
        this.sent = next
        return { upserts, deletes }
    }
}

// --- Applying a phone's request ----------------------------------------------

/**
 * A slide from a phone over the desk's copy of it. Phones never get the
 * desk's local media (a file path, a `blob:` URL), so the desk keeps its own,
 * as replaceSlidesForSchedule does for slides arriving through Convex.
 */
function withLocalMedia(remote: Slide, local: Slide): Slide {
    const localMediaId = remote.localMediaId ?? local.localMediaId
    const localFilePath = remote.localFilePath ?? local.localFilePath
    const isLocalMedia = Boolean(localMediaId || localFilePath)
    return {
        ...local,
        ...remote,
        localMediaId,
        localFilePath,
        background: remote.background || (isLocalMedia ? local.background : remote.background),
    }
}

/** Put a phone's slides into the desk's service order, without touching the deck. */
export function mergeSlides(incoming: Slide[], scheduleId: string | null): void {
    if (incoming.length === 0) return
    useAppStore.setState((state) => {
        const byId = new Map(incoming.map((slide) => [slide.id, scheduleId ? { ...slide, scheduleId } : slide]))
        const activeSlides = state.activeSlides.map((local) => {
            const remote = byId.get(local.id)
            if (!remote) return local
            byId.delete(local.id)
            return withLocalMedia(remote, local)
        })
        return { activeSlides: [...activeSlides, ...byId.values()] }
    })
}

function removeSlides(slideIds: string[]): void {
    if (slideIds.length === 0) return
    const gone = new Set(slideIds)
    useAppStore.setState((state) => ({
        activeSlides: state.activeSlides.filter((slide) => !gone.has(slide.id)),
        liveOutputSlidesId: state.liveOutputSlidesId?.filter((id) => !gone.has(id)) ?? null,
    }))
}

/** Add `slideIds` to the operator's deck at `position` (the end by default). */
function addToDeck(slideIds: string[], position?: number): void {
    const state = useAppStore.getState()
    const incoming = new Set(slideIds)
    // No deck of its own yet means every slide, in order.
    const deck = state.liveOutputSlidesId ?? state.activeSlides.map((slide) => slide.id).filter((id) => !incoming.has(id))
    const fresh = slideIds.filter((id) => !deck.includes(id))
    if (fresh.length === 0) return
    const at = position !== undefined && position >= 0 && position <= deck.length ? position : deck.length
    state.setLiveOutputSlidesId([...deck.slice(0, at), ...fresh, ...deck.slice(at)])
}

/**
 * Do what a phone asked, or throw why not. The rules are Convex's
 * (convex/liveSessions.ts); so is the shape of each change, so a phone
 * over Wi-Fi and a phone over Convex leave the session the same way.
 */
export async function applyCommand(cmd: LanCommand, role: LanRole, mirror: SessionMirror): Promise<void> {
    const mode = mirror.convexMode ?? localMode()
    const why = refusal(cmd, role, mode)
    if (why) throw new Error(why)

    const store = useAppStore.getState()
    const scheduleId = store.activeSchedule?._id ?? null

    switch (cmd.k) {
        case 'live':
            if (cmd.slide) mergeSlides([cmd.slide], scheduleId)
            if (mirror.connected) {
                await mirror.setLiveSlide(cmd.slideId)
            } else {
                store.setLiveSlide(cmd.slideId)
                // A new live slide shows: Convex's setLiveSlide unblanks too.
                if (cmd.slideId) store.setLiveOutputBlanked(false)
            }
            return
        case 'add': {
            mergeSlides(cmd.slides, scheduleId)
            const ids = cmd.slides.map((slide) => slide.id)
            if (addsToDeck(role, mode)) addToDeck(ids, cmd.position)
            else if (mirror.connected) await mirror.addToQueue(ids, cmd.position)
            else store.addSharedQueueSlideIds(ids)
            return
        }
        case 'unqueue':
            if (mirror.connected) await mirror.removeFromQueue(cmd.slideIds)
            else store.removeSharedQueueSlideIds(cmd.slideIds)
            return
        case 'accept':
            // Into the deck here at once; Convex adds it there too.
            store.removeSharedQueueSlideIds(cmd.slideIds)
            addToDeck(cmd.slideIds)
            if (mirror.connected) await mirror.acceptFromQueue(cmd.slideIds)
            return
        case 'reorderQueue':
            store.setSharedQueueSlideIds(cmd.slideIds)
            if (mirror.connected) await mirror.reorderQueue(cmd.slideIds)
            return
        case 'deck':
            // The desk's own sync shares its deck with Convex.
            store.setLiveOutputSlidesId(cmd.slideIds)
            return
        case 'slides':
            mergeSlides(cmd.upserts, scheduleId)
            removeSlides(cmd.deletes)
            return
        case 'blank':
            store.setLiveOutputBlanked(cmd.on)
            if (mirror.connected) await mirror.toggleBlank(cmd.on)
            return
        case 'overlay':
            await (mirror.connected ? mirror : LOCAL_ONLY).setOverlay(cmd.overlay, cmd.alertId)
            return
        case 'mode':
            setLocalMode(cmd.mode)
            if (mirror.connected) await mirror.updateCollaborationMode(cmd.mode)
            return
    }
}

// --- The host -----------------------------------------------------------------

interface Phone {
    client: number
    name: string
    user: LanUser | null
    role: LanRole
}

export interface LanTransport {
    send: (client: number, text: string) => Promise<unknown>
    broadcast: (text: string) => Promise<unknown>
}

/** What the desk's "Phones" panel shows. */
export interface LanHostStatus {
    listening: boolean
    error: string | null
    name: string | null
    addresses: string[]
    phones: Array<{ client: number; name: string; role: LanRole }>
    /** The desk is in a Convex session, whose mode the phones follow. */
    inConvexSession: boolean
}

export const useLanHostStatus = create<LanHostStatus>(() => ({
    listening: false,
    error: null,
    name: null,
    addresses: [],
    phones: [],
    inConvexSession: false,
}))

/** What the Rust side reports (src-tauri/src/lan.rs, `HostEvent`). */
export type HostEvent =
    | { kind: 'joined'; client: number; device: { id?: string; name?: string } | null; user: LanUser | null; pairedNow: boolean }
    | { kind: 'message'; client: number; text: string }
    | { kind: 'left'; client: number }

export class LanHost {
    private phones = new Map<number, Phone>()
    private tracker = new SlideTracker()
    private lastMeta = ''
    mirror: SessionMirror = LOCAL_ONLY
    deskUser: LanUser | null = null

    private transport: LanTransport

    constructor(transport: LanTransport) {
        this.transport = transport
    }

    async event(event: HostEvent): Promise<void> {
        switch (event.kind) {
            case 'joined': {
                const role = roleFor(event.user, this.deskUser)
                const name = event.device?.name || event.user?.name || 'Phone'
                this.phones.set(event.client, { client: event.client, name, user: event.user, role })
                this.publishPhones()
                const state = useAppStore.getState()
                await this.send(event.client, {
                    t: 'welcome',
                    role,
                    session: sessionMetaOf(state, this.mirror, this.deskUser),
                    slides: sharedSlides(state),
                })
                return
            }
            case 'left':
                this.phones.delete(event.client)
                this.publishPhones()
                return
            case 'message':
                return this.request(event.client, event.text)
        }
    }

    private async request(client: number, text: string): Promise<void> {
        const phone = this.phones.get(client)
        let message: PhoneMessage
        try {
            message = JSON.parse(text) as PhoneMessage
        } catch {
            return
        }
        if (!phone || message.t !== 'cmd' || !message.cmd) return
        let error: string | undefined
        try {
            await applyCommand(message.cmd, phone.role, this.mirror)
        } catch (err) {
            error = err instanceof Error ? err.message : String(err)
        }
        // Everyone sees the change before the asker hears it's done.
        this.flush()
        await this.send(client, { t: 'result', id: message.id, ok: !error, ...(error ? { error } : {}) })
    }

    /** Tell the phones what changed since the last time. */
    flush(): void {
        const state = useAppStore.getState()
        const meta = JSON.stringify(sessionMetaOf(state, this.mirror, this.deskUser))
        const slides = this.tracker.diff(sharedSlides(state))
        if (this.phones.size === 0) {
            this.lastMeta = meta
            return
        }
        if (slides.upserts.length > 0 || slides.deletes.length > 0) {
            void this.transport.broadcast(JSON.stringify({ t: 'slides', ...slides } satisfies DeskMessage))
        }
        if (meta !== this.lastMeta) {
            this.lastMeta = meta
            void this.transport.broadcast(`{"t":"session","session":${meta}}`)
        }
    }

    private send(client: number, message: DeskMessage): Promise<unknown> {
        return this.transport.send(client, JSON.stringify(message)).catch(() => false)
    }

    private publishPhones(): void {
        useLanHostStatus.setState({
            phones: [...this.phones.values()].map(({ client, name, role }) => ({ client, name, role })),
        })
    }
}
