import { useEffect, useState, useCallback } from 'react'
import { X, Settings, User, Monitor, Palette, Book, HardDrive, Keyboard, Sun, Moon, Check, Mic, Users, Upload, Zap, RefreshCw, Radio, RadioTower, Shield, Database } from 'lucide-react'
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

type SettingsTab = 'display' | 'background' | 'bible' | 'profile' | 'storage' | 'shortcuts' | 'sermon-listener' | 'team' | 'migration' | 'admin-bible' | 'admin-embeddings' | 'admin-sermon'

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
    initialTab?: SettingsTab
}

export function SettingsModal({ isOpen, onClose, initialTab = 'display' }: SettingsModalProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
    const { isAdmin, isSuperadmin, currentUser } = useUserRole()

    const settings = useAppStore((state) => state.settings)
    const setSlideStyles = useAppStore((state) => state.setSlideStyles)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)
    const setDefaultFont = useAppStore((state) => state.setDefaultFont)
    const setAnimations = useAppStore((state) => state.setAnimations)
    const setFootnotes = useAppStore((state) => state.setFootnotes)
    const setLinesPerSlide = useAppStore((state) => state.setLinesPerSlide)
    const setTransitionInterval = useAppStore((state) => state.setTransitionInterval)

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab)
        }
    }, [initialTab])

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
        { id: 'background' as const, label: 'Background', icon: Palette },
        { id: 'bible' as const, label: 'Bible', icon: Book },
        { id: 'migration' as const, label: 'Import Songs', icon: Upload },
        { id: 'sermon-listener' as const, label: 'Sermon Listener', icon: Mic },
        ...(isAdmin && currentUser?.churchId ? [{ id: 'team' as const, label: 'Team', icon: Users }] : []),
        { id: 'profile' as const, label: 'Profile', icon: User },
        { id: 'storage' as const, label: 'Storage', icon: HardDrive },
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
                                onClick={() => setActiveTab(tab.id)}
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
                                        onClick={() => setActiveTab(tab.id)}
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
                        {activeTab === 'background' && <BackgroundSettings />}
                        {activeTab === 'bible' && (
                            <BibleSettings
                                settings={settings}
                                onUpdate={{ setDefaultBibleVersion, setFootnotes }}
                            />
                        )}
                        {activeTab === 'migration' && <SongMigrationWizard onClose={onClose} />}
                        {activeTab === 'sermon-listener' && <SermonListenerSettings onClose={onClose} />}
                        {activeTab === 'team' && isAdmin && currentUser?.churchId && (
                            <TeamManagementPanel churchId={currentUser.churchId} isAdmin={isAdmin} />
                        )}
                        {activeTab === 'profile' && <ProfileSettings />}
                        {activeTab === 'storage' && <StorageSettings />}
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
        flashMonitor,
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

    const handleIdentify = useCallback(async (monitorId: string, color: string) => {
        if (flashingId) return
        setFlashingId(monitorId)
        await flashMonitor(color)
        const channel = new BroadcastChannel('selah-monitor-flash')
        channel.postMessage({ monitorId, color })
        channel.close()
        setTimeout(() => setFlashingId(null), 2500)
    }, [flashMonitor, flashingId])

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
                    Pre-select a display for quick Go Live. Shows the Screen Picker only if not set.
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
                                        onClick={(e) => { e.stopPropagation(); handleIdentify(monitor.id, color) }}
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
                <select
                    value={settings.defaultFont || 'Inter'}
                    onChange={(e) => onUpdate.setDefaultFont(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]"
                >
                    {fonts.map((font) => (
                        <option key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                        </option>
                    ))}
                </select>
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
                    className={`relative w-12 h-6 rounded-full transition-all ${settings.animations ? 'bg-[var(--accent-teal)] shadow-sm' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.animations ? 'translate-x-7' : 'translate-x-1'
                            }`}
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
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
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
                                <p className="mt-1">Install <a href="https://ndi.video/type/developer/" target="_blank" rel="noreferrer" className="text-purple-600 hover:underline">NDI Tools</a> (includes the SDK runtime) and restart the app.</p>
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

// Background Settings Tab
function BackgroundSettings() {
    const setDefaultSlideBackground = useAppStore((state) => state.setDefaultSlideBackground)
    const setDefaultTemplate = useAppStore((state) => state.setDefaultTemplate)
    const settings = useAppStore((state) => state.settings)
    const { templates } = useTemplates()

    const backgroundTypes = [
        { id: 'scripture', label: 'Scripture', color: 'from-[var(--accent-teal)] to-[var(--accent-teal)]/80' },
        { id: 'song', label: 'Song', color: 'from-[var(--accent-teal)] to-[var(--accent-teal)]/80' },
        { id: 'hymn', label: 'Hymn', color: 'from-[var(--accent-teal)] to-[var(--accent-teal)]/80' },
        { id: 'custom', label: 'Custom', color: 'from-gray-600 to-gray-800' },
    ]

    // Get template name by ID
    const getTemplateName = (templateId: string | null | undefined) => {
        if (!templateId) return null
        return templates?.find(t => t._id === templateId)?.name || null
    }

    return (
        <div className="space-y-6">
            {/* Default Templates Section */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Default Templates
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    Choose a template to use automatically when creating new slides.
                </p>

                <div className="space-y-3">
                    {/* Scripture Template Selector */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Scripture Template
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {settings.defaultTemplates?.scripture
                                    ? `Using: ${getTemplateName(settings.defaultTemplates.scripture)}`
                                    : 'Using default background'}
                            </p>
                        </div>
                        <select
                            value={settings.defaultTemplates?.scripture || ''}
                            onChange={(e) => setDefaultTemplate('scripture', e.target.value || null)}
                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value="">Use Default Background</option>
                            {templates?.map(template => (
                                <option key={template._id} value={template._id}>
                                    {template.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Hymn Template Selector */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Hymn Template
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {settings.defaultTemplates?.hymn
                                    ? `Using: ${getTemplateName(settings.defaultTemplates.hymn)}`
                                    : 'Using default background'}
                            </p>
                        </div>
                        <select
                            value={settings.defaultTemplates?.hymn || ''}
                            onChange={(e) => setDefaultTemplate('hymn', e.target.value || null)}
                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value="">Use Default Background</option>
                            {templates?.map(template => (
                                <option key={template._id} value={template._id}>
                                    {template.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Song Template Selector */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Song Template
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {settings.defaultTemplates?.song
                                    ? `Using: ${getTemplateName(settings.defaultTemplates.song)}`
                                    : 'Using default background'}
                            </p>
                        </div>
                        <select
                            value={settings.defaultTemplates?.song || ''}
                            onChange={(e) => setDefaultTemplate('song', e.target.value || null)}
                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value="">Use Default Background</option>
                            {templates?.map(template => (
                                <option key={template._id} value={template._id}>
                                    {template.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
                    Default Backgrounds
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Set default backgrounds for different slide types.
                </p>

                <div className="grid grid-cols-2 gap-4">
                    {backgroundTypes.map((type) => (
                        <div
                            key={type.id}
                            className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                        >
                            <div className={`h-24 bg-gradient-to-br ${type.color}`} />
                            <div className="p-3 bg-white dark:bg-gray-800">
                                <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                                    {type.label}
                                </h4>
                                <button className="mt-2 text-xs text-[var(--accent-teal)] hover:underline">
                                    Change Background
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

// Bible Settings Tab
function BibleSettings({
    settings,
    onUpdate,
}: {
    settings: any
    onUpdate: {
        setDefaultBibleVersion: any
        setFootnotes: any
    }
}) {
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
                    className={`relative w-12 h-6 rounded-full transition-all ${settings.footnotes ? 'bg-[var(--accent-teal)] shadow-sm' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.footnotes ? 'translate-x-7' : 'translate-x-1'
                            }`}
                    />
                </button>
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
    return (
        <div className="space-y-6">
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                Profile settings are managed through your Clerk account.
                <br />
                <a href="#" className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
                    Manage Profile
                </a>
            </div>
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
