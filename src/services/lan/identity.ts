/**
 * Who this device is and who's signed in on it, kept for the local network.
 *
 * The desk announces itself for its church and decides who runs the screen
 * by comparing users, and both have to work with Convex unreachable. The
 * offline session cache (useUserRole) doesn't keep the Convex user id, and
 * expires; this does neither, because it decides nothing on its own: a phone
 * only reaches the desk once the operator has paired it.
 */

import type { LanUser } from './protocol'

const USER_KEY = 'selah-lan-user'
const DEVICE_KEY = 'selah-lan-device'
const TOKENS_KEY = 'selah-lan-tokens'

function read<T>(key: string): T | null {
    try {
        const text = localStorage.getItem(key)
        return text ? (JSON.parse(text) as T) : null
    } catch {
        return null
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Storage unavailable: the desk then announces without its church
        // and phones re-pair after a restart; nothing breaks.
    }
}

/** Remember the signed-in user, from a real Convex user row. */
export function rememberLanUser(user: LanUser): void {
    if (!user.id) return
    const current = read<LanUser>(USER_KEY)
    if (current && current.id === user.id && current.churchId === user.churchId
        && current.role === user.role && current.name === user.name) return
    write(USER_KEY, user)
}

export function recallLanUser(): LanUser | null {
    return read<LanUser>(USER_KEY)
}

/** Signing out: the next person on this device isn't the last one. */
export function forgetLanUser(): void {
    try {
        localStorage.removeItem(USER_KEY)
    } catch {
        // Nothing to forget.
    }
}

/** This phone's own id and name, made once. */
export function lanDevice(): { id: string; name: string } {
    const existing = read<{ id: string; name: string }>(DEVICE_KEY)
    if (existing?.id) return existing
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const device = { id, name: phoneName() }
    write(DEVICE_KEY, device)
    return device
}

/** "Pixel 7" from the user agent where it says, else "Phone". */
function phoneName(): string {
    const agent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const model = agent.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim()
    if (model && model !== 'K') return model
    if (/iPhone/.test(agent)) return 'iPhone'
    if (/iPad/.test(agent)) return 'iPad'
    return 'Phone'
}

/** The token each desk gave this phone when it paired, by desk id. */
export function deskToken(deskId: string): string | null {
    return read<Record<string, string>>(TOKENS_KEY)?.[deskId] ?? null
}

export function rememberDeskToken(deskId: string, token: string): void {
    write(TOKENS_KEY, { ...(read<Record<string, string>>(TOKENS_KEY) ?? {}), [deskId]: token })
}

export function forgetDeskToken(deskId: string): void {
    const tokens = read<Record<string, string>>(TOKENS_KEY) ?? {}
    delete tokens[deskId]
    write(TOKENS_KEY, tokens)
}

/** Desks this phone has paired with. */
export function pairedDeskIds(): string[] {
    return Object.keys(read<Record<string, string>>(TOKENS_KEY) ?? {})
}
