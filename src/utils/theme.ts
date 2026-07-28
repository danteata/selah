/**
 * The one place the colour theme is read, written and applied.
 *
 * It used to have five owners: main.tsx applied it at boot, App.tsx applied it
 * from a settings field nothing ever wrote (so it only ever *removed* dark),
 * Dashboard.tsx seeded a local copy off the DOM class and re-applied it on
 * mount, the store's setters wrote a different field, and QuickActions toggled
 * the class directly without telling anyone. Whether the app came up dark
 * depended on which effect ran last, so a re-mount — an auth refresh after a
 * network change, say — could drop it to light with nothing to put it back.
 *
 * The rules now: localStorage is the durable value, the store holds it for the
 * UI, and exactly one effect (in App.tsx) writes the class.
 */

export const THEME_STORAGE_KEY = 'theme'

/**
 * The theme to start in: the operator's stored choice, else the OS preference.
 *
 * main.tsx calls this before React mounts (so there's no flash of the wrong
 * theme) and the store calls it for its initial value. Both must agree, which
 * is why they share this function rather than each reading localStorage.
 */
export function readStoredTheme(): boolean {
    if (typeof window === 'undefined') return false

    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY)
        if (stored === 'dark') return true
        if (stored === 'light') return false
    } catch {
        // Private mode / storage disabled — fall through to the OS preference.
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Persist the operator's choice so the next launch starts in it. */
export function storeTheme(isDark: boolean): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
    } catch {
        // Not persisting is survivable; the session still honours the choice.
    }
}

/** Apply the theme to the document. Call this from one place only. */
export function applyThemeClass(isDark: boolean): void {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', isDark)
}
