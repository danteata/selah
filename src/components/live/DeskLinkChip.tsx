/**
 * DeskLinkChip — on the phone app's live screen, the link to the desk on this
 * Wi-Fi: who you are in the session while connected, and a way to find the
 * desk when not. Opens a sheet with NearbyDesks.
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crown, Loader2, Shield, Wifi, X } from 'lucide-react'
import { useLanLink } from '../../services/lan/link'
import { NearbyDesks } from './NearbyDesks'

export function DeskLinkChip({ churchId }: { churchId?: string }) {
    const status = useLanLink((s) => s.status)
    const role = useLanLink((s) => s.role)
    const deskName = useLanLink((s) => s.desk?.name)
    const [open, setOpen] = useState(false)

    const connected = status === 'connected'
    const RoleIcon = role === 'operator' ? Crown : Shield

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={connected ? `Connected to ${deskName} over Wi-Fi` : 'Find the desk on this Wi-Fi'}
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-semibold active:scale-95 transition-transform ${connected
                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12'
                    : 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)]'}`}
            >
                {status === 'connecting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                {connected
                    ? <><RoleIcon className="w-3 h-3 opacity-70" /><span className="landscape:hidden">{role === 'operator' ? 'Operator' : 'Contributor'}</span></>
                    : <span>Desk</span>}
            </button>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            className="fixed inset-0 bg-black/50 z-40"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setOpen(false)}
                        />
                        <motion.div
                            role="dialog"
                            aria-label="The desk on this Wi-Fi"
                            className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        >
                            <div className="flex items-center justify-between pl-4 pr-1.5 pt-2 pb-1">
                                <h2 className="text-[17px] text-[var(--text-primary)]">The desk</h2>
                                <button onClick={() => setOpen(false)} aria-label="Close" className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-tertiary)]">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <NearbyDesks churchId={churchId} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
