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

import type { SessionDefaultTemplates, Slide } from '../types'

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

/**
 * Builds the exact shape Convex's slide mutations accept. Their argument
 * validators are exact/closed: any undeclared key throws an
 * `ArgumentValidationError` and fails the whole call. A `blob:`/`asset://`
 * `background` is meaningless on another device, so for local-only media
 * (no `backgroundStorageId`) it's omitted; `backgroundType` still travels so
 * a placeholder can show the right icon, and `localMediaId`/`localFilePath`
 * travel so the device that has the file still finds it after a reload.
 */
export function toSyncableSlide(slide: Slide, index: number) {
    const isLocalOnlyMedia = !slide.backgroundStorageId && !!(slide.localFilePath || slide.localMediaId)
    return {
        id: slide.id,
        index: typeof slide.index === 'number' ? slide.index : index,
        name: slide.name || 'Untitled',
        type: slide.type,
        layout: slide.layout,
        contents: slide.contents || [],
        backgroundType: slide.backgroundType,
        background: isLocalOnlyMedia ? undefined : slide.background,
        backgroundVideoKey: slide.backgroundVideoKey ?? undefined,
        backgroundStorageId: slide.backgroundStorageId ?? undefined,
        title: slide.title,
        songId: slide.songId,
        hasChorus: slide.hasChorus,
        // Kept so this device finds its own upload after a reload; another
        // device just doesn't have it.
        localMediaId: slide.localMediaId,
        localFilePath: slide.localFilePath,
        data: slide.data,
        slideStyle: slide.slideStyle,
        saved: slide.saved,
        verseIndex: slide.verseIndex,
        totalVerses: slide.totalVerses,
        verseLabel: slide.verseLabel,
    }
}

/** The slide types a session shares a default template for, every key
 *  present so two copies compare equal however they were written. */
export function sessionTemplatesFrom(templates: SessionDefaultTemplates | null | undefined): Required<SessionDefaultTemplates> {
    return {
        scripture: templates?.scripture ?? null,
        song: templates?.song ?? null,
        hymn: templates?.hymn ?? null,
        dictionary: templates?.dictionary ?? null,
        text: templates?.text ?? null,
    }
}
