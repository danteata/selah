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
    BibleVersion
} from '../types'
import { bibleVersionObjects } from '../types'

export interface AppState {
    // State
    activeAdvert: Advert | null
    schedules: Schedule[]
    activeSchedule: Schedule | null
    activeSlides: Slide[]
    liveOutputSlidesId: string[] | null
    liveSlideId: string | null
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

    // Undo/Redo stacks
    pastStates: Array<Partial<AppState>>
    futureStates: Array<Partial<AppState>>
}

const defaultSettings: AppSettings = {
    appVersion: '0.1.0',
    defaultBibleVersion: 'KJV',
    defaultFont: 'Inter',
    defaultBackground: {
        hymn: {
            backgroundType: 'image',
            background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
            backgroundVideoKey: null
        },
        bible: {
            backgroundType: 'image',
            background: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
            backgroundVideoKey: null
        },
        text: {
            backgroundType: 'image',
            background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
            backgroundVideoKey: null
        },
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
    transitionInterval: 0.7,
    alertLimit: 5,
}

const initialState: AppState = {
    activeAdvert: null,
    schedules: [],
    activeSchedule: null,
    activeSlides: [],
    liveOutputSlidesId: null,
    liveSlideId: null,
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
    removeActiveSlide: (slide: Slide) => void
    replaceScheduleActiveSlides: (slides: Slide[]) => void
    setActiveSlides: (slides: Slide[]) => void
    setLiveOutputSlidesId: (slides: string[]) => void
    setLiveSlide: (slideId: string) => void
    setEmitter: (emitter: Emitter<Record<EventType, unknown>> | null) => void
    setAppSettings: (settings: AppSettings) => void
    setSlideStyles: (styles: SlideStyle) => void
    setDefaultBibleVersion: (version: string) => void
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
    setLinesPerSlide: (lines: number) => void
    setAnimations: (animations: boolean) => void
    setFootnotes: (footnotes: boolean) => void
    setSongAndHymnLabelsVisibility: (visibility: boolean) => void
    setTransitionInterval: (interval: number) => void
    setWindowPadding: (padding: { left?: number; right?: number; top?: number; bottom?: number }) => void
    setActiveAdvert: (advert: Advert | null) => void
    setDefaultSlideBackgrounds: () => void
    setDefaultSlideBackground: (type: string, background: string, backgroundVideoKey?: string | null) => void
    signOut: () => void
    // Schedule CRUD
    createSchedule: (name: string) => void
    deleteSchedule: (scheduleId: string) => void
    updateSchedule: (scheduleId: string, updates: Partial<Schedule>) => void
    // Undo/Redo
    undo: () => void
    redo: () => void
    refreshAppActionsStack: () => void
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

                    return {
                        pastStates: [...state.pastStates, { activeSlides: state.activeSlides }],
                        activeSlides: ensureUniqueIds(updatedSlides),
                        liveOutputSlidesId: Array.from(new Set(updatedSlides.map((slide) => slide?.id))),
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

            setActiveSlides: (slides) => {
                set((state) => ({
                    activeSlides: ensureUniqueIds(slides),
                    liveOutputSlidesId: Array.from(new Set(slides.map((slide) => slide.id))),
                    futureStates: []
                }))
            },

            setLiveOutputSlidesId: (slides) => {
                set({ liveOutputSlidesId: Array.from(new Set(slides)) })
            },

            setLiveSlide: (slideId) => {
                set({ liveSlideId: slideId })
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
                set((state) => ({
                    settings: {
                        ...state.settings,
                        bibleVersions
                    }
                }))
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

                    return {
                        ...state,
                        ...previousState,
                        pastStates: newPastStates,
                        futureStates: [state, ...state.futureStates]
                    }
                })
            },

            redo: () => {
                set((state) => {
                    if (state.futureStates.length === 0) return state

                    const nextState = state.futureStates[0]
                    const newFutureStates = state.futureStates.slice(1)

                    return {
                        ...state,
                        ...nextState,
                        pastStates: [...state.pastStates, state],
                        futureStates: newFutureStates
                    }
                })
            },

            refreshAppActionsStack: () => {
                set({ pastStates: [], futureStates: [] })
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
            }),
        }
    )
)
