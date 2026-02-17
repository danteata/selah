import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Zap, LayoutGrid, Monitor, Mic, Library } from 'lucide-react'
import { DraggablePanel } from './DraggablePanel'
import { QuickActions } from '../quick-actions/QuickActions'
import { PreviewContent } from '../preview/PreviewContent'
import { LiveOutput } from '../live/LiveOutput'
import { SermonListenerPanel } from '../sermon-listener'
import {
    DEFAULT_PANEL_CONFIGS,
    DEFAULT_LAYOUTS,
    type PanelId,
    type LayoutItem
} from '../../types/dashboard'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboard.css'

import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
const ResponsiveGridLayout = WidthProvider(Responsive)

// Height of a collapsed panel in grid units (header only ≈ 2 rows × 40px = 80px)
const COLLAPSED_HEIGHT = 2

interface DashboardLayoutProps {
    showSermonListener?: boolean
    onSermonListenerToggle?: () => void
}

const STORAGE_KEY = 'selah-dashboard-layout'

// Icon mapping
const iconMap: Record<string, React.ReactNode> = {
    Zap: <Zap className="w-4 h-4" />,
    LayoutGrid: <LayoutGrid className="w-4 h-4" />,
    Monitor: <Monitor className="w-4 h-4" />,
    Mic: <Mic className="w-4 h-4" />,
    Library: <Library className="w-4 h-4" />,
}

// Accent color mapping for each panel
const accentColorMap: Record<PanelId, string> = {
    quickActions: 'blue',
    previewContent: 'purple',
    liveOutput: 'emerald',
    sermonListener: 'amber',
    library: 'rose',
}

export function DashboardLayout({
    showSermonListener = false,
    onSermonListenerToggle
}: DashboardLayoutProps) {
    const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(new Set())
    const [hiddenPanels, setHiddenPanels] = useState<Set<PanelId>>(new Set())
    const [layouts, setLayouts] = useState<{ [key: string]: LayoutItem[] }>(() => {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
            try {
                return JSON.parse(saved)
            } catch {
                return DEFAULT_LAYOUTS
            }
        }
        return DEFAULT_LAYOUTS
    })

    // Store original heights so we can restore them on expand
    const originalHeightsRef = useRef<Record<string, number>>({})

    // Save layouts to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
    }, [layouts])

    // Handle sermon listener visibility
    useEffect(() => {
        if (showSermonListener) {
            setHiddenPanels(prev => {
                const next = new Set(prev)
                next.delete('sermonListener')
                return next
            })
            // Restore default layout when showing
            const panelConfig = DEFAULT_PANEL_CONFIGS.find(p => p.id === 'sermonListener')
            if (panelConfig) {
                setLayouts(prevLayouts => {
                    const updated: { [key: string]: LayoutItem[] } = {}
                    Object.entries(prevLayouts).forEach(([bp, items]) => {
                        const existingItem = items.find(item => item.i === 'sermonListener')
                        if (existingItem) {
                            updated[bp] = items.map(item =>
                                item.i === 'sermonListener'
                                    ? { ...item, w: panelConfig.defaultLayout.w, h: panelConfig.defaultLayout.h, minW: panelConfig.minW, minH: panelConfig.minH }
                                    : item
                            )
                        } else {
                            updated[bp] = [...items, panelConfig.defaultLayout]
                        }
                    })
                    return updated
                })
            }
        } else {
            setHiddenPanels(prev => new Set(prev).add('sermonListener'))
        }
    }, [showSermonListener])

    const handleLayoutChange = useCallback((newLayouts: { [key: string]: LayoutItem[] }) => {
        setLayouts(newLayouts)
    }, [])

    const handleCollapse = useCallback((panelId: PanelId) => {
        setCollapsedPanels(prev => {
            const next = new Set(prev)
            const isCurrentlyCollapsed = next.has(panelId)

            if (isCurrentlyCollapsed) {
                // Expanding — restore original height
                next.delete(panelId)
                const origH = originalHeightsRef.current[panelId]
                if (origH) {
                    setLayouts(prevLayouts => {
                        const updated: { [key: string]: LayoutItem[] } = {}
                        Object.entries(prevLayouts).forEach(([bp, items]) => {
                            updated[bp] = items.map(item =>
                                item.i === panelId
                                    ? { ...item, h: origH, minH: DEFAULT_PANEL_CONFIGS.find(p => p.id === panelId)?.minH }
                                    : item
                            )
                        })
                        return updated
                    })
                }
            } else {
                // Collapsing — save current height then shrink
                next.add(panelId)
                setLayouts(prevLayouts => {
                    const updated: { [key: string]: LayoutItem[] } = {}
                    Object.entries(prevLayouts).forEach(([bp, items]) => {
                        updated[bp] = items.map(item => {
                            if (item.i === panelId) {
                                // Save the original height before collapsing
                                if (!originalHeightsRef.current[panelId]) {
                                    originalHeightsRef.current[panelId] = item.h
                                }
                                return { ...item, h: COLLAPSED_HEIGHT, minH: COLLAPSED_HEIGHT }
                            }
                            return item
                        })
                    })
                    return updated
                })
            }

            return next
        })
    }, [])

    const handleClose = useCallback((panelId: PanelId) => {
        setHiddenPanels(prev => new Set(prev).add(panelId))
        if (panelId === 'sermonListener' && onSermonListenerToggle) {
            onSermonListenerToggle()
        }
    }, [onSermonListenerToggle])

    const togglePanel = useCallback((panelId: PanelId) => {
        setHiddenPanels(prev => {
            const next = new Set(prev)
            if (next.has(panelId)) {
                // Showing the panel - restore default layout
                next.delete(panelId)
                const panelConfig = DEFAULT_PANEL_CONFIGS.find(p => p.id === panelId)
                if (panelConfig) {
                    setLayouts(prevLayouts => {
                        const updated: { [key: string]: LayoutItem[] } = {}
                        Object.entries(prevLayouts).forEach(([bp, items]) => {
                            const existingItem = items.find(item => item.i === panelId)
                            if (existingItem) {
                                // Update existing item to default dimensions
                                updated[bp] = items.map(item =>
                                    item.i === panelId
                                        ? { ...item, w: panelConfig.defaultLayout.w, h: panelConfig.defaultLayout.h, minW: panelConfig.minW, minH: panelConfig.minH }
                                        : item
                                )
                            } else {
                                // Add the panel with default layout
                                updated[bp] = [...items, panelConfig.defaultLayout]
                            }
                        })
                        return updated
                    })
                }
            } else {
                next.add(panelId)
            }
            return next
        })
    }, [])

    // Filter visible panels
    const visiblePanels = useMemo(() => {
        return DEFAULT_PANEL_CONFIGS.filter(p => !hiddenPanels.has(p.id))
    }, [hiddenPanels])

    // Get current breakpoint layouts with hidden panels filtered
    const currentLayouts = useMemo(() => {
        const result: { [key: string]: LayoutItem[] } = {}
        Object.entries(layouts).forEach(([breakpoint, layoutItems]) => {
            result[breakpoint] = layoutItems.filter(
                item => !hiddenPanels.has(item.i as PanelId)
            )
        })
        return result
    }, [layouts, hiddenPanels])

    // Render panel content based on ID
    const renderPanelContent = (panelId: PanelId) => {
        switch (panelId) {
            case 'quickActions':
                return <QuickActions />
            case 'previewContent':
                return <PreviewContent />
            case 'liveOutput':
                return <LiveOutput />
            case 'sermonListener':
                return (
                    <SermonListenerPanel
                        autoLookup={true}
                        autoDisplay={false}
                        compact={true}
                    />
                )
            case 'library':
                return <div className="text-gray-500">Library coming soon...</div>
            default:
                return <div>Unknown panel</div>
        }
    }

    return (
        <div className="dashboard-layout h-full w-full">
            <ResponsiveGridLayout
                className="layout"
                layouts={currentLayouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={40}
                containerPadding={[12, 12]}
                margin={[12, 12]}
                onLayoutChange={(layout: any, allLayouts: any) => {
                    const converted: { [key: string]: LayoutItem[] } = {}
                    Object.entries(allLayouts).forEach(([key, items]) => {
                        const layoutItems = items as any[]
                        converted[key] = layoutItems.map(item => ({
                            i: item.i,
                            x: item.x,
                            y: item.y,
                            w: item.w,
                            h: item.h,
                            minW: item.minW,
                            minH: item.minH,
                            maxW: item.maxW,
                            maxH: item.maxH,
                            static: item.static,
                        }))
                    })
                    handleLayoutChange(converted)
                }}
                draggableHandle=".cursor-move"
                isDraggable={true}
                isResizable={true}
                compactType="vertical"
                preventCollision={false}
                useCSSTransforms={true}
                droppingItem={{ i: 'new', x: 0, y: 0, w: 4, h: 4 }}
            >
                {visiblePanels.map((panel) => (
                    <div
                        key={panel.id}
                        className="panel-container"
                    >
                        <DraggablePanel
                            id={panel.id}
                            title={panel.title}
                            icon={iconMap[panel.icon]}
                            isCollapsed={collapsedPanels.has(panel.id)}
                            isClosable={panel.isClosable}
                            onClose={() => handleClose(panel.id)}
                            onCollapse={() => handleCollapse(panel.id)}
                            accentColor={accentColorMap[panel.id]}
                        >
                            {renderPanelContent(panel.id)}
                        </DraggablePanel>
                    </div>
                ))}
            </ResponsiveGridLayout>

            {/* Panel Toggle Bar - Fixed at bottom, responsive */}
            <div className="fixed bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)] max-w-lg sm:max-w-none sm:w-auto">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-1.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 overflow-x-auto">
                    <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 mr-1 uppercase tracking-wider hidden sm:inline">Panels</span>
                    {DEFAULT_PANEL_CONFIGS.map((panel) => {
                        const isHidden = hiddenPanels.has(panel.id)
                        const Icon = iconMap[panel.icon]
                        return (
                            <button
                                key={panel.id}
                                onClick={() => {
                                    if (panel.id === 'sermonListener') {
                                        onSermonListenerToggle?.()
                                    } else {
                                        togglePanel(panel.id)
                                    }
                                }}
                                className={`
                                    flex items-center justify-center gap-1 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-[11px] font-medium
                                    transition-all duration-200 whitespace-nowrap
                                    ${isHidden
                                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        : `${accentColorMap[panel.id] === 'blue' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''}
                                           ${accentColorMap[panel.id] === 'purple' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' : ''}
                                           ${accentColorMap[panel.id] === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : ''}
                                           ${accentColorMap[panel.id] === 'amber' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : ''}
                                           ${accentColorMap[panel.id] === 'rose' ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400' : ''}`
                                    }
                                `}
                                title={isHidden ? `Show ${panel.title}` : `Hide ${panel.title}`}
                            >
                                {Icon}
                                <span className="hidden sm:inline">{panel.title}</span>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}