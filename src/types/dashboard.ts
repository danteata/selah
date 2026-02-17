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
        defaultLayout: { i: 'liveOutput', x: 9, y: 0, w: 3, h: 16, minW: 3, minH: 6 },
        minW: 3,
        minH: 6,
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
        { i: 'liveOutput', x: 8, y: 0, w: 2, h: 14, minW: 2, minH: 6 },
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
