/**
 * NearbyDesks — the Selah desks on this Wi-Fi, and the phone's connection to
 * one. Found over mDNS by the phone app (mobile/src-tauri `discover_desks`);
 * a browser page can't look for them, so this renders only in the app.
 *
 * Connected, the live session goes through the desk directly and keeps
 * working with the internet down (services/lan/link.ts). A desk the phone
 * hasn't met asks for the code on the desk's screen, once.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { deskToken } from '../../services/lan/identity'
import {
    connectToDesk,
    DESK_PORT,
    disconnectFromDesk,
    findDesks,
    useLanDesks,
    useLanLink,
    type DeskAddress,
} from '../../services/lan/link'

const MODE_WORDS = {
    strict: 'Only the operator changes slides',
    moderated: 'You suggest; the operator decides',
    open: 'You can change slides',
} as const

function PairingCode({ desk }: { desk: DeskAddress }) {
    const [code, setCode] = useState('')
    const connecting = useLanLink((s) => s.status === 'connecting')
    return (
        <form
            className="flex items-center gap-2 mt-2"
            onSubmit={(e) => {
                e.preventDefault()
                if (code.length === 6) void connectToDesk(desk, code)
            }}
        >
            <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Code on the desk"
                aria-label="Pairing code shown on the desk"
                className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-default)] text-base tracking-[0.3em] tabular-nums text-[var(--text-primary)] placeholder:tracking-normal placeholder:text-sm"
            />
            <button
                type="submit"
                disabled={code.length !== 6 || connecting}
                className="h-10 px-4 rounded-lg text-sm font-semibold text-white bg-[var(--accent-teal)] disabled:opacity-50"
            >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Pair'}
            </button>
        </form>
    )
}

/** For networks that block discovery: the desk shows its address under Phones. */
function ByAddress() {
    const [open, setOpen] = useState(false)
    const [address, setAddress] = useState('')
    const valid = /^\d{1,3}(\.\d{1,3}){3}$/.test(address.trim())
    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs text-[var(--accent-teal)]">
                Desk not listed? Connect by its address
            </button>
        )
    }
    return (
        <form
            className="flex items-center gap-2 mt-2"
            onSubmit={(e) => {
                e.preventDefault()
                if (valid) void connectToDesk({ id: null, name: address.trim(), addresses: [address.trim()], port: DESK_PORT })
            }}
        >
            <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 192.168.1.20"
                aria-label="The desk's address, shown under Phones on the desk"
                className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-default)] text-sm tabular-nums text-[var(--text-primary)]"
            />
            <button type="submit" disabled={!valid} className="h-10 px-4 rounded-lg text-sm font-semibold text-[var(--accent-teal)] bg-[var(--accent-teal)]/10 disabled:opacity-50">
                Connect
            </button>
        </form>
    )
}

export function NearbyDesks({ churchId }: { churchId?: string }) {
    const { desks, searching, error: searchError } = useLanDesks()
    const link = useLanLink()

    useEffect(() => {
        // Look once on opening; the refresh button looks again.
        if (useLanLink.getState().status !== 'connected') void findDesks()
    }, [])

    if (link.status === 'connected' && link.desk) {
        const mode = link.session?.mode
        return (
            <section className="px-4 pb-2" aria-labelledby="nearby-desks">
                <h3 id="nearby-desks" className="mobile-section-label mb-1.5">On this Wi-Fi</h3>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/10">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-[var(--text-primary)] truncate">Connected to {link.desk.name}</span>
                        <span className="block text-xs text-[var(--text-muted)]">
                            {link.role === 'operator' ? 'You run the screen' : mode ? MODE_WORDS[mode] : 'Following the desk'}
                            {' · works without internet'}
                        </span>
                    </span>
                    <button
                        type="button"
                        onClick={() => void disconnectFromDesk()}
                        className="h-9 px-3 rounded-lg text-xs font-semibold text-[var(--text-secondary)] active:bg-[var(--bg-tertiary)]"
                    >
                        Disconnect
                    </button>
                </div>
            </section>
        )
    }

    // Another church's desk on a shared network isn't one to join.
    const listed = desks.filter((d) => !churchId || !d.church || d.church === churchId)
    const isLinkDesk = (desk: DeskAddress) =>
        !!link.desk && (desk.id && link.desk.id ? desk.id === link.desk.id : desk.addresses[0] === link.desk.addresses[0])
    // A desk typed in by address isn't in the list; it still needs its row.
    const typedIn = link.desk && link.status !== 'idle' && !listed.some(isLinkDesk) ? [link.desk] : []
    const rows = [...listed, ...typedIn]
    const typedInFailed = link.status === 'idle' && link.error && link.desk && !listed.some(isLinkDesk)

    return (
        <section className="px-4 pb-2" aria-labelledby="nearby-desks">
            <div className="flex items-center justify-between mb-1.5">
                <h3 id="nearby-desks" className="mobile-section-label">On this Wi-Fi</h3>
                <button
                    type="button"
                    onClick={() => void findDesks()}
                    disabled={searching}
                    aria-label="Look again"
                    className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>
            </div>
            {searching && rows.length === 0 && <p className="text-sm text-[var(--text-muted)]">Looking for the desk…</p>}
            {searchError && <p className="text-sm text-rose-500">Couldn't look: {searchError}</p>}
            {!searching && !searchError && rows.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">
                    No desk found. Is Selah open on the desk's computer, on the same Wi-Fi?
                </p>
            )}
            <ul className="space-y-1.5">
                {rows.map((desk) => {
                    const mine = isLinkDesk(desk)
                    const paired = !!desk.id && !!deskToken(desk.id)
                    const connecting = mine && link.status === 'connecting'
                    const needsCode = mine && link.status === 'needs-code'
                    return (
                        <li key={desk.id ?? desk.addresses[0] ?? desk.name} className="px-3 py-2 rounded-xl bg-[var(--bg-tertiary)]">
                            <div className="flex items-center gap-3">
                                <MonitorSmartphone className="w-4 h-4 flex-shrink-0 text-[var(--accent-teal)]" />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm text-[var(--text-primary)] truncate">{desk.name}</span>
                                    <span className="block text-xs text-[var(--text-muted)] tabular-nums truncate">{desk.addresses[0] ?? ''}</span>
                                </span>
                                {!needsCode && (
                                    <button
                                        type="button"
                                        onClick={() => void connectToDesk(desk)}
                                        disabled={connecting}
                                        className="h-9 px-3 rounded-lg text-xs font-semibold text-[var(--accent-teal)] bg-[var(--accent-teal)]/10 disabled:opacity-50"
                                    >
                                        {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : paired ? 'Connect' : 'Pair'}
                                    </button>
                                )}
                            </div>
                            {mine && link.error && <p className="mt-1.5 text-xs text-rose-500">{link.error}</p>}
                            {needsCode && !link.error && (
                                <p className="mt-1.5 text-xs text-[var(--text-muted)]">On the desk, open Phones and choose "Pair a phone".</p>
                            )}
                            {needsCode && <PairingCode desk={desk} />}
                        </li>
                    )
                })}
            </ul>
            {typedInFailed && <p className="mt-1.5 text-xs text-rose-500">{link.error}</p>}
            <ByAddress />
        </section>
    )
}
