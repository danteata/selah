/**
 * Platform detection and export
 * Automatically selects the correct platform implementation based on environment
 */

import type { Platform } from './types';
import { webPlatform } from './web';
import { tauriPlatform } from './tauri';

// Check if running in Tauri environment.
//
// `window.__TAURI_INTERNALS__` is the IPC bridge Tauri v2 injects into
// EVERY webview before any app script runs — `@tauri-apps/api`'s
// `invoke` reads it, so it's the only reliable signal. `window.__TAURI__`
// only exists when `withGlobalTauri` is set and is unreliable in packaged
// builds. The protocol/hostname checks are fallbacks for the production
// asset origin (this app serves over `http://*.localhost` custom schemes,
// so we match the `tauri.localhost` host as well as the `tauri:` scheme).
//
// IMPORTANT: this is evaluated at CALL TIME, not memoised. The previous
// implementation froze the result into a module-level `platform` const at
// import time; if that ran before the IPC global was attached, the app was
// permanently misdetected as web — which routed desktop Google sign-in
// through `authenticateWithRedirect` and navigated the webview to Clerk's
// hosted portal.
export const isTauri = (): boolean => {
    if (typeof window === 'undefined') return false;
    if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return true;
    const { protocol, hostname } = window.location;
    return protocol === 'tauri:' || hostname === 'tauri.localhost';
};

// The platform implementation object (filesystem/window/updater APIs).
// Selecting this once is fine — its methods are only ever called inside
// Tauri, and by then the runtime is fully attached. Detection booleans,
// however, must stay call-time (see `isDesktop`/`isWeb` below).
export const platform: Platform = isTauri() ? tauriPlatform : webPlatform;

// Re-export types
export type { Platform, PlatformFilesystem, PlatformWindow, PlatformUpdater, PlatformDialog, UpdateInfo, DialogOptions, SaveDialogOptions, MessageDialogOptions, FileFilter } from './types';

// Convenience hook for React components
export function usePlatform(): Platform {
    return platform;
}

// Utility functions — call-time so they reflect the real runtime even if
// this module was imported before the Tauri IPC global was attached.
export function isDesktop(): boolean {
    return isTauri();
}

export function isWeb(): boolean {
    return !isTauri();
}
