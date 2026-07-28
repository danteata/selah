/**
 * Studio Mode layout types
 * Replaces the old react-grid-layout panel system with a fixed studio layout
 */

export type NavSection =
    | 'bible'
    | 'dictionary'
    | 'music'
    | 'media'
    | 'templates'
    | 'countdown'
    | 'alerts'
    | 'library'
    | 'schedule'
    | 'sermon'
    | 'settings'

/**
 * Sections that open as inline content in the ContextPanel.
 *
 * The rest (`library`, `schedule`, `settings`) open modals instead — AppShell
 * turns those into `openModal` calls and clears the section.
 *
 * This list is the single gate on a section being reachable at all: AppShell
 * decides whether to render ContextPanel from it, and ContextPanel decides
 * whether to render content from it. It lived in both files as separate
 * literals, which is how `dictionary` shipped wired-up-but-invisible — the rail
 * set the section, ContextPanel knew how to draw it, and AppShell never
 * mounted it.
 */
export const INLINE_NAV_SECTIONS: NavSection[] = [
    'bible',
    'dictionary',
    'music',
    'media',
    'templates',
    'countdown',
    'alerts',
    'sermon',
]

export function isInlineNavSection(section: NavSection | null): boolean {
    return !!section && INLINE_NAV_SECTIONS.includes(section)
}

export type SplitPanelMode = 'sermon-bible' | null

export interface StudioLayoutState {
    activeNavSection: NavSection | null
    contextPanelOpen: boolean
    contextPanelWidth: number
    commandBarOpen: boolean
    commandBarQuery: string
    selectedSlideForInspector: string | null
    splitPanelMode: SplitPanelMode
    splitPanelQuery: string | null
}

export const DEFAULT_STUDIO_STATE: StudioLayoutState = {
    activeNavSection: null,
    contextPanelOpen: true,
    contextPanelWidth: 320,
    commandBarOpen: false,
    commandBarQuery: '',
    selectedSlideForInspector: null,
    splitPanelMode: null,
    splitPanelQuery: null,
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
    { id: 'dictionary', icon: 'BookA', label: 'Dictionary' },
    { id: 'templates', icon: 'Layout', label: 'Templates' },
    { id: 'countdown', icon: 'Clock', label: 'Countdown' },
    { id: 'alerts', icon: 'AlertCircle', label: 'Alerts' },
    { id: 'library', icon: 'Archive', label: 'Library' },
    { id: 'schedule', icon: 'Calendar', label: 'Schedule', dividerBefore: true },
    { id: 'sermon', icon: 'Mic', label: 'Sermon Listener' },
    { id: 'settings', icon: 'Settings', label: 'Settings', dividerBefore: true },
]
