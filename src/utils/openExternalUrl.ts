import { isDesktop } from '../platform'

/** Open a web page in the system browser (desktop) or a new tab (web). */
export async function openExternalUrl(url: string): Promise<void> {
    if (isDesktop()) {
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(url)
        return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
}
