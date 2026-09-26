import { useAppStore } from '../../store/appStore'
import { clearCachedAuthSession } from '../../hooks/useIndexedDB'
import { analytics } from '../analytics'
import { isDesktop } from '../../platform'

/**
 * Forget the person who is signing out, before Clerk does.
 *
 * Church PCs are shared, and signing out used to end only the Clerk session:
 * the next person inherited the last user's schedules (persisted in the
 * store), their cached role and church (IndexedDB), their analytics identity,
 * and on desktop their Pro licence file. Each step is best-effort — a failure
 * to clear one must never stop the sign-out itself.
 */
export async function clearSignedOutUser(): Promise<void> {
    useAppStore.getState().clearUserSession()

    try {
        await clearCachedAuthSession()
    } catch (err) {
        console.warn('[signOut] cached session not cleared:', err)
    }

    try {
        analytics.reset()
    } catch (err) {
        console.warn('[signOut] analytics identity not reset:', err)
    }

    if (isDesktop()) {
        try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('clear_license')
        } catch (err) {
            console.warn('[signOut] licence cache not cleared:', err)
        }
    }
}
