/**
 * The phone's side of the local-network session (see protocol.ts).
 *
 * Connected, the phone mirrors the desk: the desk's slides, deck, live slide
 * and suggestions land in this phone's store the way they would arrive from
 * Convex, and what the phone does goes to the desk as a request. Not
 * connected (no desk found, the desk went away), the live session goes
 * through Convex as before; useLiveSession picks the route.
 *
 * The connection itself is the phone app's Rust (mobile/src-tauri,
 * `lan_connect`): a web view can't reliably open a socket to a local address.
 */

import { create } from 'zustand'
import { useAppStore } from '../../store/appStore'
import type { Schedule, Slide } from '../../types'
import { deskToken, forgetDeskToken, lanDevice, recallLanUser, rememberDeskToken } from './identity'
import type { DeskMessage, LanCommand, LanRole, SessionMeta } from './protocol'

/** A desk this phone can reach: found on the Wi-Fi, or typed in. */
export interface DeskAddress {
    /** Unknown until the first connection to a desk typed in by address. */
    id: string | null
    name: string
    addresses: string[]
    port: number
}

export type LinkStatus =
    /** Not connected; the session goes through Convex. */
    | 'idle'
    | 'connecting'
    | 'connected'
    /** The desk doesn't know this phone: it needs the code on the desk's screen. */
    | 'needs-code'

export interface LanLinkState {
    status: LinkStatus
    desk: DeskAddress | null
    role: LanRole
    session: SessionMeta | null
    /** Why the last attempt failed, in words for the person holding the phone. */
    error: string | null
    /** Reconnect on its own. Off once the person disconnects, until they connect again. */
    autoConnect: boolean
}

export const useLanLink = create<LanLinkState>(() => ({
    status: 'idle',
    desk: null,
    role: 'contributor',
    session: null,
    error: null,
    autoConnect: true,
}))

/** A desk found on the Wi-Fi, with the church it announced (if any). */
export interface FoundDesk extends DeskAddress {
    church: string | null
}

/** The last look for desks, for the "On this Wi-Fi" list. */
export const useLanDesks = create<{ desks: FoundDesk[]; searching: boolean; error: string | null }>(() => ({
    desks: [],
    searching: false,
    error: null,
}))

interface DiscoveredDesk {
    name: string
    addresses: string[]
    port: number
    properties: Record<string, string>
}

/** Look for desks on this Wi-Fi (mobile/src-tauri `discover_desks`). */
export async function findDesks(timeoutMs = 3000): Promise<FoundDesk[]> {
    useLanDesks.setState({ searching: true, error: null })
    try {
        const found = await invoke<DiscoveredDesk[]>('discover_desks', { timeoutMs })
        const desks = found.map((desk) => ({
            id: desk.properties.id || null,
            name: desk.name,
            addresses: desk.addresses,
            port: desk.port,
            church: desk.properties.church || null,
        }))
        useLanDesks.setState({ desks, searching: false })
        return desks
    } catch (err) {
        useLanDesks.setState({ searching: false, error: err instanceof Error ? err.message : String(err) })
        return []
    }
}

export const DESK_PORT = 17494
const REQUEST_TIMEOUT_MS = 8000
const KNOWN_DESKS_KEY = 'selah-lan-desks'

let core: Promise<typeof import('@tauri-apps/api/core')> | null = null

/** Tauri's bridge, loaded once: the web build never needs it. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    core ??= import('@tauri-apps/api/core')
    return (await core).invoke<T>(command, args)
}

// --- Desks this phone has connected to ----------------------------------------

/**
 * Desks this phone has reached, with their addresses: tried directly when
 * discovery finds nothing, since a network that drops multicast (many church
 * networks) still carries an ordinary connection.
 */
export function knownDesks(): DeskAddress[] {
    try {
        return JSON.parse(localStorage.getItem(KNOWN_DESKS_KEY) || '[]') as DeskAddress[]
    } catch {
        return []
    }
}

function rememberDesk(desk: DeskAddress): void {
    if (!desk.id) return
    const others = knownDesks().filter((known) => known.id !== desk.id)
    try {
        localStorage.setItem(KNOWN_DESKS_KEY, JSON.stringify([desk, ...others].slice(0, 5)))
    } catch {
        // Unsaved: discovery still finds the desk next time.
    }
}

// --- Applying what the desk says ----------------------------------------------

/**
 * True while the desk's state is being written into this phone's store, so
 * the operator's-phone watcher below doesn't send it straight back.
 */
let applying = false

function applyingRemote(apply: () => void): void {
    applying = true
    try {
        apply()
    } finally {
        applying = false
    }
}

function scheduleFor(session: SessionMeta, current: Schedule | null, known: Schedule[]): Schedule | null {
    if (!session.scheduleId) return null
    if (current?._id === session.scheduleId) return null
    return known.find((schedule) => schedule._id === session.scheduleId) ?? {
        _id: session.scheduleId,
        name: session.scheduleName || 'Service',
        authorId: '',
        editorIds: [],
        churchId: session.churchId ?? '',
    }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function applySession(session: SessionMeta): void {
    applyingRemote(() => {
        const store = useAppStore.getState()
        const schedule = scheduleFor(session, store.activeSchedule, store.schedules)
        if (schedule) store.setActiveSchedule(schedule)
        if ((store.liveSlideId || null) !== session.liveSlideId) store.setLiveSlide(session.liveSlideId)
        if (!same(store.liveOutputSlidesId, session.deck)) store.setLiveOutputSlidesId(session.deck)
        if (!same(store.sharedQueueSlideIds, session.queue)) store.setSharedQueueSlideIds(session.queue)
        if (store.liveOutputBlanked !== session.blank) store.setLiveOutputBlanked(session.blank)
        if (store.activeOverlay !== session.overlay) store.setActiveOverlay(session.overlay)
        if (!same(store.sessionDefaultTemplates, session.defaultTemplates)) store.setSessionDefaultTemplates(session.defaultTemplates)
        if (!same(store.sessionHeardVerses, session.heardVerses)) store.setSessionHeardVerses(session.heardVerses)
    })
}

/**
 * The desk's slides into this phone's store. `all` is the desk's whole
 * service order (on connecting): it replaces this phone's copy of that
 * schedule, while slides of other schedules stay put.
 */
export function applySlides(upserts: Slide[], deletes: string[], all = false): void {
    applyingRemote(() => {
        useAppStore.setState((state) => {
            const gone = new Set(deletes)
            const incoming = new Map(upserts.map((slide) => [slide.id, slide]))
            const scheduleIds = new Set(upserts.map((slide) => slide.scheduleId).filter(Boolean))
            const kept = state.activeSlides
                .filter((slide) => !gone.has(slide.id))
                .filter((slide) => !all || incoming.has(slide.id) || (slide.scheduleId && !scheduleIds.has(slide.scheduleId)))
                .map((slide) => {
                    const remote = incoming.get(slide.id)
                    if (!remote) return slide
                    incoming.delete(slide.id)
                    return { ...slide, ...remote }
                })
            return { activeSlides: [...kept, ...incoming.values()] }
        })
    })
}

// --- Requests ------------------------------------------------------------------

let nextRequest = 1
const pending = new Map<number, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function settle(id: number, error?: string): void {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    if (error) request.reject(new Error(error))
    else request.resolve()
}

/** Ask the desk to do something. Resolves once it has; rejects with why not. */
export function sendCommand(cmd: LanCommand): Promise<void> {
    if (useLanLink.getState().status !== 'connected') return Promise.reject(new Error('Not connected to the desk'))
    const id = nextRequest++
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => settle(id, "The desk didn't answer"), REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        invoke<boolean>('lan_link_send', { text: JSON.stringify({ t: 'cmd', id, cmd }) })
            .then((sent) => { if (!sent) settle(id, 'Not connected to the desk') })
            .catch((err) => settle(id, String(err)))
    })
}

function onDeskMessage(text: string): void {
    let message: DeskMessage
    try {
        message = JSON.parse(text) as DeskMessage
    } catch {
        return
    }
    switch (message.t) {
        case 'welcome':
            applySlides(message.slides, [], true)
            applySession(message.session)
            useLanLink.setState({ status: 'connected', role: message.role, session: message.session, error: null })
            watchOperatorEdits(message.role === 'operator')
            return
        case 'session':
            applySession(message.session)
            useLanLink.setState({ session: message.session })
            return
        case 'slides':
            applySlides(message.upserts, message.deletes)
            return
        case 'result':
            settle(message.id, message.ok ? undefined : message.error || 'The desk said no')
    }
}

function onClosed(): void {
    for (const id of [...pending.keys()]) settle(id, 'The connection to the desk was lost')
    watchOperatorEdits(false)
    useLanLink.setState({ status: 'idle', session: null })
}

let listening: Promise<unknown> | null = null
/** The link this phone has now; events from one it replaced are ignored. */
let currentLink: number | null = null
/** Messages that came before `lan_connect` said which link they're for. */
let early: Array<{ link: number; message?: string; closed?: string }> = []

function onLinkEvent(event: { link: number; message?: string; closed?: string }): void {
    if (currentLink === null) {
        early.push(event)
        return
    }
    if (event.link !== currentLink) return
    if (event.message !== undefined) onDeskMessage(event.message)
    if (event.closed !== undefined) {
        currentLink = null
        onClosed()
    }
}

function listenOnce(): Promise<unknown> {
    listening ??= import('@tauri-apps/api/event').then(({ listen }) =>
        listen<{ link: number; message?: string; closed?: string }>('lan-link', (event) => onLinkEvent(event.payload)),
    )
    return listening
}

// --- The operator's phone edits the desk's service order ---------------------

let stopWatching: (() => void) | null = null
let watchTimer: ReturnType<typeof setTimeout> | null = null

/** The phone's copy of the session's slides and deck, as last agreed with the desk. */
function sessionPicture(): { slides: Map<string, string>; deck: string } {
    const state = useAppStore.getState()
    const scheduleId = useLanLink.getState().session?.scheduleId
    const slides = state.activeSlides.filter((slide) => !scheduleId || slide.scheduleId === scheduleId || !slide.scheduleId)
    return { slides: new Map(slides.map((slide) => [slide.id, JSON.stringify(slide)])), deck: JSON.stringify(state.liveOutputSlidesId ?? []) }
}

/**
 * On the operator's own phone, slides added, edited or removed and the deck
 * reordered go to the desk, the way the operator's device shares them through
 * Convex: a whole song added from the phone used to stop at its first slide.
 * A contributor's phone suggests instead (useLanSession's addToQueue).
 */
function watchOperatorEdits(on: boolean): void {
    stopWatching?.()
    stopWatching = null
    if (!on) return
    let agreed = sessionPicture()
    const unsubscribe = useAppStore.subscribe(() => {
        if (applying) {
            agreed = sessionPicture()
            return
        }
        if (watchTimer) return
        watchTimer = setTimeout(() => {
            watchTimer = null
            const now = sessionPicture()
            const slides = useAppStore.getState().activeSlides
            const upserts = slides.filter((slide) => now.slides.has(slide.id) && now.slides.get(slide.id) !== agreed.slides.get(slide.id))
            const deletes = [...agreed.slides.keys()].filter((id) => !now.slides.has(id))
            const deckChanged = now.deck !== agreed.deck
            agreed = now
            if (upserts.length > 0 || deletes.length > 0) void sendCommand({ k: 'slides', upserts, deletes }).catch(() => {})
            if (deckChanged) void sendCommand({ k: 'deck', slideIds: JSON.parse(now.deck) as string[] }).catch(() => {})
        }, 150)
    })
    stopWatching = () => {
        unsubscribe()
        if (watchTimer) clearTimeout(watchTimer)
        watchTimer = null
    }
}

// --- Connecting ------------------------------------------------------------------

/** Turn the Rust side's error into what to tell the person holding the phone. */
function explain(error: string): { status: LinkStatus; message: string } {
    if (error.startsWith('denied: unpaired')) return { status: 'needs-code', message: 'Enter the code shown on the desk.' }
    if (error.startsWith('denied: code')) return { status: 'needs-code', message: "That code didn't match. Check the desk's screen and try again." }
    if (error.startsWith('denied: not-pairing')) {
        return { status: 'needs-code', message: 'On the desk, open Phones and choose "Pair a phone" first.' }
    }
    if (error.startsWith('protocol:')) return { status: 'idle', message: "That address isn't a Selah desk." }
    return { status: 'idle', message: "Couldn't reach the desk. Is it on the same Wi-Fi?" }
}

/**
 * Connect to `desk`, with this phone's token for it or with `code`, the
 * pairing code on the desk's screen. Resolves true once connected.
 */
export async function connectToDesk(desk: DeskAddress, code?: string): Promise<boolean> {
    const token = desk.id ? deskToken(desk.id) : null
    if (!token && !code) {
        useLanLink.setState({ status: 'needs-code', desk, error: null })
        return false
    }
    useLanLink.setState({ status: 'connecting', desk, error: null, autoConnect: true })
    await listenOnce()
    currentLink = null
    early = []
    try {
        const connected = await invoke<{ link: number; desk: { id?: string; name?: string }; token: string | null }>('lan_connect', {
            addresses: desk.addresses,
            port: desk.port,
            device: lanDevice(),
            user: recallLanUser(),
            token: code ? null : token,
            code: code ?? null,
        })
        const id = connected.desk.id || desk.id
        const reached: DeskAddress = { ...desk, id, name: connected.desk.name || desk.name }
        if (id && connected.token) rememberDeskToken(id, connected.token)
        rememberDesk(reached)
        // "connected" once the desk's welcome has filled the store.
        useLanLink.setState({ desk: reached })
        currentLink = connected.link
        const arrived = early
        early = []
        for (const event of arrived) onLinkEvent(event)
        return true
    } catch (err) {
        const { status, message } = explain(String(err))
        if (status === 'needs-code' && desk.id && !code) forgetDeskToken(desk.id)
        useLanLink.setState({ status, error: message })
        return false
    }
}

/** Leave the desk; the session carries on through Convex. */
export async function disconnectFromDesk(): Promise<void> {
    currentLink = null
    useLanLink.setState({ autoConnect: false })
    await invoke('lan_disconnect').catch(() => {})
    onClosed()
}
