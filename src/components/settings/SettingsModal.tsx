import { useEffect, useState, useCallback } from 'react'
import { X, Settings, User, Monitor, Palette, Book, HardDrive, Keyboard, Check, Mic, Users, Upload, Zap, RefreshCw, Radio, RadioTower, Shield, Database, ChevronDown, Cast, Bold, Italic, Underline, ZoomIn, ZoomOut } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useTemplates } from '../../hooks/useTemplates'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput } from '../../hooks/useNdiOutput'
import { BibleVersionSettings } from './BibleVersionSettings'
import { SermonListenerSettings } from '../sermon-listener'
import { TeamManagementPanel } from '../team/TeamManagementPanel'
import { SongMigrationWizard } from '../admin/SongMigrationWizard'
import { BibleVersionUploader, VerseEmbeddingUploader, GlobalSermonListenerSettingsPanel } from '../admin'
import { useUserRole } from '../../hooks/useUserRole'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { useAnalytics } from '../../hooks'
import { AnalyticsEventType } from '../../services/analytics/types'

type SettingsTab = 'display' | 'live' | 'templates' | 'bible' | 'profile' | 'storage' | 'updates' | 'shortcuts' | 'sermon-listener' | 'team' | 'migration' | 'admin-bible' | 'admin-embeddings' | 'admin-sermon'

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
    initialTab?: SettingsTab
}

export function SettingsModal({ isOpen, onClose, initialTab = 'display' }: SettingsModalProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
    const { isAdmin, isSuperadmin, currentUser } = useUserRole()
    const { trackEvent } = useAnalytics()

    const settings = useAppStore((state) => state.settings)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const setSlideStyles = useAppStore((state) => state.setSlideStyles)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)
    const setDefaultFont = useAppStore((state) => state.setDefaultFont)
    const setAnimations = useAppStore((state) => state.setAnimations)
    const setFootnotes = useAppStore((state) => state.setFootnotes)
    const setLinesPerSlide = useAppStore((state) => state.setLinesPerSlide)
    const setTransitionInterval = useAppStore((state) => state.setTransitionInterval)
    const setVerseRefPosition = useAppStore((state) => state.setVerseRefPosition)
    const setVerseRefColor = useAppStore((state) => state.setVerseRefColor)
    const setVerseRefBold = useAppStore((state) => state.setVerseRefBold)
    const setVerseRefItalic = useAppStore((state) => state.setVerseRefItalic)
    const setVerseRefUnderline = useAppStore((state) => state.setVerseRefUnderline)
    const setVerseRefSizePercent = useAppStore((state) => state.setVerseRefSizePercent)

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab)
        }
    }, [initialTab])

    // Track settings opened
    useEffect(() => {
        if (isOpen) {
            trackEvent(AnalyticsEventType.SETTINGS_OPENED, { initial_tab: initialTab })
        }
    }, [isOpen, initialTab, trackEvent])

    // Track tab changes
    const handleTabChange = useCallback((tab: SettingsTab) => {
        setActiveTab(tab)
        trackEvent(AnalyticsEventType.SETTINGS_TAB_CHANGED, { tab })
    }, [trackEvent])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose()
            }
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }

        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onClose])

    if (!isOpen) return null

    const tabs = [
        { id: 'display' as const, label: 'Display', icon: Monitor },
        { id: 'live' as const, label: 'Live Session', icon: Cast },
        { id: 'templates' as const, label: 'Templates', icon: Palette },
        { id: 'bible' as const, label: 'Bible', icon: Book },
        { id: 'migration' as const, label: 'Import Songs', icon: Upload },
        { id: 'sermon-listener' as const, label: 'Sermon Listener', icon: Mic },
        ...(isAdmin && currentUser?.churchId ? [{ id: 'team' as const, label: 'Team', icon: Users }] : []),
        { id: 'profile' as const, label: 'Profile', icon: User },
        { id: 'storage' as const, label: 'Storage', icon: HardDrive },
        { id: 'updates' as const, label: 'Updates', icon: RefreshCw },
        { id: 'shortcuts' as const, label: 'Shortcuts', icon: Keyboard },
    ]

    const adminTabs = isSuperadmin
        ? [
            { id: 'admin-bible' as const, label: 'Bible Versions', icon: Book },
            { id: 'admin-embeddings' as const, label: 'Verse Embeddings', icon: Database },
            { id: 'admin-sermon' as const, label: 'Sermon Settings', icon: Mic },
        ]
        : []

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-4xl h-[600px] bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden flex">
                {/* Sidebar */}
                <div className="w-56 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
                        <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        <h2 className="font-semibold text-gray-900 dark:text-white">Settings</h2>
                    </div>
                    <nav className="p-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id
                                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        ))}

                        {adminTabs.length > 0 && (
                            <>
                                <div className="my-3 border-t border-gray-200 dark:border-gray-700" />
                                <div className="flex items-center gap-1.5 px-3 py-1.5 mb-1">
                                    <Shield className="w-3.5 h-3.5 text-amber-500" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Admin</span>
                                </div>
                                {adminTabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleTabChange(tab.id)}
                                        className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id
                                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                                            : 'text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-900/10'
                                            }`}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                    </button>
                                ))}
                            </>
                        )}
                    </nav>
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {activeTab.startsWith('admin-') ? 'Admin — ' : ''}{tabs.find((t) => t.id === activeTab)?.label || adminTabs.find((t) => t.id === activeTab)?.label || ''} Settings
                        </h3>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 p-6 overflow-y-auto">
                        {activeTab === 'display' && (
                            <DisplaySettings
                                settings={settings}
                                onUpdate={{
                                    setSlideStyles,
                                    setDefaultFont,
                                    setAnimations,
                                    setLinesPerSlide,
                                    setTransitionInterval,
                                }}
                            />
                        )}
                        {activeTab === 'live' && (
                            <LiveSessionSettings
                                settings={settings}
                                setAppSettings={setAppSettings}
                            />
                        )}
                        {activeTab === 'templates' && <TemplatesSettings />}
                        {activeTab === 'bible' && (
                            <BibleSettings
                                settings={settings}
                                onUpdate={{
                                    setDefaultBibleVersion,
                                    setFootnotes,
                                    setVerseRefPosition,
                                    setVerseRefColor,
                                    setVerseRefBold,
                                    setVerseRefItalic,
                                    setVerseRefUnderline,
                                    setVerseRefSizePercent,
                                }}
                            />
                        )}
                        {activeTab === 'migration' && <SongMigrationWizard onClose={onClose} />}
                        {activeTab === 'sermon-listener' && <SermonListenerSettings onClose={onClose} />}
                        {activeTab === 'team' && isAdmin && currentUser?.churchId && (
                            <TeamManagementPanel churchId={currentUser.churchId} isAdmin={isAdmin} />
                        )}
                        {activeTab === 'profile' && <ProfileSettings />}
                        {activeTab === 'storage' && <StorageSettings />}
                        {activeTab === 'updates' && <UpdatesSettings />}
                        {activeTab === 'shortcuts' && <ShortcutsSettings />}
                        {activeTab === 'admin-bible' && isSuperadmin && <BibleVersionUploader onClose={onClose} />}
                        {activeTab === 'admin-embeddings' && isSuperadmin && <VerseEmbeddingUploader onClose={onClose} />}
                        {activeTab === 'admin-sermon' && isSuperadmin && <GlobalSermonListenerSettingsPanel onClose={onClose} />}
                    </div>
                </div>
            </div>
        </div>
    )
}

// Display Settings Tab
function DisplaySettings({
    settings,
    onUpdate,
}: {
    settings: any
    onUpdate: {
        setSlideStyles: any
        setDefaultFont: any
        setAnimations: any
        setLinesPerSlide: any
        setTransitionInterval: any
    }
}) {
    const setLiveOutputMonitorId = useAppStore((state) => state.setLiveOutputMonitorId)
    const savedMonitorId = useAppStore((state) => state.settings.liveOutputMonitorId)
    const {
        monitors,
        isLoading: monitorsLoading,
        isDesktop,
        detectMonitors,
        identifyScreen,
    } = useNativeMultiMonitor()
    const {
        isAvailable: ndiAvailable,
        isRunning: ndiRunning,
        isLoading: ndiLoading,
        startOutput: ndiStart,
        stopOutput: ndiStop,
        state: ndiState,
    } = useNdiOutput()
    const [localMonitorId, setLocalMonitorId] = useState<string | null>(null)
    const [flashingId, setFlashingId] = useState<string | null>(null)

    const selectedMonitorId = localMonitorId ?? savedMonitorId

    const handleIdentify = useCallback(async (monitorId: string) => {
        if (flashingId) return
        setFlashingId(monitorId)
        try {
            await identifyScreen(monitorId)
            setTimeout(() => setFlashingId(null), 3500)
        } catch (error) {
            console.error('[SettingsModal] Failed to identify monitor:', error)
            setFlashingId(null)
        }
    }, [identifyScreen, flashingId])

    const fonts = [
        'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
        'Source Sans Pro', 'Poppins', 'Nunito', 'Raleway', 'Ubuntu',
    ]

    return (
        <div className="space-y-6">
            {/* Default Output Display */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Default Output Display
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Pre-select a display for quick presenting. Shows the Screen Picker only if not set.
                </p>
                {monitors.length > 0 ? (
                    <div className="space-y-1">
                        <button
                            onClick={() => { setLocalMonitorId(null); setLiveOutputMonitorId(null) }}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-all ${
                                !selectedMonitorId
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                        >
                            <div className="w-4 h-4 rounded-sm bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                <Monitor className="w-3 h-3 text-gray-500" />
                            </div>
                            <span className="flex-1 text-gray-700 dark:text-gray-300">Auto (ask each time)</span>
                            {!selectedMonitorId && <Check className="w-4 h-4 text-[var(--accent-teal)]" />}
                        </button>
                        {monitors.map((monitor) => {
                            const color = monitor.color || '#6B7280'
                            const isSelected = selectedMonitorId === monitor.id
                            const isFlashing = flashingId === monitor.id
                            return (
                                <div
                                    key={monitor.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        setLocalMonitorId(monitor.id)
                                        setLiveOutputMonitorId(monitor.id)
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            setLocalMonitorId(monitor.id)
                                            setLiveOutputMonitorId(monitor.id)
                                        }
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-all cursor-pointer ${
                                        isSelected
                                            ? ''
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                                    style={isSelected ? { borderColor: color, backgroundColor: color + '10' } : undefined}
                                >
                                    <div
                                        className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0"
                                        style={{ backgroundColor: color + '30', border: `1.5px solid ${color}` }}
                                    >
                                        <Monitor className="w-3 h-3" style={{ color }} />
                                    </div>
                                    <span className="flex-1 font-medium" style={isSelected ? { color } : undefined}>
                                        {monitor.name}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {monitor.width}×{monitor.height}
                                    </span>
                                    {monitor.is_primary && (
                                        <span className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded">
                                            Primary
                                        </span>
                                    )}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleIdentify(monitor.id) }}
                                        disabled={isFlashing}
                                        className="p-1.5 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                                        title={`Identify ${monitor.name}`}
                                    >
                                        <Zap className={`w-3.5 h-3.5 ${isFlashing ? 'animate-pulse' : ''}`} style={{ color }} />
                                    </button>
                                    {isSelected && <Check className="w-4 h-4" style={{ color: 'var(--accent-teal)' }} />}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="text-center py-3 text-gray-500">
                        <Monitor className="w-6 h-6 mx-auto mb-1 opacity-50" />
                        <p className="text-xs">
                            {isDesktop ? 'No displays detected' : 'Display detection requires desktop app'}
                        </p>
                        {isDesktop && (
                            <button
                                onClick={detectMonitors}
                                disabled={monitorsLoading}
                                className="mt-1 text-xs text-[var(--accent-teal)] hover:underline"
                            >
                                <RefreshCw className={`w-3 h-3 inline mr-1 ${monitorsLoading ? 'animate-spin' : ''}`} />
                                Detect displays
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Font Selection */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Default Font
                </label>
                <SettingsSelect
                    value={settings.defaultFont || 'Inter'}
                    onChange={(v) => onUpdate.setDefaultFont(v)}
                >
                    {fonts.map((font) => (
                        <option key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                        </option>
                    ))}
                </SettingsSelect>
            </div>

            {/* Lines Per Slide */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Lines Per Slide
                </label>
                <input
                    type="range"
                    min="2"
                    max="8"
                    value={settings.slideStyle?.linesPerSlide || 4}
                    onChange={(e) => onUpdate.setLinesPerSlide(parseInt(e.target.value))}
                    className="w-full accent-[var(--accent-teal)]"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>2</span>
                    <span>{settings.slideStyle?.linesPerSlide || 4} lines</span>
                    <span>8</span>
                </div>
            </div>

            {/* Transition Duration */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Transition Duration
                </label>
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.transitionInterval || 0.7}
                    onChange={(e) => onUpdate.setTransitionInterval(parseFloat(e.target.value))}
                    className="w-full accent-[var(--accent-teal)]"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>Instant</span>
                    <span>{settings.transitionInterval || 0.7}s</span>
                    <span>2s</span>
                </div>
            </div>

            {/* Animations Toggle */}
            <div className="flex items-center justify-between">
                <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Enable Animations
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Show transition animations between slides
                    </p>
                </div>
                <button
                    onClick={() => onUpdate.setAnimations(!settings.animations)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.animations ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                        style={{ transform: settings.animations ? 'translateX(28px)' : 'translateX(0)' }}
                    />
                </button>
            </div>

            {/* NDI Output */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <Radio className="w-4 h-4" />
                            NDI Output
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Stream live output over the network via NDI
                        </p>
                    </div>
                    {ndiAvailable && (
                        ndiRunning ? (
                            <button
                                onClick={ndiStop}
                                disabled={ndiLoading}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50"
                            >
                                <RadioTower className="w-3.5 h-3.5" />
                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                Stop
                            </button>
                        ) : (
                            <button
                                onClick={() => ndiStart()}
                                disabled={ndiLoading}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm border border-[var(--accent-teal)] text-[var(--accent-teal)] rounded-lg hover:bg-[var(--accent-teal)]/10 disabled:opacity-50"
                            >
                                <Radio className="w-3.5 h-3.5" />
                                Start NDI
                            </button>
                        )
                    )}
                </div>
                {!ndiAvailable && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-500 dark:text-gray-400">
                        {isDesktop ? (
                            <>
                                <p>NDI SDK not detected on this system.</p>
                                <p className="mt-1">Install <a href="https://ndi.video/type/developer/" target="_blank" rel="noreferrer" className="text-[var(--accent-teal)] hover:underline">NDI Tools</a> (includes the SDK runtime) and restart the app.</p>
                                {!(window as any).__TAURI_INTERNALS__ && (
                                    <p className="mt-1">Rebuild with <code className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">cargo build --features ndi</code> to enable NDI support.</p>
                                )}
                            </>
                        ) : (
                            <p>NDI output is only available in the desktop app.</p>
                        )}
                    </div>
                )}
                {ndiAvailable && ndiState && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        <div className="flex items-center justify-between">
                            <span>Status</span>
                            <span className={ndiRunning ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
                                {ndiRunning ? 'Streaming' : 'Idle'}
                            </span>
                        </div>
                        {ndiRunning && (
                            <div className="flex items-center justify-between">
                                <span>Source name</span>
                                <span className="font-mono">{ndiState.sourceName}</span>
                            </div>
                        )}
                        {ndiState.error && (
                            <div className="text-red-600 dark:text-red-400">
                                {ndiState.error}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// Live Session Settings Tab — settings that govern a live presentation
// (collaboration mode, live window behavior). Display/monitor/NDI stay in Display.
function LiveSessionSettings({
    settings,
    setAppSettings,
}: {
    settings: any
    setAppSettings: (s: any) => void
}) {
    type CollabMode = 'strict' | 'moderated' | 'open'
    const currentMode: CollabMode = settings.defaultCollaborationMode || 'moderated'

    const COLLAB_INFO: Record<CollabMode, { label: string; description: string }> = {
        strict: { label: 'Strict', description: 'Only the operator can advance slides or change the live output.' },
        moderated: { label: 'Review', description: 'Team members can suggest slides; operator approves each one.' },
        open: { label: 'Open', description: 'All team members can advance slides directly.' },
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Live Session
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Defaults that apply each time you start a collaborative presentation. You can override these per session.
                </p>
            </div>

            {/* Default Collaboration Mode */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Default Collaboration Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(Object.keys(COLLAB_INFO) as CollabMode[]).map((mode) => {
                        const info = COLLAB_INFO[mode]
                        const isSelected = currentMode === mode
                        return (
                            <button
                                key={mode}
                                onClick={() => setAppSettings({ ...settings, defaultCollaborationMode: mode })}
                                className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${
                                    isSelected
                                        ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/10 text-[var(--text-primary)]'
                                        : 'border-gray-200 dark:border-gray-700 text-[var(--text-secondary)] hover:border-[var(--accent-teal)]/40'
                                }`}
                            >
                                <div className="font-medium flex items-center gap-1.5">
                                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-teal)]" />}
                                    {info.label}
                                </div>
                                <div className="mt-0.5 text-[10px] text-[var(--text-muted)] leading-snug">
                                    {info.description}
                                </div>
                            </button>
                        )
                    })}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-2">
                    The TopBar shows your selection as soon as you start a session. Operators can change the mode mid-session by clicking the active mode pill.
                </p>
            </div>
        </div>
    )
}

function SettingsSelect({ value, onChange, children }: {
    value: string
    onChange: (value: string) => void
    children: React.ReactNode
}) {
    return (
        <div className="relative">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full pl-3 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent cursor-pointer"
            >
                {children}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
    )
}

// Templates Settings Tab
function TemplatesSettings() {
    const setDefaultTemplate = useAppStore((state) => state.setDefaultTemplate)
    const settings = useAppStore((state) => state.settings)
    const { templates, getTemplatesForSlideType } = useTemplates()

    const templateCategories: { key: 'scripture' | 'hymn' | 'song' | 'text' | 'sermon' | 'announcement' | 'prayer' | 'countdown'; label: string; slideType: string }[] = [
        { key: 'scripture', label: 'Scripture', slideType: 'bible' },
        { key: 'song', label: 'Songs', slideType: 'song' },
        { key: 'hymn', label: 'Hymns', slideType: 'hymn' },
        { key: 'sermon', label: 'Sermon', slideType: 'sermon' },
        { key: 'announcement', label: 'Announcements', slideType: 'announcement' },
        { key: 'prayer', label: 'Prayer', slideType: 'prayer' },
        { key: 'text', label: 'Text / General', slideType: 'text' },
        { key: 'countdown', label: 'Countdown', slideType: 'countdown' },
    ]

    const getTemplateName = (templateId: string | null | undefined) => {
        if (!templateId) return null
        return templates?.find(t => t._id === templateId)?.name || null
    }

    const getFilteredTemplates = (slideType: string) => {
        if (!templates) return []
        return getTemplatesForSlideType(slideType as any)
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Default Templates
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    Choose a template to use automatically when creating new slides for each category.
                </p>
            </div>

            <div className="space-y-3">
                {templateCategories.map(({ key, label, slideType }) => {
                    const selectedId = settings.defaultTemplates?.[key] || ''
                    const filteredTemplates = getFilteredTemplates(slideType)

                    return (
                        <div key={key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <div className="min-w-0 flex-1 mr-3">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {label}
                                </label>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {selectedId
                                        ? `Using: ${getTemplateName(selectedId)}`
                                        : 'Using default background'}
                                </p>
                            </div>
                            <div className="w-48 flex-shrink-0">
                                <SettingsSelect
                                    value={selectedId}
                                    onChange={(v) => setDefaultTemplate(key, v || null)}
                                >
                                    <option value="">Default</option>
                                    {filteredTemplates.length > 0 ? (
                                        filteredTemplates.map(template => (
                                            <option key={template._id} value={template._id}>
                                                {template.name}
                                            </option>
                                        ))
                                    ) : (
                                        templates?.map(template => (
                                            <option key={template._id} value={template._id}>
                                                {template.name}
                                            </option>
                                        ))
                                    )}
                                </SettingsSelect>
                            </div>
                        </div>
                    )
                })}
            </div>

            {templates && templates.length === 0 && (
                <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                    <Palette className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No templates yet.</p>
                    <p className="text-xs mt-1">Create templates from the slide panel to see them here.</p>
                </div>
            )}
        </div>
    )
}

// Bible Settings Tab
const REF_COLOR_PRESETS = [
    '#f59e0b', // amber
    '#0d9488', // teal
    '#3b82f6', // blue
    '#ef4444', // red
]

function BibleSettings({
    settings,
    onUpdate,
}: {
    settings: any
    onUpdate: {
        setDefaultBibleVersion: any
        setFootnotes: any
        setVerseRefPosition: (position: 'top' | 'bottom') => void
        setVerseRefColor: (color: string | undefined) => void
        setVerseRefBold: (bold: boolean) => void
        setVerseRefItalic: (italic: boolean) => void
        setVerseRefUnderline: (underline: boolean) => void
        setVerseRefSizePercent: (percent: number) => void
    }
}) {
    const currentRefPos: 'top' | 'bottom' = settings.slideStyles?.verseRefPosition ?? 'bottom'
    const refColor: string | undefined = settings.slideStyles?.verseRefColor
    const refBold: boolean = settings.slideStyles?.verseRefBold ?? false
    const refItalic: boolean = settings.slideStyles?.verseRefItalic ?? false
    const refUnderline: boolean = settings.slideStyles?.verseRefUnderline ?? false
    const refSizePercent: number = settings.slideStyles?.verseRefSizePercent ?? 100

    return (
        <div className="space-y-6">
            {/* Footnotes Toggle */}
            <div className="flex items-center justify-between">
                <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Show Footnotes
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Display footnote references in scripture
                    </p>
                </div>
                <button
                    onClick={() => onUpdate.setFootnotes(!settings.footnotes)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.footnotes ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                        style={{ transform: settings.footnotes ? 'translateX(28px)' : 'translateX(0)' }}
                    />
                </button>
            </div>

            {/* Verse reference position — applies to every bible slide unless explicitly overridden */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Verse Reference Position
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                    Default position of the verse reference (e.g. "John 11:32 · KJV") for all bible slides.
                    Individual slides can override this in the slide editor.
                </p>
                <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                    <button
                        onClick={() => onUpdate.setVerseRefPosition('top')}
                        className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
                            currentRefPos === 'top'
                                ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50'
                        }`}
                    >
                        Above the verse
                    </button>
                    <button
                        onClick={() => onUpdate.setVerseRefPosition('bottom')}
                        className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
                            currentRefPos === 'bottom'
                                ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50'
                        }`}
                    >
                        Below the verse
                    </button>
                </div>
            </div>

            {/* Verse reference style — color/weight/style/underline/size, applies to every
                bible slide unless explicitly overridden in the slide editor. */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Verse Reference Style
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                    Color, weight, and size of the verse reference caption for all bible slides.
                    Individual slides can override this in the slide editor.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Color */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => onUpdate.setVerseRefColor(undefined)}
                            title="Default"
                            className={`w-6 h-6 rounded-full bg-white/85 transition-all ${refColor === undefined ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ring-gray-400 scale-110' : 'hover:scale-105'
                                }`}
                        />
                        {REF_COLOR_PRESETS.map((color) => (
                            <button
                                key={color}
                                onClick={() => onUpdate.setVerseRefColor(color)}
                                title={color}
                                className={`w-6 h-6 rounded-full transition-all ${refColor === color ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900' : 'hover:scale-105'
                                    }`}
                                style={{ backgroundColor: color, ...(refColor === color ? { boxShadow: `0 0 0 2px ${color}` } : {}) }}
                            />
                        ))}
                        <input
                            type="color"
                            value={refColor && refColor.startsWith('#') ? refColor : '#ffffff'}
                            onChange={(e) => onUpdate.setVerseRefColor(e.target.value)}
                            title="Custom color"
                            className="w-6 h-6 rounded-full border-0 cursor-pointer"
                        />
                    </div>

                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                    {/* Bold / Italic / Underline */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onUpdate.setVerseRefBold(!refBold)}
                            title="Bold"
                            className={`p-1.5 rounded transition-colors ${refBold ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                        >
                            <Bold className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onUpdate.setVerseRefItalic(!refItalic)}
                            title="Italic"
                            className={`p-1.5 rounded transition-colors ${refItalic ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                        >
                            <Italic className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onUpdate.setVerseRefUnderline(!refUnderline)}
                            title="Underline"
                            className={`p-1.5 rounded transition-colors ${refUnderline ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                        >
                            <Underline className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

                    {/* Size */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onUpdate.setVerseRefSizePercent(Math.max(50, refSizePercent - 10))}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                            title="Smaller"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-mono text-gray-600 dark:text-gray-400 w-10 text-center">
                            {refSizePercent}%
                        </span>
                        <button
                            onClick={() => onUpdate.setVerseRefSizePercent(Math.min(200, refSizePercent + 10))}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                            title="Larger"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Bible Version Settings */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <BibleVersionSettings />
            </div>
        </div>
    )
}

// Profile Settings Tab
function ProfileSettings() {
    const { currentUser } = useUserRole()
    return (
        <div className="space-y-4">
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300">
                Profile settings (name, email, avatar, password) are managed through your Clerk account.
            </div>
            {currentUser && (
                <dl className="text-sm space-y-2">
                    <div className="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2">
                        <dt className="text-[var(--text-muted)]">Name</dt>
                        <dd className="font-medium">{currentUser.fullname || '—'}</dd>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 dark:border-gray-700 pb-2">
                        <dt className="text-[var(--text-muted)]">Email</dt>
                        <dd className="font-medium">{currentUser.email || '—'}</dd>
                    </div>
                    <div className="flex justify-between pb-1">
                        <dt className="text-[var(--text-muted)]">Role</dt>
                        <dd className="font-medium capitalize">{currentUser.role || '—'}</dd>
                    </div>
                </dl>
            )}
            <p className="text-xs text-[var(--text-muted)]">
                To change your name, email, or password, use the sign-out menu in the top bar and visit your Clerk account settings.
            </p>
        </div>
    )
}

// Storage Settings Tab
function StorageSettings() {
    const [storageUsed, setStorageUsed] = useState(0)

    useEffect(() => {
        // Calculate localStorage usage
        let total = 0
        for (const key in localStorage) {
            if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
                total += localStorage[key].length * 2 // UTF-16 = 2 bytes per char
            }
        }
        setStorageUsed(total)
    }, [])

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    }

    const clearCache = () => {
        if (confirm('Are you sure you want to clear local cache? This will not delete your saved slides.')) {
            // Clear specific cache keys while preserving important data
            const preserveKeys = ['selah_library_slides', 'app-storage']
            for (const key in localStorage) {
                if (!preserveKeys.includes(key)) {
                    localStorage.removeItem(key)
                }
            }
            window.location.reload()
        }
    }

    return (
        <div className="space-y-6">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Local Storage Used</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatBytes(storageUsed)}
                    </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-[var(--accent-teal)] rounded-full transition-all shadow-sm"
                        style={{ width: `${Math.min((storageUsed / (5 * 1024 * 1024)) * 100, 100)}%` }}
                    />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    ~5 MB typical browser limit
                </p>
            </div>

            <button
                onClick={clearCache}
                className="w-full px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
            >
                Clear Cache
            </button>
        </div>
    )
}

// Shortcuts Settings Tab
function ShortcutsSettings() {
    const shortcuts = [
        { keys: ['⌘', '/'], description: 'Focus quick actions search' },
        { keys: ['⌘', 'Z'], description: 'Undo last action' },
        { keys: ['⌘', 'Y'], description: 'Redo last action' },
        { keys: ['⌘', 'P'], description: 'Promote slide to live' },
        { keys: ['⌘', ','], description: 'Open settings' },
        { keys: ['⌘', 'H'], description: 'Show keyboard shortcuts' },
        { keys: ['↑', '↓'], description: 'Navigate slides' },
        { keys: ['Space'], description: 'Toggle live slide' },
        { keys: ['Esc'], description: 'Close modals / Clear live' },
    ]

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Keyboard shortcuts for faster navigation.
            </p>

            {shortcuts.map((shortcut, index) => (
                <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        {shortcut.description}
                    </span>
                    <div className="flex gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                            <kbd
                                key={keyIndex}
                                className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
                            >
                                {key}
                            </kbd>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

// Updates panel — desktop app only.  Tells the user what version they're
// running, lets them check on demand, and surfaces any update errors.
function UpdatesSettings() {
    const { state, message, runCheck } = useAppUpdater()
    const appVersion =
        (typeof window !== 'undefined' && (window as any).__TAURI__?.metadata?.version) ||
        (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.metadata?.version) ||
        '0.1.0'

    const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

    if (!isDesktop) {
        return (
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                Auto-updates are only available in the desktop app.
            </div>
        )
    }

    const buttonLabel =
        state === 'checking' ? 'Checking\u2026'
        : state === 'downloading' ? 'Downloading\u2026'
        : state === 'restarting' ? 'Restarting\u2026'
        : 'Check for updates'

    const isBusy = state === 'checking' || state === 'downloading' || state === 'restarting'

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">App Updates</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Selah checks for new versions automatically on launch. You can also trigger a manual check below.
                </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">Current version</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">v{appVersion}</div>
                </div>
                <button
                    onClick={runCheck}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[var(--accent-teal)] text-[var(--accent-teal)] rounded-lg hover:bg-[var(--accent-teal)]/10 disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${state === 'checking' ? 'animate-spin' : ''}`} />
                    {buttonLabel}
                </button>
            </div>

            {state === 'up_to_date' && message && (
                <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-200">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{message}</span>
                </div>
            )}

            {state === 'restarting' && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                    <span>Update downloaded. Restarting Selah\u2026</span>
                </div>
            )}

            {state === 'error' && message && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-200">
                    <span>{message}</span>
                </div>
            )}
        </div>
    )
}

