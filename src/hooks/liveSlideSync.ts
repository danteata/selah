/**
 * Working out what an operator's edits change on the server.
 *
 * `baseline` maps slide id → the content last synced or received for it. The
 * diff against the current slides is the whole sync: slides whose content
 * differs are written, and slides the baseline had that are gone now — ones
 * this device held and the operator removed — are deleted. A slide this device
 * never had is never deleted, which is the point: the old sync sent the whole
 * deck and the server deleted whatever was missing from it, so a
 * collaborator's slide that hadn't arrived yet vanished for everyone.
 */

export type SlideKey = string

export function slideKey(slide: unknown): SlideKey {
    return JSON.stringify(slide)
}

export function diffScheduleSlides<T extends { id: string }>(
    baseline: ReadonlyMap<string, SlideKey>,
    current: readonly T[],
): { upserts: T[]; deletes: string[]; next: Map<string, SlideKey> } {
    const next = new Map<string, SlideKey>()
    const upserts: T[] = []
    for (const slide of current) {
        const key = slideKey(slide)
        next.set(slide.id, key)
        if (baseline.get(slide.id) !== key) upserts.push(slide)
    }
    const deletes = [...baseline.keys()].filter((id) => !next.has(id))
    return { upserts, deletes, next }
}

/**
 * Slides the server no longer has but did last time. Another operator (or a
 * contributor's device) deleted them, so this device should drop its copy —
 * local-only slides, never seen on the server, are left alone.
 */
export function removedOnServer(previousServerIds: ReadonlySet<string>, serverIds: ReadonlySet<string>): string[] {
    return [...previousServerIds].filter((id) => !serverIds.has(id))
}
