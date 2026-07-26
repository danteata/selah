import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Zap, LayoutGrid, Monitor, Mic, Library, RotateCcw, Lock, Unlock } from 'lucide-react'
import { DraggablePanel } from './DraggablePanel'
import { QuickActionsSidebar } from '../quick-actions/QuickActionsSidebar'
import { PreviewContent } from '../preview/PreviewContent'
import { LiveOutput } from '../live/LiveOutput'
import { SermonListenerPanel } from '../sermon-listener'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'
import { useAppStore } from '../../store/appStore'
import {
    DEFAULT_PANEL_CONFIGS,
    DEFAULT_LAYOUTS,
    DASHBOARD_PRESETS,
    type PanelId,
    type LayoutItem
} from '../../types/dashboard'
import { LibraryContent } from '../library/LibraryContent'
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
const PRESET_KEY = 'selah-dashboard-preset'
const LOCK_KEY = 'selah-dashboard-edit-locked'

// Icon mapping
const iconMap: Record<string, React.ReactNode> = {
    Zap: <Zap className="w-4 h-4" />,
    LayoutGrid: <LayoutGrid className="w-4 h-4" />,
    Monitor: <Monitor className="w-4 h-4" />,
    Mic: <Mic className="w-4 h-4" />,
    Library: <Library className="w-4 h-4" />,
}

// Accent color mapping for each panel - refined palette
const accentColorMap: Record<PanelId, string> = {
    quickActions: 'teal',
    previewContent: 'indigo',
    liveOutput: 'emerald',
    sermonListener: 'amber',
    library: 'rose',
}

export function DashboardLayout({
    showSermonListener = false,
    onSermonListenerToggle
}: DashboardLayoutProps) {
    const sermonListener = useSermonListenerContext()
    const setLiveOutputLayout = useAppStore((s) => s.setLiveOutputLayout)
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const [collapsedPanels, setCollapsedPanels] = useState<Set<PanelId>>(new Set())
    const [userHiddenPanels, setUserHiddenPanels] = useState<Set<PanelId>>(new Set())
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

    // Which named preset is active (informational — the chip highlight).
    const [activePresetId, setActivePresetId] = useState<string>(
        () => localStorage.getItem(PRESET_KEY) || 'default'
    )
    // Edit lock: when true (the default), panels can't be dragged or resized,
    // so an operator can't accidentally wreck their layout mid-service. Free-
    // form arrangement is opt-in via the Edit toggle in the dock.
    const [editLocked, setEditLocked] = useState<boolean>(
        () => localStorage.getItem(LOCK_KEY) !== 'false'
    )
    useEffect(() => { localStorage.setItem(PRESET_KEY, activePresetId) }, [activePresetId])
    useEffect(() => { localStorage.setItem(LOCK_KEY, String(editLocked)) }, [editLocked])

    // Store original heights so we can restore them on expand
    const originalHeightsRef = useRef<Record<string, number>>({})

    // Auto-hide sermon panel from dashboard grid when ContextPanel sidebar has sermon section open
    // to prevent duplication — detected verses now appear in the Bible panel via DetectedVersesBar
    const sermonDuplicatedInSidebar = activeNavSection === 'sermon' && contextPanelOpen

    // Compute effective hidden panels: user-toggled + auto-hidden sermon when sidebar has it
    const hiddenPanels = useMemo(() => {
        const set = new Set(userHiddenPanels)
        if (sermonDuplicatedInSidebar) {
            set.add('sermonListener')
        }
        return set
    }, [userHiddenPanels, sermonDuplicatedInSidebar])

    // Save layouts to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
    }, [layouts])

    // Handle sermon listener visibility — restore layout when showing
    useEffect(() => {
        if (showSermonListener) {
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
        }
    }, [showSermonListener])

    const handleLayoutChange = useCallback((newLayouts: { [key: string]: LayoutItem[] }) => {
        // react-grid-layout fires onLayoutChange on every pass (including its own
        // compaction). Writing the result straight back re-renders and re-fires
        // it — an infinite loop that shows up as panels drifting on their own.
        // Commit only when the positions genuinely changed; returning the prev
        // reference lets React bail out of the re-render and stops the loop.
        // Canonical (order-independent) compare so reordered keys/items don't
        // register as a false change and keep the loop alive.
        const canon = (l: { [key: string]: LayoutItem[] }) =>
            Object.keys(l).sort().map(bp =>
                bp + ':' + [...(l[bp] ?? [])]
                    .sort((a, b) => (a.i < b.i ? -1 : 1))
                    .map(it => `${it.i},${it.x},${it.y},${it.w},${it.h}`)
                    .join('|')
            ).join(';')
        setLayouts(prev => (canon(prev) === canon(newLayouts) ? prev : newLayouts))
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
        setUserHiddenPanels(prev => new Set(prev).add(panelId))
        if (panelId === 'sermonListener' && onSermonListenerToggle) {
            onSermonListenerToggle()
        }
    }, [onSermonListenerToggle])

    const togglePanel = useCallback((panelId: PanelId) => {
        setUserHiddenPanels(prev => {
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

    // Apply a named workspace preset: layout + visible panels + the center
    // (Live Output) arrangement, all in one click.
    const applyPreset = useCallback((presetId: string) => {
        const preset = DASHBOARD_PRESETS.find(p => p.id === presetId)
        if (!preset) return
        setLayouts(preset.layouts)
        setUserHiddenPanels(new Set(preset.hidden))
        setCollapsedPanels(new Set())
        originalHeightsRef.current = {}
        setLiveOutputLayout(preset.centerMode)
        setActivePresetId(presetId)
    }, [setLiveOutputLayout])

    const resetLayout = useCallback(() => {
        setLayouts(DEFAULT_LAYOUTS)
        setUserHiddenPanels(new Set())
        setCollapsedPanels(new Set())
        originalHeightsRef.current = {}
        setLiveOutputLayout('stacked')
        setActivePresetId('default')
    }, [setLiveOutputLayout])

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
                return <QuickActionsSidebar />
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
                return <LibraryContent compact={true} />
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
                    // While locked there are no user drags to capture, so never
                    // feed RGL's own compaction back into state (belt-and-braces
                    // against the self-moving-panel loop).
                    if (editLocked) return
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
                isDraggable={!editLocked}
                isResizable={!editLocked}
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
                            draggable={!editLocked}
                        >
                            {renderPanelContent(panel.id)}
                        </DraggablePanel>
                    </div>
                ))}
            </ResponsiveGridLayout>

            {/* Panel Toggle Bar - Fixed at bottom, responsive */}
            <div className="fixed bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)] max-w-lg sm:max-w-none sm:w-auto">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-1.5 bg-[var(--bg-secondary)]/95 backdrop-blur-xl rounded-xl shadow-lg border border-[var(--border-default)] overflow-x-auto">
                    {/* Layout presets — one-click, task-tuned arrangements */}
                    <span className="text-[10px] font-medium text-[var(--text-muted)] mr-0.5 uppercase tracking-wider hidden sm:inline">Layout</span>
                    {DASHBOARD_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => applyPreset(preset.id)}
                            className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all duration-200 ${
                                activePresetId === preset.id
                                    ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                            title={`${preset.name} layout`}
                        >
                            {preset.shortName}
                        </button>
                    ))}
                    <div className="w-px h-4 bg-[var(--border-default)] mx-0.5 hidden sm:block" />
                    <span className="text-[10px] font-medium text-[var(--text-muted)] mr-1 uppercase tracking-wider hidden sm:inline">Panels</span>
                    {DEFAULT_PANEL_CONFIGS.map((panel) => {
                        const isHidden = hiddenPanels.has(panel.id)
                        const Icon = iconMap[panel.icon]
                        const isRecording = panel.id === 'sermonListener' && sermonListener?.isListening
                        const label = isRecording ? 'Listening…' : panel.title
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
                                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                                        : isRecording
                                            ? 'bg-red-500/10 text-red-500'
                                            : `${accentColorMap[panel.id] === 'teal' ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]' : ''}
                                               ${accentColorMap[panel.id] === 'indigo' ? 'bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)]' : ''}
                                               ${accentColorMap[panel.id] === 'emerald' ? 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]' : ''}
                                               ${accentColorMap[panel.id] === 'amber' ? 'bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]' : ''}
                                               ${accentColorMap[panel.id] === 'rose' ? 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]' : ''}`
                                    }
                                `}
                                title={isHidden ? `Show ${label}` : `Hide ${label}`}
                            >
                                {isRecording && (
                                    <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                                    </span>
                                )}
                                {Icon}
                                <span className="hidden sm:inline">{label}</span>
                            </button>
                        )
                    })}
                    <div className="w-px h-4 bg-[var(--border-default)] mx-0.5 hidden sm:block" />
                    <button
                        onClick={() => setEditLocked(v => !v)}
                        className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                            editLocked
                                ? 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                        }`}
                        title={editLocked ? 'Unlock to drag & resize panels' : 'Lock layout to prevent changes'}
                    >
                        {editLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{editLocked ? 'Locked' : 'Editing'}</span>
                    </button>
                    <button
                        onClick={resetLayout}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-all duration-200"
                        title="Reset layout to defaults"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Reset</span>
                    </button>
                </div>
            </div>
        </div>
    )
}