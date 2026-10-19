import { useSyncExternalStore } from 'react'

/** Below Tailwind's `md` breakpoint: the phone layout (MobileStudioWorkspace,
 *  the bottom nav, panels as full-width sheets). */
const QUERY = '(max-width: 767px)'

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
