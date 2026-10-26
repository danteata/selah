import { useEffect, useRef } from 'react'
import { isTauri } from '../platform'
import { LanHost, LOCAL_ONLY, useLanHostStatus, type HostEvent, type SessionMirror } from '../services/lan/host'
import { recallLanUser } from '../services/lan/identity'
import type { CollaborationMode, LanUser } from '../services/lan/protocol'
import { useAppStore } from '../store/appStore'
import type { useLiveSession } from './useLiveSession'
import type { CurrentUser } from './useUserRole'

type LiveSession = ReturnType<typeof useLiveSession>

/** Store changes come in bursts (typing in the editor); phones hear them at most this often. */
const FLUSH_MS = 80

let host: LanHost | null = null

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke: call } = await import('@tauri-apps/api/core')
    return call<T>(command, args)
}

/** The one host, listening for the life of the app (see host.ts). */
function theHost(): LanHost {
    if (host) return host
    const created = new LanHost({
        send: (client, text) => invoke('lan_send', { client, text }),
        broadcast: (text) => invoke('lan_broadcast', { text }),
    })
    host = created
    void import('@tauri-apps/api/event')
        .then(({ listen }) => listen<HostEvent>('lan-host', (event) => void created.event(event.payload)))
        .catch((err) => console.warn('[lan] could not listen for phones:', err))
    let timer: ReturnType<typeof setTimeout> | null = null
    useAppStore.subscribe(() => {
        if (timer) return
        timer = setTimeout(() => {
            timer = null
            created.flush()
        }, FLUSH_MS)
    })
    return created
}

/** Tell the phones about a change made outside the store (the session's mode). */
export function refreshLanPhones(): void {
    host?.flush()
}

/**
 * Who's signed in on the desk, for deciding which phones run the screen. The
 * offline stand-in for the user doesn't carry the Convex id, so offline the
 * remembered one does.
 */
function lanUserOf(user: CurrentUser | null): LanUser | null {
    const remembered = recallLanUser()
    if (user && !('cachedAt' in user)) {
        return { id: user._id, name: user.fullname, role: user.role, churchId: user.churchId || undefined }
    }
    return remembered ?? (user?.churchId ? { churchId: user.churchId } : null)
}

/**
 * The desk end of live sessions over the local network: announce the desk,
 * listen for paired phones, and let them follow and drive the session
 * (services/lan/host.ts). Mount once, beside the live session's sync owner,
 * and give it that session: phones' requests go through it so Convex hears
 * them when it can.
 */
export function useLanHost(session: LiveSession, user: CurrentUser | null): void {
    const desk = isTauri()
    const sessionRef = useRef(session)
    sessionRef.current = session

    const deskUser = lanUserOf(user)
    const churchId = deskUser?.churchId ?? null
    const deskUserKey = JSON.stringify(deskUser)

    useEffect(() => {
        if (!desk) return
        const lan = theHost()
        const live = () => sessionRef.current
        const mirror: SessionMirror = {
            get connected() { return live().isConnected },
            get convexSessionId() { return live().isConnected ? live().sessionId : null },
            get convexMode() { return live().isConnected ? (live().collaborationMode as CollaborationMode | null) : null },
            setLiveSlide: (slideId) => live().setLiveSlide(slideId),
            addToQueue: (slideIds, position) => live().addToQueue(slideIds, position),
            removeFromQueue: (slideIds) => live().removeFromQueue(slideIds),
            acceptFromQueue: (slideIds) => live().acceptFromQueue(slideIds),
            reorderQueue: (slideIds) => live().reorderQueue(slideIds),
            toggleBlank: (isBlank) => live().toggleBlank(isBlank),
            setOverlay: (overlay, alertId) => live().setOverlay(overlay, alertId),
            updateCollaborationMode: (mode) => live().updateCollaborationMode(mode),
        }
        lan.mirror = mirror
        return () => {
            // Phones stay connected while the Dashboard is away; their
            // requests then change the desk's store alone.
            if (lan.mirror === mirror) lan.mirror = LOCAL_ONLY
        }
    }, [desk])

    useEffect(() => {
        if (!desk) return
        theHost().deskUser = JSON.parse(deskUserKey) as LanUser | null
    }, [desk, deskUserKey])

    // The session's Convex side changing (connecting, a new mode) is news
    // for the phones too, not only store changes.
    useEffect(() => {
        if (!desk) return
        useLanHostStatus.setState({ inConvexSession: session.isConnected })
        theHost().flush()
    }, [desk, session.isConnected, session.sessionId, session.collaborationMode])

    useEffect(() => {
        if (!desk) return
        let cancelled = false
        invoke<{ name: string; addresses: string[] }>('lan_start', { churchId })
            .then((status) => {
                if (!cancelled) useLanHostStatus.setState({ listening: true, error: null, name: status.name, addresses: status.addresses })
            })
            .catch((err) => {
                console.warn('[lan] the desk could not listen for phones:', err)
                if (!cancelled) useLanHostStatus.setState({ listening: false, error: String(err) })
            })
        return () => { cancelled = true }
    }, [desk, churchId])
}
