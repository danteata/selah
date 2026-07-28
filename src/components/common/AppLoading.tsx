/**
 * The in-app counterpart to the boot splash in index.html.
 *
 * Startup used to show a bare 32px spinner on a near-white panel — twice, from
 * two different fallbacks — which read as a stalled page rather than an app
 * opening. This is the same wordmark and sweep as the splash, so a route
 * transition or an auth check looks continuous with launch instead of like a
 * different screen.
 *
 * Deliberately not the splash markup itself: that lives in the HTML shell so it
 * can paint before any CSS exists, and it must stay dependency-free.
 */
interface AppLoadingProps {
    /** Shown under the wordmark, e.g. "Signing you in". Keep it short. */
    label?: string
}

export function AppLoading({ label }: AppLoadingProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[var(--bg-primary)]"
        >
            <div className="relative">
                <span
                    aria-hidden
                    className="absolute -left-0.5 -top-0.5 w-1.5 h-1.5 rounded-full bg-[var(--accent-teal)] animate-pulse-soft"
                />
                <span
                    className="text-3xl font-semibold tracking-tight leading-none text-[var(--text-primary)]"
                    style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}
                >
                    Selah
                </span>
            </div>

            {/* A sweep, not a percentage: none of the startup steps report progress. */}
            <div className="relative h-0.5 w-32 overflow-hidden rounded-full bg-[var(--border-default)]">
                <div className="app-loading-sweep absolute inset-0 rounded-full" />
            </div>

            {label && (
                <p className="text-xs text-[var(--text-muted)]">{label}</p>
            )}
        </div>
    )
}
