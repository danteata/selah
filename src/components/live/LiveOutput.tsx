import { Rows3, Columns2, Maximize2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { PanelErrorBoundary } from '../offline/PanelErrorBoundary'
import { ContextSectionContent } from '../layout/ContextPanel'
import { useOnAir } from './useOnAir'
import { useLiveShortcuts } from './useLiveShortcuts'
import { LiveHeader } from './LiveHeader'
import { LiveMonitor } from './LiveMonitor'
import { OnAirControls } from './OnAirControls'
import { LiveVerseNavigator } from './LiveVerseNavigator'
import { SuggestedQueue } from './SuggestedQueue'
import { OutputThumbnail } from './OutputThumbnail'

const LAYOUT_OPTIONS = [
    { id: 'stacked' as const, label: 'Stacked', Icon: Rows3 },
    { id: 'split' as const, label: 'Split', Icon: Columns2 },
    { id: 'focus' as const, label: 'Focus', Icon: Maximize2 },
]

/**
 * The classic workspace's centre: everything about what's on air in one
 * panel, arranged by one of three layout modes. The docked desk uses
 * LivePanel and PreviewPanel instead; this stays for the "Use classic
 * workspace" fallback and goes with it (plan/docked-desk-layout.md, slice 6).
 */
export function LiveOutput() {
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const lastContentSection = useAppStore((s) => s.lastContentSection)
    // Hide the sermon listener here when the ContextPanel sidebar already shows it.
    const sermonShownInSidebar = activeNavSection === 'sermon' && contextPanelOpen

    // How the centre is arranged:
    //  • 'stacked' — Next Up + on-air controls + Sermon aside beside the feed
    //  • 'split'   — Next Up | feed on top, verses and sermon below
    //  • 'focus'   — the feed maximized, side controls slimmed, context hidden
    const layoutMode = useAppStore((s) => s.liveOutputLayout)
    const setLayoutMode = useAppStore((s) => s.setLiveOutputLayout)

    const onAir = useOnAir()
    useLiveShortcuts(onAir)

    const sermonBox = !sermonShownInSidebar ? (
        <div className="studio-output-sermon min-h-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70 p-2 overflow-hidden">
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Sermon Listener
                </span>
            </div>
            <div className="h-[calc(100%-1.25rem)] min-h-0 overflow-y-auto custom-scrollbar pr-1">
                {/* Silent: this renders on the output the congregation sees, so
                    a failure here should vanish, not become a notice on screen.
                    Without the boundary it takes the whole /live route down. */}
                <PanelErrorBoundary name="sermon-listener-live" silent>
                    <SermonListenerPanel compact />
                </PanelErrorBoundary>
            </div>
        </div>
    ) : null

    const layoutPicker = (
        <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-tertiary)]/60 border border-[var(--border-subtle)] flex-shrink-0">
            {LAYOUT_OPTIONS.map(({ id, label, Icon }) => (
                <button
                    key={id}
                    onClick={() => setLayoutMode(id)}
                    className={`p-1.5 rounded-md transition-colors ${
                        layoutMode === id
                            ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                    title={`${label} layout`}
                    aria-pressed={layoutMode === id}
                >
                    <Icon className="w-3.5 h-3.5" />
                </button>
            ))}
        </div>
    )

    // Split-layout context — both surfaces visible at once, no tabs. The verse
    // navigator sits as a short strip directly under the top row (only when
    // scripture is on air); the Sermon Listener fills the rest.
    const splitContext = (
        <div className="studio-output-context flex-1 min-h-0 flex flex-col gap-3">
            <LiveVerseNavigator
                liveSlide={onAir.liveSlide}
                className="flex-shrink-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 overflow-hidden"
            />
            {sermonShownInSidebar ? (
                // The sermon listener has taken the sidebar — show whatever it
                // displaced there (Bible, Songs, Media, …) in this freed slot, so
                // both stay visible at once.
                lastContentSection && lastContentSection !== 'sermon' ? (
                    <div className="flex-1 min-h-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 overflow-hidden">
                        <ContextSectionContent section={lastContentSection} />
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-center text-[11px] text-[var(--text-muted)] italic px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40">
                        Sermon Listener is open in the sidebar.
                    </div>
                )
            ) : (
                sermonBox
            )}
        </div>
    )

    return (
        <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            <LiveHeader title="Program Output" isOnAir={!!onAir.liveSlide}>
                {layoutPicker}
            </LiveHeader>

            {/* This wrapper (not the panel root) is the query container. */}
            <div className="studio-liveoutput flex-1 min-h-0 flex flex-col p-3 lg:p-3.5 gap-2.5" data-layout={layoutMode}>
                <div className="studio-output-main flex-1 min-h-0 flex gap-4 lg:gap-5">
                    {/* Left: Next Up + on-air controls + Sermon Listener.
                        Width/direction come from a container query (see
                        .studio-output-sidecar in index.css) so a narrow panel
                        stacks these above the feed instead of clipping. */}
                    <aside className="studio-output-sidecar flex-shrink-0 flex gap-3 order-1">
                        <div className="studio-output-nextup flex flex-col min-w-0">
                            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.18em] mb-2">Next Up</div>
                            <OutputThumbnail slide={onAir.nextUp} emptyText="End of Schedule" />
                        </div>
                        <OnAirControls onAir={onAir} />
                        {/* The sermon sits in the aside only in 'stacked'; 'split'
                            moves it below, 'focus' hides it (the sidebar has it). */}
                        {layoutMode === 'stacked' && sermonBox}
                    </aside>

                    {/* Right: the feed, its transport, and the verse navigator */}
                    <div className="flex-1 min-w-0 flex flex-col gap-3 order-2">
                        <LiveMonitor liveSlide={onAir.liveSlide} />
                        {/* Under the feed in 'stacked'; below the top row in
                            'split'; mounted but hidden in 'focus', so its keys
                            still step the passage. */}
                        {layoutMode === 'stacked' && <LiveVerseNavigator liveSlide={onAir.liveSlide} />}
                        {layoutMode === 'focus' && <LiveVerseNavigator liveSlide={onAir.liveSlide} className="hidden" />}
                    </div>
                </div>

                {layoutMode === 'split' && splitContext}

                <SuggestedQueue />
            </div>
        </div>
    )
}
