/**
 * NearbyDesks — the Selah desks on this Wi-Fi, found over mDNS by the phone
 * app (mobile/src-tauri `discover_desks`). A browser page can't look for
 * them, so this renders only in the app. Finding the desk is the first half
 * of a phone talking to it directly instead of through Convex.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react'

interface Desk {
    name: string
    host: string
    addresses: string[]
    port: number
    properties: Record<string, string>
}

type Search =
    | { status: 'looking' }
    | { status: 'found'; desks: Desk[] }
    | { status: 'failed'; error: string }

export function NearbyDesks({ churchId }: { churchId?: string }) {
    const [search, setSearch] = useState<Search>({ status: 'looking' })

    const look = useCallback(async () => {
        setSearch({ status: 'looking' })
        try {
            const { invoke } = await import('@tauri-apps/api/core')
            const desks = await invoke<Desk[]>('discover_desks', { timeoutMs: 3000 })
            setSearch({ status: 'found', desks })
        } catch (err) {
            setSearch({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
        }
    }, [])

    useEffect(() => { void look() }, [look])

    // Another church's desk on a shared network isn't one to join.
    const desks = search.status === 'found'
        ? search.desks.filter((d) => !churchId || !d.properties.church || d.properties.church === churchId)
        : []

    return (
        <section className="px-4 pb-2" aria-labelledby="nearby-desks">
            <div className="flex items-center justify-between mb-1.5">
                <h3 id="nearby-desks" className="mobile-section-label">On this Wi-Fi</h3>
                <button
                    type="button"
                    onClick={() => void look()}
                    disabled={search.status === 'looking'}
                    aria-label="Look again"
                    className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                    {search.status === 'looking' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>
            </div>
            {search.status === 'looking' && <p className="text-sm text-[var(--text-muted)]">Looking for the desk…</p>}
            {search.status === 'failed' && <p className="text-sm text-rose-500">Couldn't look: {search.error}</p>}
            {search.status === 'found' && desks.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No desk found. Is the desk's computer running Selah on the same Wi-Fi?</p>
            )}
            <ul className="space-y-1.5">
                {desks.map((desk) => (
                    <li key={desk.name} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--bg-tertiary)]">
                        <MonitorSmartphone className="w-4 h-4 flex-shrink-0 text-[var(--accent-teal)]" />
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm text-[var(--text-primary)] truncate">{desk.name}</span>
                            <span className="block text-xs text-[var(--text-muted)] tabular-nums truncate">
                                {desk.addresses[0] ?? desk.host}:{desk.port}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    )
}
