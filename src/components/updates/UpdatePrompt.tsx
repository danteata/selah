import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpCircle, X, Loader2, AlertTriangle } from 'lucide-react'
import { useAppUpdater } from '../../hooks/useAppUpdater'

/**
 * UpdatePrompt — the pill in the top bar that says an update is waiting.
 *
 * Updates were previously only discoverable by opening Settings and pressing
 * "Check for updates", so operators ran old builds indefinitely. This sits in
 * the always-visible chrome instead.
 *
 * It deliberately does not install on its own. Selah is often mid-service, and
 * installing means closing the app; that has to be the operator's choice, taken
 * knowingly. Clicking the pill explains what will happen first.
 */
export function UpdatePrompt() {
    const { state, message, available, dismissed, install, dismiss } = useAppUpdater()
    const [expanded, setExpanded] = useState(false)

    const installing = state === 'installing'
    const failed = state === 'error' && expanded

    // Nothing to offer, or the operator already waved this version away. An
    // install in flight keeps the pill on screen so the spinner has a home.
    if (!available || (dismissed && !installing && !expanded)) return null

    return (
        <>
            <button
                onClick={() => setExpanded(true)}
                disabled={installing}
                title={`Selah ${available.version} is available`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold
                           bg-[var(--accent-teal)]/12 text-[var(--accent-teal)]
                           border border-[var(--accent-teal)]/30
                           hover:bg-[var(--accent-teal)]/20 transition-colors disabled:opacity-60"
            >
                {installing
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <ArrowUpCircle className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">
                    {installing ? 'Updating…' : `Update to ${available.version}`}
                </span>
                <span className="sm:hidden">{installing ? '…' : 'Update'}</span>
            </button>

            <AnimatePresence>
                {expanded && (
                    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => !installing && setExpanded(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 8 }}
                            role="dialog"
                            aria-label="Update Selah"
                            className="relative w-full max-w-md rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] shadow-2xl overflow-hidden"
                        >
                            <div className="flex items-start gap-3 p-4 border-b border-[var(--border-subtle)]">
                                <div className="p-2 rounded-lg bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] flex-shrink-0">
                                    <ArrowUpCircle className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                                        Selah {available.version} is available
                                    </h2>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                        You're running {available.currentVersion}.
                                    </p>
                                </div>
                                {!installing && (
                                    <button
                                        onClick={() => setExpanded(false)}
                                        aria-label="Close"
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            {available.notes && (
                                <div className="px-4 py-3 max-h-56 overflow-y-auto">
                                    <p className="text-xs leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
                                        {available.notes}
                                    </p>
                                </div>
                            )}

                            {failed && (
                                <div className="mx-4 mb-1 flex items-start gap-2 p-2.5 rounded-lg bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs leading-relaxed">{message}</p>
                                </div>
                            )}

                            <div className="p-4 pt-2 space-y-2">
                                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                                    Selah will close while it installs, then reopen. Don't update
                                    during a service — anything on the live output goes dark until
                                    it restarts.
                                </p>
                                <div className="flex items-center justify-end gap-2">
                                    {!installing && (
                                        <button
                                            onClick={() => { dismiss(); setExpanded(false) }}
                                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
                                        >
                                            Skip this version
                                        </button>
                                    )}
                                    <button
                                        onClick={() => void install()}
                                        disabled={installing}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110 transition-all disabled:opacity-60"
                                    >
                                        {installing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        {installing ? 'Installing…' : 'Install and restart'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    )
}
