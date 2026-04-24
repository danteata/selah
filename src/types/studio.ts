/**
 * Studio Mode layout types
 * Replaces the old react-grid-layout panel system with a fixed studio layout
 */

export type NavSection =
    | 'bible'
    | 'music'
    | 'media'
    | 'templates'
    | 'countdown'
    | 'alerts'
    | 'library'
    | 'schedule'
    | 'sermon'
    | 'settings'

export interface StudioLayoutState {
    activeNavSection: NavSection | null
    contextPanelOpen: boolean
    contextPanelWidth: number
    commandBarOpen: boolean
    commandBarQuery: string
    selectedSlideForInspector: string | null
}

export const DEFAULT_STUDIO_STATE: StudioLayoutState = {
    activeNavSection: null,
    contextPanelOpen: true,
    contextPanelWidth: 320,
    commandBarOpen: false,
    commandBarQuery: '',
    selectedSlideForInspector: null,
}

export interface NavRailItem {
    id: NavSection
    icon: string
    label: string
    badge?: number
    dividerBefore?: boolean
}

export const NAV_RAIL_ITEMS: NavRailItem[] = [
    { id: 'bible', icon: 'BookOpen', label: 'Bible' },
    { id: 'music', icon: 'Music', label: 'Songs & Hymns' },
    { id: 'media', icon: 'Image', label: 'Media' },
    { id: 'templates', icon: 'Layout', label: 'Templates' },
    { id: 'countdown', icon: 'Clock', label: 'Countdown' },
    { id: 'alerts', icon: 'AlertCircle', label: 'Alerts' },
    { id: 'library', icon: 'Archive', label: 'Library' },
    { id: 'schedule', icon: 'Calendar', label: 'Schedule', dividerBefore: true },
    { id: 'sermon', icon: 'Mic', label: 'Sermon Listener' },
    { id: 'settings', icon: 'Settings', label: 'Settings', dividerBefore: true },
]
