import { useEffect } from 'react'
import { isTauriMobile } from '../platform'
import { deskToken } from '../services/lan/identity'
import { connectToDesk, findDesks, knownDesks, useLanLink } from '../services/lan/link'

/** How often a phone that isn't connected looks for its desk again. */
const RETRY_MS = 15_000

/**
 * The phone app finds its desk and connects on its own: on opening, on coming
 * back to the foreground, and every little while until it's connected, so a
 * desk that restarts or a phone that wanders out of Wi-Fi range comes back
 * without anyone tapping anything. Only desks this phone has paired with;
 * meeting a new desk is the person's choice (NearbyDesks). Mount once.
 */
export function useLanAutoConnect(): void {
    useEffect(() => {
        if (!isTauriMobile()) return
        let stopped = false
        let busy = false

        const tryOnce = async () => {
            if (stopped || busy || document.hidden) return
            const { status, autoConnect } = useLanLink.getState()
            if (!autoConnect || status !== 'idle') return
            busy = true
            try {
                const found = await findDesks(2500)
                const paired = (desk: { id: string | null }) => !!desk.id && !!deskToken(desk.id)
                // Discovery first; failing that, where the desk was last time,
                // for networks that block discovery but not connections.
                const target = found.find(paired) ?? knownDesks().find(paired)
                if (target && !stopped && useLanLink.getState().status === 'idle') await connectToDesk(target)
            } finally {
                busy = false
            }
        }

        void tryOnce()
        const timer = setInterval(() => void tryOnce(), RETRY_MS)
        const onVisible = () => { if (!document.hidden) void tryOnce() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            stopped = true
            clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [])
}
