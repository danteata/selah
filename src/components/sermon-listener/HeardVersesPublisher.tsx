/**
 * Shares what this device's sermon listener hears with the live session it's
 * in, so everyone else's phone can send a heard verse live without listening
 * itself. Renders nothing; mounted once, inside the SermonListenerProvider.
 */

import { useEffect, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useSermonListenerContext } from './SermonListenerContext'
import { useLiveSession } from '../../hooks/useLiveSession'
import { heardVersesFrom } from '../../services/sermon-listener/heardVerses'

/** At most one publish this often: detections can arrive in bursts. */
const PUBLISH_INTERVAL_MS = 2000

export function HeardVersesPublisher() {
    const listener = useSermonListenerContext()
    const { sessionId, isConnected } = useLiveSession()
    const setHeardVerses = useMutation(api.liveSessions.setHeardVerses)

    const detected = listener?.detectedVerses
    const version = listener?.activeBibleVersion
    const sentKeyRef = useRef<string | null>(null)
    const lastSentAtRef = useRef(0)

    useEffect(() => {
        if (!sessionId || !isConnected || !detected) return
        const verses = heardVersesFrom(detected, version)
        const key = JSON.stringify(verses)
        if (key === sentKeyRef.current) return
        // A device that has heard nothing says nothing, so it never blanks the
        // list another device in the session is publishing. Once it has
        // published, clearing its own list (a reset) does clear the session's.
        if (verses.length === 0 && sentKeyRef.current === null) return

        const send = () => {
            sentKeyRef.current = key
            lastSentAtRef.current = Date.now()
            setHeardVerses({ sessionId: sessionId as Id<'liveSessions'>, verses })
                .catch((err: unknown) => {
                    // Try again on the next change; this is a convenience, not
                    // something to interrupt the operator over.
                    sentKeyRef.current = null
                    console.warn('[HeardVersesPublisher] Could not share heard verses:', err)
                })
        }
        const wait = lastSentAtRef.current + PUBLISH_INTERVAL_MS - Date.now()
        if (wait <= 0) {
            send()
            return
        }
        const timer = setTimeout(send, wait)
        return () => clearTimeout(timer)
    }, [sessionId, isConnected, detected, version, setHeardVerses])

    return null
}
