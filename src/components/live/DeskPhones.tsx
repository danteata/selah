/**
 * DeskPhones — the desk's view of the phones on its Wi-Fi: which are
 * connected, pairing a new one, and who may drive the screen when there's no
 * Convex session to say. The desk app only (useLanHost does the work).
 */

import { useCallback, useEffect, useState } from 'react'
import { Crown, Loader2, Shield, Smartphone, X } from 'lucide-react'
import { refreshLanPhones } from '../../hooks/useLanHost'
import { localMode, setLocalMode, useLanHostStatus } from '../../services/lan/host'
import type { CollaborationMode } from '../../services/lan/protocol'

interface PairedDevice {
    id: string
    name: string
    pairedAt: number
}

const MODES: Array<{ mode: CollaborationMode; label: string; description: string }> = [
    { mode: 'strict', label: 'Strict', description: 'Only you change slides' },
    { mode: 'moderated', label: 'Review', description: 'Phones suggest; you decide' },
    { mode: 'open', label: 'Open', description: 'Phones change slides directly' },
]

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke: call } = await import('@tauri-apps/api/core')
    return call<T>(command, args)
}

function PairingPanel({ onDone }: { onDone: () => void }) {
    const [pairing, setPairing] = useState<{ code: string; until: number } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        let cancelled = false
        invoke<{ code: string; expiresInMs: number }>('lan_pair_begin')
            .then(({ code, expiresInMs }) => { if (!cancelled) setPairing({ code, until: Date.now() + expiresInMs }) })
            .catch((err) => { if (!cancelled) setError(String(err)) })
        return () => {
            cancelled = true
            void invoke('lan_pair_end').catch(() => {})
        }
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])

    const left = pairing ? Math.max(0, Math.ceil((pairing.until - now) / 1000)) : 0
    useEffect(() => {
        if (pairing && left === 0) onDone()
    }, [pairing, left, onDone])

    if (error) return <p className="text-xs text-rose-500">{error}</p>
    if (!pairing) return <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />

    return (
        <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-center">
            <p className="text-[11px] text-[var(--text-muted)]">On the phone: More → On this Wi-Fi → Pair, then enter</p>
            <p className="my-1.5 text-3xl font-semibold tracking-[0.25em] tabular-nums text-[var(--text-primary)]">
                {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                Works for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                <button type="button" onClick={onDone} className="ml-2 text-[var(--accent-teal)]">Done</button>
            </p>
        </div>
    )
}

export function DeskPhones() {
    const { listening, error, addresses, phones, inConvexSession } = useLanHostStatus()
    const [open, setOpen] = useState(false)
    const [pairing, setPairing] = useState(false)
    const [paired, setPaired] = useState<PairedDevice[]>([])
    const [mode, setMode] = useState<CollaborationMode>(localMode)

    const loadPaired = useCallback(() => {
        invoke<PairedDevice[]>('lan_devices').then(setPaired).catch(() => setPaired([]))
    }, [])

    useEffect(() => {
        if (open) loadPaired()
    }, [open, loadPaired, phones.length])

    const endPairing = useCallback(() => {
        setPairing(false)
        loadPaired()
    }, [loadPaired])

    const chooseMode = (next: CollaborationMode) => {
        setMode(next)
        setLocalMode(next)
        refreshLanPhones()
    }

    const forget = (deviceId: string) => {
        void invoke('lan_forget', { deviceId }).then(loadPaired)
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={listening ? 'Phones on this Wi-Fi' : 'Phones on this Wi-Fi (not listening)'}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${phones.length > 0
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[var(--bg-tertiary)] border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
                <Smartphone className="w-3.5 h-3.5" />
                {phones.length > 0 ? <span className="tabular-nums">{phones.length}</span> : 'Phones'}
                {!listening && error && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />}
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
                    <div
                        role="dialog"
                        aria-label="Phones on this Wi-Fi"
                        className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl p-3 space-y-3"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Phones on this Wi-Fi</h3>
                                <p className="text-[11px] text-[var(--text-muted)]">
                                    {listening
                                        ? 'They follow and drive this desk directly, with or without internet.'
                                        : error ?? 'Starting…'}
                                </p>
                            </div>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {phones.length > 0 && (
                            <ul className="space-y-1" aria-label="Connected phones">
                                {phones.map((phone) => {
                                    const RoleIcon = phone.role === 'operator' ? Crown : Shield
                                    return (
                                        <li key={phone.client} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                                            <RoleIcon className="w-3.5 h-3.5 text-emerald-500" />
                                            <span className="flex-1 truncate">{phone.name}</span>
                                            <span className="text-[var(--text-muted)]">{phone.role === 'operator' ? 'Runs the screen' : 'Contributor'}</span>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}

                        <div>
                            <p className="text-[11px] font-medium text-[var(--text-secondary)] mb-1">Who can change slides from a phone</p>
                            {inConvexSession ? (
                                <p className="text-[11px] text-[var(--text-muted)]">As the live session is set (the session badge).</p>
                            ) : (
                                <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)]" role="radiogroup" aria-label="Who can change slides">
                                    {MODES.map((m) => (
                                        <button
                                            key={m.mode}
                                            type="button"
                                            role="radio"
                                            aria-checked={m.mode === mode}
                                            title={m.description}
                                            onClick={() => chooseMode(m.mode)}
                                            className={`flex-1 h-7 rounded-md text-[11px] font-semibold transition-colors ${m.mode === mode
                                                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                                                : 'text-[var(--text-secondary)]'}`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="mt-1 text-[10px] text-[var(--text-muted)]">Your own phone, signed in as you, always runs the screen.</p>
                        </div>

                        {listening && (pairing
                            ? <PairingPanel onDone={endPairing} />
                            : (
                                <button
                                    type="button"
                                    onClick={() => setPairing(true)}
                                    className="w-full h-8 rounded-lg text-xs font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110"
                                >
                                    Pair a phone
                                </button>
                            ))}

                        {listening && addresses.length > 0 && (
                            <p className="text-[10px] text-[var(--text-muted)]">
                                Phone can't find this desk? Connect it by address: <span className="font-mono text-[var(--text-secondary)]">{addresses.join(', ')}</span>
                            </p>
                        )}

                        {paired.length > 0 && (
                            <div>
                                <p className="text-[11px] font-medium text-[var(--text-secondary)] mb-1">Paired phones</p>
                                <ul className="space-y-0.5">
                                    {paired.map((device) => (
                                        <li key={device.id} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                                            <span className="flex-1 truncate">{device.name}</span>
                                            <button type="button" onClick={() => forget(device.id)} className="text-[11px] text-[var(--text-muted)] hover:text-rose-500">
                                                Forget
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
