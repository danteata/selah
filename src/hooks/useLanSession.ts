import { useMemo } from 'react'
import { toast } from 'sonner'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppStore } from '../store/appStore'
import { disconnectFromDesk, sendCommand, useLanLink } from '../services/lan/link'
import { addsToDeck, type CollaborationMode, type LanCommand } from '../services/lan/protocol'
import type { UseLiveSessionReturn as LiveSession } from './useLiveSession'

// One toast per message in this window, as useLiveSession's own errors.
const ERROR_TOAST_WINDOW_MS = 8000
const lastErrorAt = new Map<string, number>()

function report(message: string, err: unknown): void {
    console.error(`[useLanSession] ${message}:`, err)
    const now = Date.now()
    if (now - (lastErrorAt.get(message) ?? 0) < ERROR_TOAST_WINDOW_MS) return
    lastErrorAt.set(message, now)
    toast.error(message, err instanceof Error ? { description: err.message } : undefined)
}

/** Ask the desk; on failure, put back what the phone showed early and say so. */
async function ask(cmd: LanCommand, failure: string, undo?: () => void): Promise<void> {
    try {
        await sendCommand(cmd)
    } catch (err) {
        undo?.()
        report(failure, err)
    }
}

const slidesById = (slideIds: string[]) => {
    const slides = useAppStore.getState().activeSlides
    return slideIds.map((id) => slides.find((slide) => slide.id === id)).filter((slide) => slide !== undefined)
}

/**
 * The live session through the desk on this Wi-Fi, in useLiveSession's shape,
 * while the phone app is connected to one (services/lan/link.ts); null
 * otherwise, and useLiveSession goes through Convex. The phone shows a
 * change at once where it's allowed to make it, like the Convex path does,
 * and the desk's answer then confirms or corrects it.
 */
export function useLanSession(): LiveSession | null {
    const status = useLanLink((s) => s.status)
    const session = useLanLink((s) => s.session)
    const role = useLanLink((s) => s.role)
    const mode: CollaborationMode = session?.mode ?? 'moderated'

    const actions = useMemo(() => {
        const store = () => useAppStore.getState()
        const operator = role === 'operator'
        return {
            startSession: async () => null,
            joinSession: async () => true,
            leaveSession: () => disconnectFromDesk(),
            endSession: async () => {},
            setLiveSlide: async (slideId: string | null) => {
                const before = store().liveSlideId
                if (operator || mode === 'open') store().setLiveSlide(slideId || '')
                const slide = slideId ? slidesById([slideId])[0] : undefined
                await ask({ k: 'live', slideId, slide }, "Couldn't send that slide live", () => store().setLiveSlide(before))
            },
            addToQueue: async (slideIds: string[], position?: number) => {
                const slides = slidesById(slideIds)
                if (slides.length === 0) return
                const suggesting = !addsToDeck(role, mode)
                if (suggesting) store().addSharedQueueSlideIds(slideIds)
                await ask({ k: 'add', slides, position }, suggesting ? "Couldn't suggest that slide" : "Couldn't add that slide to the deck",
                    suggesting ? () => store().removeSharedQueueSlideIds(slideIds) : undefined)
            },
            removeFromQueue: async (slideIds: string[]) => {
                const before = store().sharedQueueSlideIds
                store().removeSharedQueueSlideIds(slideIds)
                await ask({ k: 'unqueue', slideIds }, "Couldn't remove that suggestion", () => store().setSharedQueueSlideIds(before))
            },
            acceptFromQueue: async (slideIds: string[]) => {
                const before = store().sharedQueueSlideIds
                store().removeSharedQueueSlideIds(slideIds)
                await ask({ k: 'accept', slideIds }, "Couldn't accept that suggestion", () => store().setSharedQueueSlideIds(before))
            },
            reorderQueue: (slideIds: string[]) => ask({ k: 'reorderQueue', slideIds }, "Couldn't reorder the suggestions"),
            syncOperatorSlides: (slideIds: string[]) => ask({ k: 'deck', slideIds }, "Couldn't share the slide order"),
            syncSlideContent: (slide: Parameters<LiveSession['syncSlideContent']>[0]) =>
                ask({ k: 'slides', upserts: [slide], deletes: [] }, "Couldn't share that slide change"),
            toggleBlank: async (isBlank: boolean) => {
                store().setLiveOutputBlanked(isBlank)
                await ask({ k: 'blank', on: isBlank }, "Couldn't clear the screen", () => store().setLiveOutputBlanked(!isBlank))
            },
            setOverlay: async (overlay?: string, alertId?: string) => {
                const before = store().activeOverlay
                store().setActiveOverlay(overlay || 'none')
                await ask({ k: 'overlay', overlay, alertId }, "Couldn't show that overlay", () => store().setActiveOverlay(before))
            },
            transferOperator: async () => {
                toast.info('Hand over control from the desk, or while connected to Convex.')
            },
            updateCollaborationMode: (next: CollaborationMode) => ask({ k: 'mode', mode: next }, "Couldn't change who can drive the screen"),
        }
    }, [role, mode])

    if (status !== 'connected' || !session) return null

    return {
        ...actions,
        sessionId: (session.convexSessionId as Id<'liveSessions'> | null) ?? null,
        sessionScheduleId: session.scheduleId,
        sessionRole: role,
        collaborationMode: mode,
        isOperator: role === 'operator',
        isContributor: role === 'contributor',
        isViewer: false,
        isOpen: mode === 'open',
        isStrict: mode === 'strict',
        isModerated: mode === 'moderated',
        isConnected: true,
        isResolving: false,
        isStarting: false,
    }
}
