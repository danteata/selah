export type PanelId =
    | 'quickActions'
    | 'previewContent'
    | 'liveOutput'
    | 'sermonListener'
    | 'library'

export interface LayoutItem {
    i: string
    x: number
    y: number
    w: number
    h: number
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
    static?: boolean
}

export interface PanelConfig {
    id: PanelId
    title: string
    icon: string
    defaultLayout: LayoutItem
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
    isCollapsible?: boolean
    isClosable?: boolean
}

export interface DashboardLayoutConfig {
    panels: PanelConfig[]
    layouts: { [key: string]: LayoutItem[] }
}

export const DEFAULT_PANEL_CONFIGS: PanelConfig[] = [
    {
        id: 'quickActions',
        title: 'Quick Actions',
        icon: 'Zap',
        defaultLayout: { i: 'quickActions', x: 0, y: 0, w: 2, h: 16, minW: 2, minH: 8 },
        minW: 2,
        minH: 8,
        isCollapsible: true,
        isClosable: true,
    },
    {
        id: 'sermonListener',
        title: 'Sermon Listener',
        icon: 'Mic',
        defaultLayout: { i: 'sermonListener', x: 2, y: 0, w: 2, h: 16, minW: 2, minH: 8 },
        minW: 2,
        minH: 8,
        isCollapsible: true,
    },
    {
        id: 'previewContent',
        title: 'Preview',
        icon: 'LayoutGrid',
        defaultLayout: { i: 'previewContent', x: 4, y: 0, w: 5, h: 16, minW: 4, minH: 6 },
        minW: 4,
        minH: 6,
        isCollapsible: true,
    },
    {
        id: 'liveOutput',
        title: 'Live Output',
        icon: 'Monitor',
        // minH raised so a resized Live Output keeps enough height for its
        // header + stacked Next-Up/Active/Sermon controls (it stacks them when
        // the panel is narrow) instead of getting squashed.
        defaultLayout: { i: 'liveOutput', x: 9, y: 0, w: 3, h: 16, minW: 3, minH: 8 },
        minW: 3,
        minH: 8,
        isCollapsible: true,
    },
]

export const DEFAULT_LAYOUTS: { [key: string]: LayoutItem[] } = {
    // Large screens (1200px+): 12 columns
    // QuickActions (2 cols) + SermonListener (2 cols) + Preview (5 cols) + Live (3 cols) = 12
    lg: DEFAULT_PANEL_CONFIGS.map(p => p.defaultLayout),
    // Medium screens (996px+): 10 columns
    // QuickActions (2 cols) + SermonListener (2 cols) + Preview (4 cols) + Live (2 cols) = 10
    md: [
        { i: 'quickActions', x: 0, y: 0, w: 2, h: 14, minW: 2, minH: 8 },
        { i: 'sermonListener', x: 2, y: 0, w: 2, h: 14, minW: 2, minH: 8 },
        { i: 'previewContent', x: 4, y: 0, w: 4, h: 14, minW: 3, minH: 6 },
        { i: 'liveOutput', x: 8, y: 0, w: 2, h: 14, minW: 2, minH: 8 },
    ],
    // Small screens (768px+): 6 columns
    // QuickActions + SermonListener stacked on left (2 cols), Preview + Live stacked on right (4 cols)
    sm: [
        { i: 'quickActions', x: 0, y: 0, w: 2, h: 7, minW: 2, minH: 4 },
        { i: 'sermonListener', x: 0, y: 7, w: 2, h: 7, minW: 2, minH: 4 },
        { i: 'previewContent', x: 2, y: 0, w: 4, h: 8, minW: 2, minH: 5 },
        { i: 'liveOutput', x: 2, y: 8, w: 4, h: 6, minW: 2, minH: 4 },
    ],
    // Extra small screens (480px+): 4 columns - stacked vertically, QuickActions as toggleable
    xs: [
        { i: 'sermonListener', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 4 },
        { i: 'previewContent', x: 0, y: 6, w: 4, h: 8, minW: 2, minH: 5 },
        { i: 'liveOutput', x: 0, y: 14, w: 4, h: 6, minW: 1, minH: 4 },
    ],
    // Tiny screens (<480px): 2 columns - minimal single column
    xxs: [
        { i: 'sermonListener', x: 0, y: 0, w: 2, h: 5, minW: 1, minH: 3 },
        { i: 'previewContent', x: 0, y: 5, w: 2, h: 7, minW: 1, minH: 4 },
        { i: 'liveOutput', x: 0, y: 12, w: 2, h: 5, minW: 1, minH: 3 },
    ],
}

// ---------------------------------------------------------------------------
// Layout presets
//
// Free-form drag/resize is powerful but risky mid-service — an operator can
// accidentally shrink or hide a panel. Presets give one-click, task-tuned
// arrangements (and free-form stays available behind an explicit edit toggle).
// ---------------------------------------------------------------------------

export interface DashboardPreset {
    id: string
    name: string
    /** Short label for the compact preset switcher in the dock. */
    shortName: string
    /** Panels hidden in this preset. */
    hidden: PanelId[]
    /** Center (Live Output) arrangement this workspace applies. */
    centerMode: 'stacked' | 'split' | 'focus'
    layouts: { [key: string]: LayoutItem[] }
}

// Below `md` the grid stacks and the component filters each preset's hidden
// panels out anyway, so all presets share the default small-screen layouts.
const SMALL_BREAKPOINT_LAYOUTS = {
    sm: DEFAULT_LAYOUTS.sm,
    xs: DEFAULT_LAYOUTS.xs,
    xxs: DEFAULT_LAYOUTS.xxs,
}

export const DASHBOARD_PRESETS: DashboardPreset[] = [
    {
        // Studio: the balanced core layout — every panel, feed beside its
        // Next Up + Active controls. The shipped default.
        id: 'default',
        name: 'Studio',
        shortName: 'Studio',
        hidden: [],
        centerMode: 'stacked',
        layouts: DEFAULT_LAYOUTS,
    },
    {
        // Preaching: a wide split Live Output — Preview | Program paired on top,
        // Verses/Sermon tabbed below — beside the service queue. The sermon lives
        // in the split's Sermon tab, so its own panel and the content picker step
        // aside and nothing is duplicated. Live Output is kept wide so the split
        // has room for the paired preview + program.
        id: 'preaching',
        name: 'Preaching',
        shortName: 'Preach',
        hidden: ['quickActions', 'sermonListener'],
        centerMode: 'split',
        layouts: {
            lg: [
                { i: 'previewContent', x: 0, y: 0, w: 5, h: 16, minW: 4, minH: 6 },
                { i: 'liveOutput', x: 5, y: 0, w: 7, h: 16, minW: 4, minH: 6 },
            ],
            md: [
                { i: 'previewContent', x: 0, y: 0, w: 4, h: 14, minW: 4, minH: 6 },
                { i: 'liveOutput', x: 4, y: 0, w: 6, h: 14, minW: 4, minH: 6 },
            ],
            ...SMALL_BREAKPOINT_LAYOUTS,
        },
    },
    {
        // Worship: song picker on the left, a wide Live Output in the middle (its
        // Next Up + Active controls stack above the feed at this width, sermon
        // hidden), and the queue on the right. No sermon panes during the singing.
        id: 'worship',
        name: 'Worship',
        shortName: 'Worship',
        hidden: ['sermonListener'],
        centerMode: 'stacked',
        layouts: {
            lg: [
                { i: 'quickActions', x: 0, y: 0, w: 2, h: 16, minW: 2, minH: 8 },
                { i: 'liveOutput', x: 2, y: 0, w: 6, h: 16, minW: 4, minH: 6 },
                { i: 'previewContent', x: 8, y: 0, w: 4, h: 16, minW: 4, minH: 6 },
            ],
            md: [
                { i: 'quickActions', x: 0, y: 0, w: 2, h: 14, minW: 2, minH: 8 },
                { i: 'liveOutput', x: 2, y: 0, w: 4, h: 14, minW: 4, minH: 6 },
                { i: 'previewContent', x: 6, y: 0, w: 4, h: 14, minW: 4, minH: 6 },
            ],
            ...SMALL_BREAKPOINT_LAYOUTS,
        },
    },
    {
        // Live focus: just the queue and the program output, split evenly, for
        // running a service that's already built.
        id: 'live',
        name: 'Run',
        shortName: 'Run',
        hidden: ['quickActions', 'sermonListener'],
        // Focus center: the live feed maximized for running a built order.
        centerMode: 'focus',
        layouts: {
            lg: [
                { i: 'previewContent', x: 0, y: 0, w: 6, h: 16, minW: 4, minH: 6 },
                { i: 'liveOutput', x: 6, y: 0, w: 6, h: 16, minW: 3, minH: 6 },
            ],
            md: [
                { i: 'previewContent', x: 0, y: 0, w: 5, h: 14, minW: 3, minH: 6 },
                { i: 'liveOutput', x: 5, y: 0, w: 5, h: 14, minW: 2, minH: 6 },
            ],
            ...SMALL_BREAKPOINT_LAYOUTS,
        },
    },
]
