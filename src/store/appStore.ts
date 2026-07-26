import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Emitter, EventType } from 'mitt'
import type {
    Slide,
    Schedule,
    Alert,
    BackgroundVideo,
    AppSettings,
    SlideStyle,
    Advert,
    BibleVersion,
    Scripture,
    Hymn,
    Song
} from '../types'
import { bibleVersionObjects } from '../types'
import { DEFAULT_BACKGROUNDS } from '../constants/backgrounds'
import type { NavSection, SplitPanelMode } from '../types/studio'

// UI State types
export type QuickActionsPage = '' | 'bible' | 'search-bible' | 'hymn' | 'song' | 'media' | 'youtube' | 'vimeo' | 'library' | 'templates' | 'alert' | 'countdown'

export interface ModalState {
    settings: boolean
    shortcuts: boolean
    editor: boolean
    mediaPicker: boolean
    templateBrowser: boolean
    alertModal: boolean
    countdownModal: boolean
    libraryPanel: boolean
    scheduleModal: boolean
    lowerThirdEditor: boolean
    externalVideo: boolean
}

/** One step of the live arrangement, for the operator's position chips. */
export interface SongTrackingStep {
    stepIndex: number
    sectionId: string
    label: string
    /** Live slide this section maps to, if the song is on the output. */
    slideId: string | null
}

/** Live status of the predictive song-lyric tracker, for the operator UI. */
export interface SongTrackingStatus {
    songId: string | null
    songTitle: string | null
    phase: 'idle' | 'searching' | 'tracking' | 'lost'
    confidence: number
    /** Section currently shown / led-to on the projector. */
    displaySectionId: string | null
    /** Section we believe the singer is actually on. */
    singerSectionId: string | null
    /** Human label of where we believe the singer is, e.g. "Chorus". */
    singerLabel: string | null
    /** The expanded arrangement (stable per song) for position chips. */
    arrangement: SongTrackingStep[]
}

export interface SongTrackingState {
    /** Master opt-in — the tracker never moves the live slide unless true. */
    enabled: boolean
    /** Temporarily freeze auto-advance without losing tracking. */
    locked: boolean
    /** Auto-identify a song from the library and pull it up when singing starts
     *  and no song is displayed (the "Searching" phase). */
    autoDetect: boolean
    /** When auto-detect finds no library match, look the song up online
     *  (LLM-identify → LRCLIB) and import it. Off by default; needs an LLM
     *  configured; carries a copyright caveat. */
    externalLyrics: boolean
    /** Live readout (not persisted). */
    status: SongTrackingStatus
}

export const DEFAULT_SONG_TRACKING: SongTrackingState = {
    enabled: false,
    locked: false,
    autoDetect: false,
    externalLyrics: false,
    status: {
        songId: null,
        songTitle: null,
        phase: 'idle',
        confidence: 0,
        displaySectionId: null,
        singerSectionId: null,
        singerLabel: null,
        arrangement: [],
    },
}

export interface AppState {
    // State
    activeAdvert: Advert | null
    schedules: Schedule[]
    activeSchedule: Schedule | null
    activeSlides: Slide[]
    liveOutputSlidesId: string[] | null
    sharedQueueSlideIds: string[]
    liveSlideId: string | null
    // True while the operator has deliberately cleared the live output to a
    // blank screen (e.g. during prayer) — independent of `liveSlideId`, which
    // keeps pointing at whatever slide is queued up so un-clearing restores it.
    liveOutputBlanked: boolean
    // Predictive song-lyric auto-advance (Phase 2 wiring).
    songTracking: SongTrackingState
    // Audio-reactive motion-graphics layer on the live output (Phase 4).
    visualizerEnabled: boolean
    emitter: Emitter<Record<EventType, unknown>> | null
    settings: AppSettings
    backgroundVideos: BackgroundVideo[]
    alerts: Alert[]
    activeAlert: Alert | null
    activeOverlay: string
    recentBibleSearches: string[]
    failedUploadRequests: Array<{ path: string; options: unknown; timestamp: number }>
    slidesLoading: boolean
    lastSynced: string
    bannerVisible: boolean
    bibleVersions: Array<unknown>
    activeSocket: WebSocket | null
    mainDisplayLabel: string
    mainDisplayScreen: Screen | null

    // UI State (formerly event-driven)
    modals: ModalState
    quickActionsPage: QuickActionsPage
    editingSlide: Slide | null
    isDarkMode: boolean
    bulkSelectMode: boolean
    selectedSlideIds: string[]

    // Studio Mode layout state
    activeNavSection: NavSection | null
    /** Last non-sermon content section shown in the sidebar — so a surface the
     * sermon listener displaces (e.g. the center split) can show it instead. */
    lastContentSection: NavSection | null
    contextPanelOpen: boolean
    contextPanelWidth: number
    slideQueueWidth: number
    /** Center (Live Output) arrangement — driven by the workspace preset or the header picker. */
    liveOutputLayout: 'stacked' | 'split' | 'focus'
    panelMode: 'docked' | 'floating'
    panelPosition: { x: number; y: number }
    commandBarOpen: boolean
    quickBibleBarOpen: boolean
    biblePanelQuery: string
    splitPanelMode: SplitPanelMode | null
    splitPanelQuery: string | null

    // Workspace mode
    workspaceMode: 'studio' | 'dashboard'

    // Undo/Redo stacks
    pastStates: Array<Partial<AppState>>
    futureStates: Array<Partial<AppState>>
}

const defaultSettings: AppSettings = {
    appVersion: '0.1.0',
    defaultBibleVersion: 'KJV',
    defaultFont: 'Inter',
    defaultBackground: {
        hymn: DEFAULT_BACKGROUNDS.hymn,
        song: DEFAULT_BACKGROUNDS.song,
        bible: DEFAULT_BACKGROUNDS.bible,
        text: DEFAULT_BACKGROUNDS.text,
    },
    slideStyles: {
        blur: 0.5,
        brightness: 50,
        linesPerSlide: 4,
        alignment: 'center',
        windowPadding: { left: 24, right: 24, top: 24, bottom: 24 },
        lettercase: '',
        lineSpacing: 'normal',
        fontSizePercent: 100
    },
    bibleVersions: [],
    animations: true,
    footnotes: true,
    songAndHymnLabelsVisibility: false,
    liveWindowFullscreen: true,
    liveOutputMonitorId: null,
    transitionInterval: 0.7,
    alertLimit: 5,
    defaultCollaborationMode: 'moderated',
    isDarkMode: false,
}

const initialModalState: ModalState = {
    settings: false,
    shortcuts: false,
    editor: false,
    mediaPicker: false,
    templateBrowser: false,
    alertModal: false,
    countdownModal: false,
    libraryPanel: false,
    scheduleModal: false,
    lowerThirdEditor: false,
    externalVideo: false,
}

const initialState: AppState = {
    activeAdvert: null,
    schedules: [],
    activeSchedule: null,
    activeSlides: [],
    liveOutputSlidesId: null,
    sharedQueueSlideIds: [],
    liveSlideId: null,
    liveOutputBlanked: false,
    songTracking: DEFAULT_SONG_TRACKING,
    visualizerEnabled: false,
    emitter: null,
    settings: defaultSettings,
    backgroundVideos: [],
    alerts: [],
    activeAlert: null,
    activeOverlay: 'none',
    recentBibleSearches: [],
    failedUploadRequests: [],
    slidesLoading: false,
    lastSynced: new Date().toISOString(),
    bannerVisible: true,
    bibleVersions: bibleVersionObjects,
    activeSocket: null,
    mainDisplayLabel: '',
    mainDisplayScreen: null,
    // UI State
    modals: initialModalState,
    quickActionsPage: '',
    editingSlide: null,
    isDarkMode: false,
    bulkSelectMode: false,
    selectedSlideIds: [],
    // Studio Mode layout state
    activeNavSection: null as NavSection | null,
    lastContentSection: null as NavSection | null,
    contextPanelOpen: true,
    contextPanelWidth: 320,
    slideQueueWidth: 280,
    liveOutputLayout: 'stacked' as 'stacked' | 'split' | 'focus',
    panelMode: 'docked' as 'docked' | 'floating',
    panelPosition: { x: 0, y: 0 },
    commandBarOpen: false,
    quickBibleBarOpen: false,
    biblePanelQuery: '',
    splitPanelMode: null as SplitPanelMode | null,
    splitPanelQuery: null as string | null,
    // Workspace mode
    workspaceMode: 'studio' as 'studio' | 'dashboard',
    // Undo/Redo
    pastStates: [],
    futureStates: [],
}

// Helper to ensure unique slide IDs
function ensureUniqueIds(arr: Slide[]): Slide[] {
    const seenIds = new Set<string>()
    return arr.filter((obj) => {
        if (seenIds.has(obj.id)) {
            return false
        } else {
            seenIds.add(obj.id)
            return true
        }
    })
}

interface AppStore extends AppState {
    // Actions
    setSchedules: (schedules: Schedule[]) => void
    setActiveSchedule: (schedule: Schedule | null) => void
    appendActiveSlide: (slide: Slide, position?: number) => void
    appendActiveSlides: (slides: Slide[]) => void
    updateActiveSlide: (slide: Slide) => void
    removeActiveSlide: (slide: Slide) => void
    reorderActiveSlides: (fromIndex: number, toIndex: number) => void
    replaceScheduleActiveSlides: (slides: Slide[]) => void
    replaceSlidesForSchedule: (scheduleId: string, slides: Slide[], preserveLiveOutputOrder?: boolean) => void
    setActiveSlides: (slides: Slide[]) => void
    setLiveOutputSlidesId: (slides: string[]) => void
    setSharedQueueSlideIds: (slideIds: string[]) => void
    addSharedQueueSlideIds: (slideIds: string[]) => void
    removeSharedQueueSlideIds: (slideIds: string[]) => void
    setLiveSlide: (slideId: string | null) => void
    setLiveOutputBlanked: (blanked: boolean) => void
    setSongTrackingEnabled: (enabled: boolean) => void
    setSongTrackingLocked: (locked: boolean) => void
    setSongAutoDetect: (autoDetect: boolean) => void
    setSongExternalLyrics: (externalLyrics: boolean) => void
    setSongTrackingStatus: (status: SongTrackingStatus) => void
    setVisualizerEnabled: (enabled: boolean) => void
    setEmitter: (emitter: Emitter<Record<EventType, unknown>> | null) => void
    setAppSettings: (settings: AppSettings) => void
    setSlideStyles: (styles: SlideStyle) => void
    setDefaultBibleVersion: (version: string) => void
    setBibleVersionOrder: (order: string[]) => void
    setDefaultFont: (font: string) => void
    setAlerts: (alerts: Alert[]) => void
    addAlert: (alert: Alert) => void
    setActiveAlert: (alert: Alert | null) => void
    setActiveOverlay: (overlay: string) => void
    setBackgroundVideos: (bgVideos: BackgroundVideo[]) => void
    setRecentBibleSearches: (searchQuery: string) => void
    setFailedUploadRequests: (failedRequest: { path: string; options: unknown; timestamp: number } | null) => void
    removeFailedUploadRequest: (failedRequest: { path: string; options: unknown; timestamp: number }) => void
    setSlidesLoading: (loading: boolean) => void
    setLastSynced: (lastSynced: string) => void
    setBannerVisible: (bannerVisible: boolean) => void
    setBibleVersions: (bibleVersions: BibleVersion[]) => void
    setActiveSocket: (socket: WebSocket | null) => void
    setMainDisplayLabel: (label: string) => void
    setMainDisplayScreen: (screen: Screen | null) => void
    setLiveWindowFullscreen: (fullscreen: boolean) => void
    setLiveOutputMonitorId: (monitorId: string | null) => void
    setLinesPerSlide: (lines: number) => void
    setVerseRefPosition: (position: 'top' | 'bottom') => void
    setVerseRefColor: (color: string | undefined) => void
    setVerseRefBold: (bold: boolean) => void
    setVerseRefItalic: (italic: boolean) => void
    setVerseRefUnderline: (underline: boolean) => void
    setVerseRefSizePercent: (percent: number) => void
    setAnimations: (animations: boolean) => void
    setFootnotes: (footnotes: boolean) => void
    setSongAndHymnLabelsVisibility: (visibility: boolean) => void
    setTransitionInterval: (interval: number) => void
    setWindowPadding: (padding: { left?: number; right?: number; top?: number; bottom?: number }) => void
    setActiveAdvert: (advert: Advert | null) => void
    setDefaultSlideBackgrounds: () => void
    setDefaultSlideBackground: (type: string, background: string, backgroundVideoKey?: string | null) => void
    setDefaultTemplate: (slideType: 'scripture' | 'hymn' | 'song' | 'text' | 'sermon' | 'announcement' | 'prayer' | 'countdown', templateId: string | null) => void
    signOut: () => void
    // Schedule CRUD
    createSchedule: (name: string) => void
    deleteSchedule: (scheduleId: string) => void
    updateSchedule: (scheduleId: string, updates: Partial<Schedule>) => void
    // Undo/Redo
    undo: () => void
    redo: () => void
    refreshAppActionsStack: () => void

    // UI Actions (formerly event-driven)
    openModal: (modal: keyof ModalState) => void
    closeModal: (modal: keyof ModalState) => void
    closeAllModals: () => void
    setQuickActionsPage: (page: QuickActionsPage) => void
    setEditingSlide: (slide: Slide | null) => void
    toggleDarkMode: () => void
    setDarkMode: (isDark: boolean) => void
    toggleBulkSelectMode: () => void
    setBulkSelectMode: (mode: boolean) => void
    toggleSlideSelection: (slideId: string) => void
    setSelectedSlideIds: (ids: string[]) => void
    clearSelectedSlides: () => void

    // Studio Mode layout actions
    setActiveNavSection: (section: NavSection | null) => void
    toggleContextPanel: () => void
    setContextPanelOpen: (open: boolean) => void
    setContextPanelWidth: (width: number) => void
    setSlideQueueWidth: (width: number) => void
    setLiveOutputLayout: (mode: 'stacked' | 'split' | 'focus') => void
    setPanelMode: (mode: 'docked' | 'floating') => void
    setPanelPosition: (position: { x: number; y: number }) => void
    setCommandBarOpen: (open: boolean) => void
    toggleCommandBar: () => void
    setQuickBibleBarOpen: (open: boolean) => void
    toggleQuickBibleBar: () => void
    setBiblePanelQuery: (query: string) => void
    setSplitPanelMode: (mode: SplitPanelMode | null) => void
    setSplitPanelQuery: (query: string | null) => void
    openBibleFromSermon: (verseReference: string) => void
    setWorkspaceMode: (mode: 'studio' | 'dashboard') => void
}

export const useAppStore = create<AppStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            setSchedules: (schedules) => {
                set((state) => {
                    const filteredSchedules = schedules?.filter((schedule) => schedule !== null) || []
                    let activeSchedule = state.activeSchedule

                    if (activeSchedule) {
                        const tempSchedule = filteredSchedules.find(
                            (sch) => sch?._id === activeSchedule?._id
                        )
                        if (tempSchedule) {
                            activeSchedule = tempSchedule
                        }
                    }

                    return {
                        schedules: filteredSchedules,
                        activeSchedule,
                        futureStates: []
                    }
                })
            },

            setActiveSchedule: (schedule) => {
                set((state) => {
                    if (!schedule) {
                        return { activeSchedule: null }
                    }

                    const existingSchedule = state.schedules.find(
                        (sch) => sch?._id === schedule?._id
                    )

                    let updatedSchedules = state.schedules
                    if (!existingSchedule) {
                        updatedSchedules = [...state.schedules, schedule]
                    } else {
                        updatedSchedules = state.schedules.map((sch) =>
                            sch?._id === schedule?._id ? schedule : sch
                        )
                    }

                    return {
                        activeSchedule: schedule,
                        schedules: updatedSchedules
                    }
                })
            },

            appendActiveSlide: (slide, position) => {
                set((state) => {
                    const exists = state.activeSlides.find((s) => s?.id === slide?.id)
                    if (exists) return state

                    let updatedSlides = [...state.activeSlides]
                    if (position !== undefined && position >= 0) {
                        updatedSlides.splice(position, 0, slide)
                    } else {
                        updatedSlides.push(slide)
                    }

                    // Only append the new slide id to liveOutputSlidesId
                    // (preserves the existing operator-ordered deck).
                    // Previously this wholesale-rebuilt liveOutputSlidesId
                    // from every active slide, which clobbered the
                    // operator's curated deck and caused the new slide to
                    // appear duplicated in the queue panel.
                    const newId = slide?.id
                    const currentOrder = state.liveOutputSlidesId || []
                    const updatedOrder = newId && !currentOrder.includes(newId)
                        ? [...currentOrder, newId]
                        : currentOrder

                    return {
                        pastStates: [...state.pastStates, {
                            activeSlides: state.activeSlides,
                            liveOutputSlidesId: state.liveOutputSlidesId
                        }],
                        activeSlides: ensureUniqueIds(updatedSlides),
                        liveOutputSlidesId: updatedOrder,
                        futureStates: []
                    }
                })
            },

            appendActiveSlides: (slides) => {
                set((state) => {
                    const tempSlides = [...state.activeSlides, ...slides]
                    return {
                        activeSlides: ensureUniqueIds(tempSlides),
                        liveOutputSlidesId: Array.from(new Set(tempSlides.map((slide) => slide.id))),
                        futureStates: []
                    }
                })
            },

            updateActiveSlide: (slide) => {
                set((state) => {
                    const updatedSlides = state.activeSlides.map((s) =>
                        s.id === slide.id ? slide : s
                    )
                    return {
                        pastStates: [...state.pastStates, { activeSlides: state.activeSlides }],
                        activeSlides: updatedSlides,
                        futureStates: []
                    }
                })
            },

            removeActiveSlide: (slide) => {
                set((state) => {
                    const updatedSlides = state.activeSlides.filter((s) => s.id !== slide.id)
                    return {
                        pastStates: [...state.pastStates, { activeSlides: state.activeSlides }],
                        activeSlides: updatedSlides,
                        liveOutputSlidesId: Array.from(new Set(updatedSlides.map((slide) => slide.id))),
                        futureStates: []
                    }
                })
            },

            reorderActiveSlides: (fromIndex, toIndex) => {
                set((state) => {
                    if (fromIndex < 0 || fromIndex >= state.activeSlides.length) return state
                    if (toIndex < 0 || toIndex >= state.activeSlides.length) return state
                    if (fromIndex === toIndex) return state

                    const updatedSlides = [...state.activeSlides]
                    const [moved] = updatedSlides.splice(fromIndex, 1)
                    updatedSlides.splice(toIndex, 0, moved)

                    return {
                        pastStates: [...state.pastStates, { activeSlides: state.activeSlides }],
                        activeSlides: updatedSlides,
                        liveOutputSlidesId: Array.from(new Set(updatedSlides.map((slide) => slide.id))),
                        futureStates: []
                    }
                })
            },

            replaceScheduleActiveSlides: (slides) => {
                set((state) => {
                    if (!state.activeSchedule) return state

                    let tempSlides = state.activeSlides.filter(
                        (slide) => slide.scheduleId !== state.activeSchedule?._id
                    )
                    tempSlides.push(...slides)

                    return {
                        activeSlides: ensureUniqueIds(tempSlides),
                        liveOutputSlidesId: Array.from(new Set(tempSlides.map((slide) => slide.id))),
                        futureStates: []
                    }
                })
            },

            replaceSlidesForSchedule: (scheduleId, slides, preserveLiveOutputOrder = true) => {
                set((state) => {
                    if (!scheduleId) return state

                    // Merge: keep any existing local slides for this schedule
                    // (they may include optimistic adds that haven't yet
                    // round-tripped to the server) and overlay with the
                    // server's authoritative list. Server data wins when
                    // both exist; local-only slides are preserved so the
                    // queue doesn't appear to "reset" after a contributor
                    // adds a slide.
                    const existingForSchedule = state.activeSlides.filter(
                        (slide) => slide.scheduleId === scheduleId
                    )
                    const serverById = new Map(slides.map((s) => [s.id, s]))
                    const mergedSlides = [
                        ...existingForSchedule.map((local) => {
                            const server = serverById.get(local.id)
                            if (!server) return local
                            // The server copy is authoritative for shared fields,
                            // but it never stores device-local media pointers:
                            // `toSyncableSlide` (useLiveSession) strips
                            // localMediaId/localFilePath and nulls the local
                            // blob/asset `background` before syncing. Carry those
                            // back from our local copy so THIS device keeps
                            // resolving its own local media instead of falling
                            // through to the "LOCAL MEDIA" placeholder (which is
                            // meant only for remote collaborators who genuinely
                            // don't have the file — their local copy lacks these
                            // fields too, so nothing is restored for them).
                            const localMediaId = server.localMediaId ?? local.localMediaId
                            const localFilePath = server.localFilePath ?? local.localFilePath
                            const isLocalMedia = Boolean(localMediaId || localFilePath)
                            return {
                                ...server,
                                localMediaId,
                                localFilePath,
                                background: server.background || (isLocalMedia ? local.background : server.background),
                            }
                        }),
                        ...slides.filter((s) => !existingForSchedule.some((local) => local.id === s.id)),
                    ]
                    const uniqueSlides = ensureUniqueIds(mergedSlides)

                    return {
                        activeSlides: uniqueSlides,
                        liveOutputSlidesId: preserveLiveOutputOrder
                            ? state.liveOutputSlidesId
                            : Array.from(new Set(uniqueSlides.map((slide) => slide.id))),
                        futureStates: [],
                    }
                })
            },

            setActiveSlides: (slides) => {
                set((state) => ({
                    activeSlides: ensureUniqueIds(slides),
                    liveOutputSlidesId: Array.from(new Set(slides.map((slide) => slide.id))),
                    futureStates: []
                }))
            },

            setLiveOutputSlidesId: (slides) => {
                set((state) => {
                    const newIds = Array.from(new Set(slides))
                    const currentIds = state.liveOutputSlidesId
                    // Only save to pastStates if value actually changes
                    const hasChanged = !currentIds
                        || newIds.length !== currentIds.length
                        || newIds.some((id, i) => id !== currentIds[i])

                    if (!hasChanged) {
                        return { liveOutputSlidesId: newIds }
                    }

                    return {
                        pastStates: [...state.pastStates, {
                            activeSlides: state.activeSlides,
                            liveOutputSlidesId: state.liveOutputSlidesId
                        }],
                        liveOutputSlidesId: newIds,
                        futureStates: []
                    }
                })
            },

            setSharedQueueSlideIds: (slideIds) => {
                set({ sharedQueueSlideIds: slideIds })
            },

            addSharedQueueSlideIds: (slideIds) => {
                set((state) => ({
                    sharedQueueSlideIds: [...state.sharedQueueSlideIds, ...slideIds.filter(id => !state.sharedQueueSlideIds.includes(id))]
                }))
            },

            removeSharedQueueSlideIds: (slideIds) => {
                set((state) => ({
                    // Remove by occurrence count, not "all matching ids", to preserve duplicate entries
                    sharedQueueSlideIds: (() => {
                        const remainingRemovals = new Map<string, number>()
                        for (const id of slideIds) {
                            remainingRemovals.set(id, (remainingRemovals.get(id) || 0) + 1)
                        }

                        return state.sharedQueueSlideIds.filter((id) => {
                            const count = remainingRemovals.get(id) || 0
                            if (count > 0) {
                                remainingRemovals.set(id, count - 1)
                                return false
                            }
                            return true
                        })
                    })()
                }))
            },

            setLiveSlide: (slideId) => {
                set({ liveSlideId: slideId })
            },

            setLiveOutputBlanked: (blanked) => {
                set({ liveOutputBlanked: blanked })
            },

            setSongTrackingEnabled: (enabled) => {
                set((state) => ({ songTracking: { ...state.songTracking, enabled } }))
            },

            setSongTrackingLocked: (locked) => {
                set((state) => ({ songTracking: { ...state.songTracking, locked } }))
            },

            setSongAutoDetect: (autoDetect) => {
                set((state) => ({ songTracking: { ...state.songTracking, autoDetect } }))
            },

            setSongExternalLyrics: (externalLyrics) => {
                set((state) => ({ songTracking: { ...state.songTracking, externalLyrics } }))
            },

            setSongTrackingStatus: (status) => {
                set((state) => ({ songTracking: { ...state.songTracking, status } }))
            },

            setVisualizerEnabled: (enabled) => {
                set({ visualizerEnabled: enabled })
            },

            setEmitter: (emitter) => {
                set({ emitter })
            },

            setAppSettings: (settings) => {
                set({ settings })
            },

            setSlideStyles: (styles) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: styles
                    }
                }))
            },

            setDefaultBibleVersion: (version) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        defaultBibleVersion: version
                    }
                }))
            },

            setBibleVersionOrder: (order) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        bibleVersionOrder: order
                    }
                }))
            },

            setDefaultFont: (font) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        defaultFont: font
                    }
                }))
            },

            setAlerts: (alerts) => {
                set({ alerts })
            },

            addAlert: (alert) => {
                set((state) => ({
                    alerts: [...state.alerts, alert]
                }))
            },

            setActiveAlert: (alert) => {
                set({ activeAlert: alert })
            },

            setActiveOverlay: (overlay) => {
                set({ activeOverlay: overlay })
            },

            setBackgroundVideos: (bgVideos) => {
                set({ backgroundVideos: bgVideos })
            },

            setRecentBibleSearches: (searchQuery) => {
                if (!searchQuery) return

                set((state) => {
                    let tempArr = [...state.recentBibleSearches]
                    if (tempArr.length >= 20) {
                        tempArr.shift()
                    }
                    const tempSet = new Set(tempArr)
                    tempSet.add(searchQuery)
                    return { recentBibleSearches: Array.from(tempSet) }
                })
            },

            setFailedUploadRequests: (failedRequest) => {
                if (!failedRequest) return

                set((state) => ({
                    failedUploadRequests: [...state.failedUploadRequests, failedRequest]
                }))
            },

            removeFailedUploadRequest: (failedRequest) => {
                set((state) => ({
                    failedUploadRequests: state.failedUploadRequests.filter(
                        (req) => !(req.path === failedRequest.path && req.timestamp === failedRequest.timestamp)
                    )
                }))
            },

            setSlidesLoading: (loading) => {
                set({ slidesLoading: loading })
            },

            setLastSynced: (lastSynced) => {
                set({ lastSynced })
            },

            setBannerVisible: (bannerVisible) => {
                set({ bannerVisible })
            },

            setBibleVersions: (bibleVersions) => {
                set({ bibleVersions })
            },

            setActiveSocket: (socket) => {
                set({ activeSocket: socket })
            },

            setMainDisplayLabel: (label) => {
                set({ mainDisplayLabel: label })
            },

            setMainDisplayScreen: (screen) => {
                set({ mainDisplayScreen: screen })
            },

            setLiveWindowFullscreen: (fullscreen) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        liveWindowFullscreen: fullscreen
                    }
                }))
            },

            setLiveOutputMonitorId: (monitorId) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        liveOutputMonitorId: monitorId
                    }
                }))
            },

            setLinesPerSlide: (lines) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            linesPerSlide: lines
                        }
                    }
                }))
            },

            // Global default for bible verse reference position (above or below the verse body).
            // Per-slide `slide.slideStyle.verseRefPosition` overrides this at render time.
            setVerseRefPosition: (position) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefPosition: position
                        }
                    }
                }))
            },

            setVerseRefColor: (color) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefColor: color
                        }
                    }
                }))
            },

            setVerseRefBold: (bold) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefBold: bold
                        }
                    }
                }))
            },

            setVerseRefItalic: (italic) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefItalic: italic
                        }
                    }
                }))
            },

            setVerseRefUnderline: (underline) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefUnderline: underline
                        }
                    }
                }))
            },

            setVerseRefSizePercent: (percent) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            verseRefSizePercent: percent
                        }
                    }
                }))
            },

            setAnimations: (animations) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        animations
                    }
                }))
            },

            setFootnotes: (footnotes) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        footnotes
                    }
                }))
            },

            setSongAndHymnLabelsVisibility: (visibility) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        songAndHymnLabelsVisibility: visibility
                    }
                }))
            },

            setTransitionInterval: (interval) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        transitionInterval: interval
                    }
                }))
            },

            setWindowPadding: (padding) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        slideStyles: {
                            ...state.settings.slideStyles,
                            windowPadding: {
                                ...state.settings.slideStyles.windowPadding,
                                ...padding
                            }
                        }
                    }
                }))
            },

            setActiveAdvert: (advert) => {
                set({ activeAdvert: advert })
            },

            setDefaultSlideBackgrounds: () => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        defaultBackground: {
                            ...state.settings.defaultBackground,
                            hymn: {
                                backgroundType: 'video',
                                background: state.backgroundVideos?.[2]?.url || '',
                                backgroundVideoKey: null
                            },
                            bible: {
                                backgroundType: 'video',
                                background: state.backgroundVideos?.[2]?.url || '',
                                backgroundVideoKey: null
                            },
                            text: {
                                backgroundType: 'video',
                                background: state.backgroundVideos?.[3]?.url || '',
                                backgroundVideoKey: null
                            }
                        }
                    }
                }))
            },

            setDefaultSlideBackground: (type, background, backgroundVideoKey = null) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        defaultBackground: {
                            ...state.settings.defaultBackground,
                            default: {
                                backgroundType: type,
                                background,
                                backgroundVideoKey
                            }
                        }
                    }
                }))
            },

            setDefaultTemplate: (slideType, templateId) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        defaultTemplates: {
                            ...state.settings.defaultTemplates,
                            [slideType]: templateId
                        }
                    }
                }))
            },

            signOut: () => {
                set({
                    ...initialState,
                    pastStates: [],
                    futureStates: []
                })
            },

            // Schedule CRUD
            createSchedule: (name) => {
                set((state) => {
                    const newSchedule: Schedule = {
                        _id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name,
                        authorId: '',
                        editorIds: [],
                        churchId: state.activeSchedule?.churchId || '',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    }
                    return {
                        schedules: [...state.schedules, newSchedule],
                        activeSchedule: newSchedule,
                    }
                })
            },

            deleteSchedule: (scheduleId) => {
                set((state) => {
                    const updatedSchedules = state.schedules.filter((s) => s._id !== scheduleId)
                    const updatedSlides = state.activeSlides.filter((s) => s.scheduleId !== scheduleId)
                    return {
                        schedules: updatedSchedules,
                        activeSlides: updatedSlides,
                        activeSchedule: state.activeSchedule?._id === scheduleId
                            ? updatedSchedules[0] || null
                            : state.activeSchedule,
                    }
                })
            },

            updateSchedule: (scheduleId, updates) => {
                set((state) => ({
                    schedules: state.schedules.map((s) =>
                        s._id === scheduleId ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
                    ),
                    activeSchedule: state.activeSchedule?._id === scheduleId
                        ? { ...state.activeSchedule, ...updates, updatedAt: new Date().toISOString() }
                        : state.activeSchedule,
                }))
            },

            undo: () => {
                set((state) => {
                    if (state.pastStates.length === 0) return state

                    const previousState = state.pastStates[state.pastStates.length - 1]
                    const newPastStates = state.pastStates.slice(0, -1)

                    // Build minimal snapshot of current state (only tracked properties)
                    const currentSnapshot = {
                        activeSlides: state.activeSlides,
                        liveOutputSlidesId: state.liveOutputSlidesId,
                    }

                    return {
                        ...state,
                        ...previousState,
                        pastStates: newPastStates,
                        futureStates: [currentSnapshot, ...state.futureStates]
                    }
                })
            },

            redo: () => {
                set((state) => {
                    if (state.futureStates.length === 0) return state

                    const nextState = state.futureStates[0]
                    const newFutureStates = state.futureStates.slice(1)

                    // Build minimal snapshot of current state (only tracked properties)
                    const currentSnapshot = {
                        activeSlides: state.activeSlides,
                        liveOutputSlidesId: state.liveOutputSlidesId,
                    }

                    return {
                        ...state,
                        ...nextState,
                        pastStates: [...state.pastStates, currentSnapshot],
                        futureStates: newFutureStates
                    }
                })
            },

            refreshAppActionsStack: () => {
                set({ pastStates: [], futureStates: [] })
            },

            // UI Actions (formerly event-driven)
            openModal: (modal) => {
                set((state) => ({
                    modals: { ...state.modals, [modal]: true }
                }))
            },

            closeModal: (modal) => {
                set((state) => ({
                    modals: { ...state.modals, [modal]: false },
                    editingSlide: (modal === 'editor' || modal === 'lowerThirdEditor') ? null : state.editingSlide
                }))
            },

            closeAllModals: () => {
                set({
                    modals: initialModalState,
                    editingSlide: null
                })
            },

            setQuickActionsPage: (page) => {
                set({ quickActionsPage: page })
            },

            setEditingSlide: (slide) => {
                set({ editingSlide: slide })
            },

            toggleDarkMode: () => {
                set((state) => {
                    const newIsDark = !state.isDarkMode
                    // Persist to localStorage
                    localStorage.setItem('theme', newIsDark ? 'dark' : 'light')
                    // Toggle document class
                    if (newIsDark) {
                        document.documentElement.classList.add('dark')
                    } else {
                        document.documentElement.classList.remove('dark')
                    }
                    return { isDarkMode: newIsDark }
                })
            },

            setDarkMode: (isDark) => {
                set((state) => {
                    localStorage.setItem('theme', isDark ? 'dark' : 'light')
                    if (isDark) {
                        document.documentElement.classList.add('dark')
                    } else {
                        document.documentElement.classList.remove('dark')
                    }
                    return { isDarkMode: isDark }
                })
            },

            toggleBulkSelectMode: () => {
                set((state) => ({
                    bulkSelectMode: !state.bulkSelectMode,
                    selectedSlideIds: []
                }))
            },

            setBulkSelectMode: (mode) => {
                set({
                    bulkSelectMode: mode,
                    selectedSlideIds: []
                })
            },

            toggleSlideSelection: (slideId) => {
                set((state) => ({
                    selectedSlideIds: state.selectedSlideIds.includes(slideId)
                        ? state.selectedSlideIds.filter(id => id !== slideId)
                        : [...state.selectedSlideIds, slideId]
                }))
            },

            setSelectedSlideIds: (ids) => {
                set({ selectedSlideIds: ids })
            },

            clearSelectedSlides: () => {
                set({ selectedSlideIds: [], bulkSelectMode: false })
            },

            // Studio Mode layout actions
            setActiveNavSection: (section) => {
                set((state) => ({
                    activeNavSection: section,
                    contextPanelOpen: section !== null ? true : state.contextPanelOpen,
                    // Remember the last non-sermon content section so a surface
                    // the sermon listener displaces can show it instead.
                    lastContentSection: section && section !== 'sermon' ? section : state.lastContentSection,
                }))
            },

            toggleContextPanel: () => {
                set((state) => ({ contextPanelOpen: !state.contextPanelOpen }))
            },

            setContextPanelOpen: (open) => {
                set({ contextPanelOpen: open })
            },

            setContextPanelWidth: (width) => {
                set({ contextPanelWidth: Math.max(260, Math.min(460, width)) })
            },

            setSlideQueueWidth: (width) => {
                set({ slideQueueWidth: Math.max(200, Math.min(500, width)) })
            },

            setLiveOutputLayout: (mode) => {
                set({ liveOutputLayout: mode })
            },

            setPanelMode: (mode) => {
                set({ panelMode: mode })
            },

            setPanelPosition: (position) => {
                set({ panelPosition: position })
            },

            setCommandBarOpen: (open) => {
                set({ commandBarOpen: open })
            },

            toggleCommandBar: () => {
                set((state) => ({ commandBarOpen: !state.commandBarOpen }))
            },

            setQuickBibleBarOpen: (open) => {
                set({ quickBibleBarOpen: open })
            },

            toggleQuickBibleBar: () => {
                set((state) => ({ quickBibleBarOpen: !state.quickBibleBarOpen }))
            },

            setBiblePanelQuery: (query) => {
                set({ biblePanelQuery: query })
            },

            setSplitPanelMode: (mode) => {
                set({ splitPanelMode: mode })
            },

            setSplitPanelQuery: (query) => {
                set({ splitPanelQuery: query })
            },

            openBibleFromSermon: (verseReference) => {
                set((state) => {
                    // If the split center is already showing the Bible (because the
                    // sermon listener displaced it into the center), just load the
                    // verse there — don't yank the Bible into the sidebar, which
                    // would kick the sermon listener out of it.
                    const bibleAlreadyInCenter =
                        state.liveOutputLayout === 'split' &&
                        state.activeNavSection === 'sermon' &&
                        state.contextPanelOpen &&
                        state.lastContentSection === 'bible'
                    if (bibleAlreadyInCenter) {
                        return { biblePanelQuery: verseReference }
                    }
                    return {
                        activeNavSection: 'bible',
                        contextPanelOpen: true,
                        biblePanelQuery: verseReference,
                    }
                })
            },

            setWorkspaceMode: (mode) => {
                set({ workspaceMode: mode })
            },
        }),
        {
            name: 'app-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                settings: state.settings,
                schedules: state.schedules,
                activeSchedule: state.activeSchedule,
                recentBibleSearches: state.recentBibleSearches,
                bannerVisible: state.bannerVisible,
                bibleVersions: state.bibleVersions,
                // Persist studio layout preferences
                contextPanelOpen: state.contextPanelOpen,
                contextPanelWidth: state.contextPanelWidth,
                slideQueueWidth: state.slideQueueWidth,
                liveOutputLayout: state.liveOutputLayout,
                panelMode: state.panelMode,
                panelPosition: state.panelPosition,
                activeNavSection: state.activeNavSection,
                workspaceMode: state.workspaceMode,
                // Persist the operator's opt-in/lock, but never the live status.
                songTracking: {
                    enabled: state.songTracking.enabled,
                    locked: state.songTracking.locked,
                    autoDetect: state.songTracking.autoDetect,
                    externalLyrics: state.songTracking.externalLyrics,
                    status: DEFAULT_SONG_TRACKING.status,
                },
                visualizerEnabled: state.visualizerEnabled,
            }),
        }
    )
)
