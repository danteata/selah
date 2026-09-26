import { isDesktop } from '../platform'

/** Where the web app is served; what links shared with other people point at. */
export const PUBLIC_WEB_URL: string = import.meta.env.VITE_PUBLIC_WEB_URL || 'https://selah.fly.dev'

/**
 * A join link for an invite code that opens for whoever receives it.
 *
 * A hash route, because the web app runs on HashRouter. On desktop the page's
 * own origin is `tauri://localhost`, which is meaningless to anyone else, so
 * the public web address is used instead.
 */
export function inviteLink(code: string): string {
    const base = isDesktop() ? PUBLIC_WEB_URL : window.location.origin
    return `${base}/#/join/${code}`
}
