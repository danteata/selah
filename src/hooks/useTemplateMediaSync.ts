import { useEffect, useSyncExternalStore } from 'react'
import { useConvex, useConvexAuth, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import {
    subscribeTemplateMedia,
    syncTemplateMedia,
    templateMediaState,
    templateMediaVersion,
    type TemplateLike,
    type TemplateMediaState,
} from '../services/templates/templateMediaSync'

/** Quiet period after the template list changes before syncing. */
const DEBOUNCE_MS = 2000

/**
 * Upload template backgrounds this computer has and download the rest (see
 * templateMediaSync.ts). Mount once, inside the Convex provider. Runs when the
 * template list changes — a template created or edited anywhere in the church
 * — and when the app comes online.
 */
export function useTemplateMediaSync(): void {
    const convex = useConvex()
    const { isOffline } = useConvexConnection()
    const { isAuthenticated } = useConvexAuth()
    const online = !isOffline && isAuthenticated
    // Same subscription useTemplates holds; Convex shares it.
    const templates = useQuery(api.templates.getTemplates, online ? {} : 'skip') as TemplateLike[] | undefined

    useEffect(() => {
        if (!online || !templates) return
        const timer = setTimeout(() => void syncTemplateMedia(convex, templates), DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [online, templates, convex])
}

/** This device's outcome for a template's background, for badges. */
export function useTemplateMediaState(templateId: string | undefined): TemplateMediaState | undefined {
    useSyncExternalStore(subscribeTemplateMedia, templateMediaVersion)
    return templateId ? templateMediaState(templateId) : undefined
}
