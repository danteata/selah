import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyThemeClass, readStoredTheme } from './utils/theme'

/**
 * Fold a path-style route into the hash, before the router reads the URL.
 *
 * The web app runs on HashRouter, but two kinds of URL arrive as real paths:
 * invite links sent before they were built as `/#/join/…`, and Clerk's OAuth
 * return to `/sso-callback`. nginx serves index.html for both, and HashRouter,
 * seeing no hash, rendered the home page — so the invite was lost and a Google
 * sign-in was never completed. The query string stays where it is: Clerk reads
 * its callback params from `location.search`.
 */
function adoptPathRoute() {
    if ('__TAURI_INTERNALS__' in window) return
    const { pathname, search, hash } = window.location
    if (hash.startsWith('#/')) return
    if (!/^\/(join\/[^/]+|sso-callback)\/?$/.test(pathname)) return
    window.history.replaceState(null, '', `/${search}#${pathname.replace(/\/$/, '')}`)
}
adoptPathRoute()

// Before React mounts, so the first paint is already in the right theme. The
// store initialises from the same function, so the two can't disagree.
applyThemeClass(readStoredTheme())

function isConvexError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const msg = error.message || ''
    return (
        msg.includes('exceeded the free plan') ||
        msg.includes('deployments have been disabled') ||
        (msg.includes('CONVEX') && msg.includes('Server Error'))
    )
}

const originalReportError = window.reportError?.bind(window)
window.reportError = function (error: any, ...args: any[]) {
    if (isConvexError(error)) {
        console.warn('[Suppressed Convex Error]:', (error as Error).message?.substring(0, 100))
        return
    }
    if (originalReportError) {
        return (originalReportError as any)(error, ...args)
    }
}

window.addEventListener('error', (event: ErrorEvent) => {
    if (isConvexError(event.error)) {
        console.warn('[Suppressed Convex Error (event)]:', event.error.message?.substring(0, 100))
        event.preventDefault()
        event.stopImmediatePropagation()
        return
    }
}, true)

// Semantic search is pre-warmed from the Dashboard (see Dashboard.tsx), not
// here: from here it ran for every visitor, so a first look at the landing page
// on a phone downloaded the 22MB embedding model and an 18MB verse pack.

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (isConvexError(event.reason)) {
        console.warn('[Suppressed Convex Error (promise)]:', event.reason?.message?.substring(0, 100))
        event.preventDefault()
    }
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)

/**
 * Retire the boot splash from index.html.
 *
 * Two frames after render so the app has actually painted underneath — hiding it
 * in the same frame swaps one blank screen for another. `data-ready` drives a CSS
 * fade; the node is removed after it, so it can't sit invisibly over the app
 * swallowing clicks if the transition never fires.
 */
requestAnimationFrame(() => requestAnimationFrame(() => {
    const splash = document.getElementById('boot-splash')
    if (!splash) return
    splash.dataset.ready = 'true'
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // Belt and braces: transitionend never fires when the tab is hidden or
    // motion is reduced to none.
    setTimeout(() => splash.remove(), 1000)
}))