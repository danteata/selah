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
        defaultLayout: { i: 'quickActions', x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
        minW: 2,
        minH: 6,
        isCollapsible: true,
    },
    {
        id: 'previewContent',
        title: 'Preview',
        icon: 'LayoutGrid',
        defaultLayout: { i: 'previewContent', x: 3, y: 0, w: 6, h: 12, minW: 4, minH: 6 },
        minW: 4,
        minH: 6,
        isCollapsible: true,
    },
    {
        id: 'liveOutput',
        title: 'Live Output',
        icon: 'Monitor',
        defaultLayout: { i: 'liveOutput', x: 9, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
        minW: 2,
        minH: 6,
        isCollapsible: true,
    },
    {
        id: 'sermonListener',
        title: 'Sermon Listener',
        icon: 'Mic',
        defaultLayout: { i: 'sermonListener', x: 0, y: 12, w: 12, h: 4, minW: 4, minH: 3 },
        minW: 4,
        minH: 3,
        isCollapsible: true,
        isClosable: true,
    },
]

export const DEFAULT_LAYOUTS: { [key: string]: LayoutItem[] } = {
    // Large screens (1200px+): 12 columns - full layout
    lg: DEFAULT_PANEL_CONFIGS.map(p => p.defaultLayout),
    // Medium screens (996px+): 10 columns
    md: [
        { i: 'quickActions', x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
        { i: 'previewContent', x: 3, y: 0, w: 4, h: 12, minW: 3, minH: 6 },
        { i: 'liveOutput', x: 7, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
        { i: 'sermonListener', x: 0, y: 12, w: 10, h: 4, minW: 4, minH: 3 },
    ],
    // Small screens (768px+): 6 columns - stacked layout
    sm: [
        { i: 'quickActions', x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 5 },
        { i: 'previewContent', x: 3, y: 0, w: 3, h: 10, minW: 2, minH: 5 },
        { i: 'liveOutput', x: 0, y: 10, w: 6, h: 8, minW: 2, minH: 5 },
        { i: 'sermonListener', x: 0, y: 18, w: 6, h: 4, minW: 2, minH: 3 },
    ],
    // Extra small screens (480px+): 4 columns - single column layout
    xs: [
        { i: 'quickActions', x: 0, y: 0, w: 4, h: 8, minW: 1, minH: 4 },
        { i: 'previewContent', x: 0, y: 8, w: 4, h: 10, minW: 2, minH: 5 },
        { i: 'liveOutput', x: 0, y: 18, w: 4, h: 8, minW: 1, minH: 4 },
        { i: 'sermonListener', x: 0, y: 26, w: 4, h: 4, minW: 2, minH: 3 },
    ],
    // Tiny screens (<480px): 2 columns - minimal layout
    xxs: [
        { i: 'quickActions', x: 0, y: 0, w: 2, h: 6, minW: 1, minH: 3 },
        { i: 'previewContent', x: 0, y: 6, w: 2, h: 8, minW: 1, minH: 4 },
        { i: 'liveOutput', x: 0, y: 14, w: 2, h: 6, minW: 1, minH: 3 },
        { i: 'sermonListener', x: 0, y: 20, w: 2, h: 4, minW: 1, minH: 3 },
    ],
}
