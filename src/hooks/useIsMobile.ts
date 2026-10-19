import { useSyncExternalStore } from 'react'

/** The phone layout (MobileStudioWorkspace, the bottom nav, panels as
 *  full-width sheets): a narrow screen, or a touch screen too short for the
 *  desk's. Width alone sent a phone on its side (~844×390) to the desk
 *  layout. The same query is the `phone:` variant in index.css. */
export const PHONE_QUERY = '(max-width: 767px), (max-height: 500px) and (pointer: coarse)'
const QUERY = PHONE_QUERY

/** The same test outside React, for an action that behaves differently on a phone. */
export function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

function subscribe(onChange: () => void): () => void {
    const mq = window.matchMedia(QUERY)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
}

export function useIsMobile(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(QUERY).matches,
        () => false,
    )
}
