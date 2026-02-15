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
    lg: DEFAULT_PANEL_CONFIGS.map(p => p.defaultLayout),
    md: DEFAULT_PANEL_CONFIGS.map(p => p.defaultLayout),
    sm: DEFAULT_PANEL_CONFIGS.map(p => ({
        ...p.defaultLayout,
        x: 0,
        w: 12,
    })),
}