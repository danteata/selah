import { useState, useCallback, useEffect, useMemo } from 'react'
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

// Use require to get around type issues with react-grid-layout
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Responsive, WidthProvider } = require('react-grid-layout')
const ResponsiveGridLayout = WidthProvider(Responsive)

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
        // Load from localStorage if available
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
            if (next.has(panelId)) {
                next.delete(panelId)
            } else {
                next.add(panelId)
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
                next.delete(panelId)
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
                containerPadding={[16, 16]}
                margin={[16, 16]}
                onLayoutChange={(layout: unknown, allLayouts: Record<string, unknown[]>) => {
                    // Convert to our type
                    const converted: { [key: string]: LayoutItem[] } = {}
                    Object.entries(allLayouts).forEach(([key, items]) => {
                        converted[key] = (items as LayoutItem[]).map(item => ({
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
                droppingItem={{ i: 'new', w: 4, h: 4 }}
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

            {/* Panel Toggle Bar - Fixed at bottom */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50">
                    <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">Panels:</span>
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
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  transition-all duration-200
                  ${isHidden
                                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        : `${accentColorMap[panel.id] === 'blue' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : ''}
                       ${accentColorMap[panel.id] === 'purple' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' : ''}
                       ${accentColorMap[panel.id] === 'emerald' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : ''}
                       ${accentColorMap[panel.id] === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : ''}
                       ${accentColorMap[panel.id] === 'rose' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' : ''}`
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