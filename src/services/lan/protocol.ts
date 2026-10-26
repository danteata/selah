/**
 * What the desk and the phones say to each other over the local network.
 *
 * The desk is the session: it holds the live slide, the deck and the
 * suggestions, and every phone mirrors it. A phone asks; the desk checks the
 * request against the same rules Convex applies (convex/liveSessions.ts),
 * applies it to its own session, and every phone hears the result. The
 * transport underneath is crates/selah-lan (pairing, pings, one JSON object
 * per line).
 */

import type { HeardVerse, SessionDefaultTemplates, Slide } from '../../types'

export type CollaborationMode = 'strict' | 'moderated' | 'open'

/** What a phone may do: run the screen like the operator, or contribute. */
export type LanRole = 'operator' | 'contributor'

/** Who is signed in on a device, as far as it knows (cached for offline). */
export interface LanUser {
    id?: string
    name?: string
    role?: string
    churchId?: string
}

/** The desk's session, as every phone sees it. Slides travel separately. */
export interface SessionMeta {
    scheduleId: string | null
    scheduleName: string | null
    churchId: string | null
    mode: CollaborationMode
    liveSlideId: string | null
    blank: boolean
    overlay: string
    /** The operator's deck, in order. */
    deck: string[]
    /** Suggestions awaiting the operator. */
    queue: string[]
    defaultTemplates: SessionDefaultTemplates | null
    heardVerses: HeardVerse[]
    /** The Convex session the desk is also in, when it has one. */
    convexSessionId: string | null
}

/** Desk → phone. */
export type DeskMessage =
    | { t: 'welcome'; role: LanRole; session: SessionMeta; slides: Slide[] }
    | { t: 'session'; session: SessionMeta }
    | { t: 'slides'; upserts: Slide[]; deletes: string[] }
    | { t: 'result'; id: number; ok: boolean; error?: string }

/** What a phone asks the desk to do. */
export type LanCommand =
    | { k: 'live'; slideId: string | null; slide?: Slide }
    /** Slides from the phone: into the deck, or suggested (review mode). */
    | { k: 'add'; slides: Slide[]; position?: number }
    | { k: 'unqueue'; slideIds: string[] }
    | { k: 'accept'; slideIds: string[] }
    | { k: 'reorderQueue'; slideIds: string[] }
    | { k: 'deck'; slideIds: string[] }
    /** Slides edited or removed on the operator's phone. */
    | { k: 'slides'; upserts: Slide[]; deletes: string[] }
    | { k: 'blank'; on: boolean }
    | { k: 'overlay'; overlay?: string; alertId?: string }
    | { k: 'mode'; mode: CollaborationMode }

/** Phone → desk. */
export interface PhoneMessage {
    t: 'cmd'
    id: number
    cmd: LanCommand
}

/**
 * A phone signed in as the desk's own user runs the screen, as that user's
 * phone does through Convex; so does a church admin. Anyone else contributes,
 * as the session's mode allows. Pairing is what makes a phone's word about
 * its user worth taking: the operator let that phone in.
 */
export function roleFor(phoneUser: LanUser | null | undefined, deskUser: LanUser | null | undefined): LanRole {
    if (phoneUser?.id && deskUser?.id && phoneUser.id === deskUser.id) return 'operator'
    const admin = phoneUser?.role === 'admin' || phoneUser?.role === 'superadmin'
    const sameChurch = !deskUser?.churchId || !phoneUser?.churchId || phoneUser.churchId === deskUser.churchId
    return admin && sameChurch ? 'operator' : 'contributor'
}

/** Why the desk won't do `cmd` for a phone, or null when it will. */
export function refusal(cmd: LanCommand, role: LanRole, mode: CollaborationMode): string | null {
    const operator = role === 'operator'
    switch (cmd.k) {
        case 'live':
            return operator || mode === 'open' ? null : 'Only the operator can change the live slide'
        case 'add':
            return operator || mode !== 'strict' ? null : 'Only the operator can add slides in strict mode'
        case 'slides':
            return operator || mode === 'open' ? null : 'Only the operator can change slides'
        case 'unqueue':
        case 'overlay':
            return null
        case 'accept':
        case 'reorderQueue':
            return operator ? null : 'Only the operator can review suggestions'
        case 'deck':
            return operator ? null : 'Only the operator can set the slide order'
        case 'blank':
            return operator ? null : 'Only the operator can clear the screen'
        case 'mode':
            return operator ? null : 'Only the operator can change who can drive the screen'
    }
}

/** Where a phone's slides go: straight into the deck, or to the operator for review. */
export function addsToDeck(role: LanRole, mode: CollaborationMode): boolean {
    return role === 'operator' || mode === 'open'
}
