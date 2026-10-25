import { useEffect } from 'react'
import { isTauri } from '../platform'

/**
 * The desk app announces itself on the local network for its church, so the
 * phone app finds it on the same Wi-Fi (src-tauri/src/lan.rs). Signing out
 * or moving church takes it off. Desk only: a browser can't announce, and
 * the phone app looks rather than announces.
 */
export function useLanAnnounce(churchId: string | undefined | null): void {
    useEffect(() => {
        if (!churchId || !isTauri()) return
        let cancelled = false
        const invoke = import('@tauri-apps/api/core').then((m) => m.invoke)
        invoke
            .then((call) => (cancelled ? undefined : call('lan_announce', { churchId })))
            .catch((err) => console.warn('[lan] could not announce the desk:', err))
        return () => {
            cancelled = true
            invoke.then((call) => call('lan_stop')).catch(() => {})
        }
    }, [churchId])
}
