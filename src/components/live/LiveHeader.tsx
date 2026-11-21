import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Radio, Presentation, Crown, Shield, Eye, EyeOff, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput, NDI_LIVE_WINDOW_MISSING } from '../../hooks/useNdiOutput'
import { useAlternateOutput } from '../../hooks/useAlternateOutput'
import { useEntitlements } from '../../providers/LicenseProvider'
import { proGateMessage } from '../../providers/entitlementState'
import type { PushStats } from '../../services/ndi-output/pushChannel'
import { Modal } from '../modals/Modal'
import { ScreenPicker } from './ScreenPicker'

interface LiveHeaderProps {
    title: string
    /** Something is on air: the title's dot glows. */
    isOnAir: boolean
    /** Extra controls placed before the output buttons. */
    children?: ReactNode
}

/**
 * The header of the panel that shows what's on air: what the outputs are
 * doing (cleared, NDI, alternate, session role), and the buttons that drive
 * them: NDI, the alternate output, clear to black, and present/stop.
 */
export function LiveHeader({ title, isOnAir, children }: LiveHeaderProps) {
    const [showScreenPicker, setShowScreenPicker] = useState(false)

    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const liveOutputBlanked = useAppStore((state) => state.liveOutputBlanked)
    const setLiveOutputBlanked = useAppStore((state) => state.setLiveOutputBlanked)
    const liveOutputMonitorId = useAppStore((state) => state.settings.liveOutputMonitorId)

    const { isOperator, isContributor, isViewer, isConnected, toggleBlank } = useLiveSession()
    const { isPresenting, isDesktop, detectMonitors, openLiveWindow, closeLiveWindow } = useNativeMultiMonitor()
    const {
        isAvailable: ndiAvailable,
        isRunning: ndiRunning,
        startOutput: ndiStart,
        stopOutput: ndiStop,
        state: ndiState,
    } = useNdiOutput()
    const ndiSending = (ndiState?.framesSent ?? 0) > 0
    const alternate = useAlternateOutput()
    const { isPro, isUnverified, startProCheckout, refresh: refreshEntitlements } = useEntitlements()

    const roleLabel = useMemo(() => {
        if (isOperator) return 'Operator'
        if (isContributor) return 'Contributor'
        if (isViewer) return 'Viewer'
        return ''
    }, [isOperator, isContributor, isViewer])

    /**
     * Shown instead of the Pro upsell when the licence simply couldn't be checked
     * — the case where the same account works on one machine and not another,
     * because that one has a cached licence and this one never fetched it.
     */
    const showProGate = useCallback((feature: string) => {
        const { title: gateTitle, description, retryable } = proGateMessage(
            isUnverified ? 'unverified' : 'verified',
            feature,
        )
        if (retryable) {
            toast.warning(gateTitle, {
                description,
                duration: 14000,
                action: { label: 'Try again', onClick: () => void refreshEntitlements() },
            })
            return
        }
        toast.warning(gateTitle, {
            description,
            duration: 10000,
            action: { label: 'Upgrade', onClick: () => void startProCheckout() },
        })
    }, [isUnverified, refreshEntitlements, startProCheckout])

    // Independent of the program output's NDI feed: this one carries the graphics
    // channel's own slide, with alpha, as a second source.
    const handleAlternateToggle = useCallback(() => {
        if (alternate.config.enabled) {
            void alternate.disable()
            return
        }
        if (!isPro) {
            showProGate('The alternate output')
            return
        }
        void alternate.enable().then((error: string | null) => {
            if (!error) {
                toast.success('Alternate output on', {
                    description: `Take "${alternate.config.sourceName}" in your switcher.`,
                })
                return
            }
            toast.error('Alternate output could not start', { description: error, duration: 12000 })
        })
    }, [alternate, isPro, showProGate])

    // Blank the live output to a plain black screen without touching
    // liveSlideId, so the queue position/selected slide is preserved and
    // un-blanking simply resumes showing it. Reaches the actual output
    // window via useLiveSync (native IPC + localStorage/BroadcastChannel),
    // and — when in a collaboration session — via the shared `isBlank` flag
    // so other connected viewers see the same thing (toggleBlank no-ops on
    // its own if not applicable).
    const handleToggleBlank = useCallback(() => {
        const next = !liveOutputBlanked
        setLiveOutputBlanked(next)
        void toggleBlank(next)
    }, [liveOutputBlanked, setLiveOutputBlanked, toggleBlank])

    // Open the output on the saved display, or ask which one.
    const handleOpenLive = useCallback(async () => {
        const showPicker = async () => {
            await detectMonitors()
            setShowScreenPicker(true)
        }

        if (!liveOutputMonitorId) {
            await showPicker()
            return
        }

        // The saved display may have been unplugged or renumbered since, and a
        // web popup can be blocked. Both used to fail silently — PRESENT did
        // nothing and the picker never appeared. Fall back to the picker.
        let opened = false
        try {
            opened = await openLiveWindow({
                monitor_id: liveOutputMonitorId,
                fullscreen: true,
                ...(isDesktop ? { decorations: false, always_on_top: true } : {}),
                initial_slide_id: liveSlideId || undefined,
            })
        } catch (err) {
            console.error('[Live] Failed to open the output on the saved display:', err)
        }
        if (!opened) {
            toast.error(
                isDesktop
                    ? "Couldn't open the output on the saved display. Pick a screen."
                    : "Couldn't open the output window — allow pop-ups for this site, or pick a screen."
            )
            await showPicker()
        }
    }, [liveOutputMonitorId, isDesktop, openLiveWindow, detectMonitors, liveSlideId])

    // NDI network streaming is Pro-only; free users get an upsell.
    const handleNdiToggle = useCallback(() => {
        if (ndiRunning) {
            void ndiStop()
            return
        }
        if (!isPro) {
            showProGate('NDI output')
            return
        }
        // The backend refuses for reasons the operator can act on — no Screen
        // Recording permission, no live output window open, no capture support on
        // this platform. Surface them rather than dropping the refusal.
        void ndiStart().then((refusal) => {
            if (!refusal) return
            toast.error('NDI output could not start', {
                description: refusal.message,
                duration: 12000,
                // Nobody should have to know that NDI mirrors the live output
                // window, or that the order matters — offer the missing step.
                action: refusal.code === NDI_LIVE_WINDOW_MISSING
                    ? { label: 'Open live output', onClick: () => void handleOpenLive() }
                    : undefined,
            })
        })
    }, [ndiRunning, isPro, showProGate, ndiStart, ndiStop, handleOpenLive])

    const handleScreenSelect = useCallback(async (screenId: string) => {
        await openLiveWindow({
            monitor_id: screenId,
            fullscreen: true,
            ...(isDesktop ? { decorations: false, always_on_top: true } : {}),
            initial_slide_id: liveSlideId || undefined,
        })
        setShowScreenPicker(false)
    }, [isDesktop, openLiveWindow, liveSlideId])

    return (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/35">
            <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 w-2 h-2 rounded-full ${isOnAir ? 'bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.55)]' : 'bg-[var(--text-muted)]/60'}`} />
                    <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate" title={title}>
                        {title}
                    </h2>
                </div>
                {liveOutputBlanked && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20">
                        <EyeOff className="w-2.5 h-2.5" />
                        OUTPUT CLEARED
                    </span>
                )}
                {isConnected && roleLabel && (
                    <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${isOperator
                        ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                        : isContributor
                            ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                            : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                        }`}>
                        {isOperator && <Crown className="w-2.5 h-2.5" />}
                        {isContributor && <Shield className="w-2.5 h-2.5" />}
                        {roleLabel}
                    </span>
                )}
                {ndiRunning && (
                    /* "Active" used to mean nothing more than "the sender was
                       created", which is how a black feed still read as ACTIVE.
                       It now follows the frames the sender has really pushed. */
                    ndiSending ? (
                        <span
                            title={`Sending ${ndiState?.framesSent?.toLocaleString() ?? 0} frames`}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] rounded-full border border-[var(--accent-teal)]/20"
                        >
                            NDI ACTIVE
                        </span>
                    ) : (
                        <span
                            title="The NDI source is announced but no frames have been captured yet — receivers will show black."
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20"
                        >
                            NDI — NO FRAMES
                        </span>
                    )
                )}
                {alternate.config.enabled && (
                    <span
                        title={`${alternate.textOnly
                            ? "Alternate output: text only — this slide's background isn't drawn on this feed"
                            : alternate.slide
                                ? 'Alternate output'
                                : 'Alternate output is on with nothing on it'}${alternate.config.destination.kind === 'ndi'
                            ? ` (${alternateHealth(alternate.stats)})`
                            : ''}`}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border ${
                            alternate.framesSent > 0
                                ? 'bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)] border-[var(--accent-indigo)]/20'
                                : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                        }`}
                    >
                        {alternate.slide ? (alternate.textOnly ? 'ALT — TEXT ONLY' : 'ALT LIVE') : 'ALT EMPTY'}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                {children}
                {ndiAvailable && (
                    <button
                        onClick={handleNdiToggle}
                        className={`p-1.5 rounded-lg transition-colors ${ndiRunning ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                        title={isPro ? 'NDI Output' : 'NDI Output (Pro)'}
                    >
                        <Radio className="w-4 h-4" />
                    </button>
                )}
                {ndiAvailable && (
                    <button
                        onClick={handleAlternateToggle}
                        className={`p-1.5 rounded-lg transition-colors ${alternate.config.enabled ? 'text-[var(--accent-indigo)] bg-[var(--accent-indigo)]/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                        title={isPro
                            ? 'Alternate output — a second output on a monitor or over NDI'
                            : 'Alternate output (Pro)'}
                    >
                        <Layers className="w-4 h-4" />
                    </button>
                )}
                <button
                    onClick={handleToggleBlank}
                    className={`flex items-center gap-1.5 p-1.5 rounded-lg transition-colors ${liveOutputBlanked
                        ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                    title={liveOutputBlanked ? 'Resume output (B)' : 'Clear output to black (B)'}
                >
                    {liveOutputBlanked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                {isPresenting ? (
                    <button
                        onClick={() => void closeLiveWindow()}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-red-500/20 whitespace-nowrap flex-shrink-0"
                    >
                        STOP
                    </button>
                ) : (
                    <button
                        onClick={handleOpenLive}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-teal)] hover:brightness-110 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-[var(--accent-teal)]/20 whitespace-nowrap flex-shrink-0"
                    >
                        <Presentation className="w-4 h-4 shrink-0" />
                        PRESENT
                    </button>
                )}
            </div>

            {/* Portalled: a panel's CSS containment (container queries) would
                otherwise trap this fixed overlay inside the panel. ScreenPicker
                draws its own panel and has no key handling, so Escape here is
                Modal's alone. */}
            {showScreenPicker && createPortal(
                <Modal
                    isOpen={showScreenPicker}
                    onClose={() => setShowScreenPicker(false)}
                    closeOnBackdrop={false}
                    ariaLabel="Select display"
                    overlayClassName="bg-black/80 backdrop-blur-sm"
                    zIndexClassName="z-[100]"
                    className="max-w-full"
                >
                    <ScreenPicker
                        onSelect={handleScreenSelect}
                        onClose={() => setShowScreenPicker(false)}
                    />
                </Modal>,
                document.body,
            )}
        </div>
    )
}

/** "1,234 frames at 30 fps, 2 dropped, 1 late" — the alternate NDI feed's health, for its badge. */
function alternateHealth(stats: PushStats): string {
    const parts = [`${stats.sent.toLocaleString()} frames sent${stats.fps ? ` at ${stats.fps} fps` : ''}`]
    if (stats.replacedUnsent) parts.push(`${stats.replacedUnsent.toLocaleString()} dropped`)
    if (stats.lateTicks) parts.push(`${stats.lateTicks.toLocaleString()} late`)
    return parts.join(', ')
}
