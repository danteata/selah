/**
 * Platform detection and export
 * Automatically selects the correct platform implementation based on environment
 */

import type { Platform } from './types';
import { webPlatform } from './web';
import { tauriPlatform } from './tauri';

// Check if running in Tauri environment
const isTauri = (): boolean => {
    return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Export the appropriate platform based on environment
export const platform: Platform = isTauri() ? tauriPlatform : webPlatform;

// Re-export types
export type { Platform, PlatformFilesystem, PlatformWindow, PlatformUpdater, PlatformDialog, UpdateInfo, DialogOptions, SaveDialogOptions, MessageDialogOptions, FileFilter } from './types';

// Convenience hook for React components
export function usePlatform(): Platform {
    return platform;
}

// Utility functions
export function isDesktop(): boolean {
    return platform.name === 'tauri';
}

export function isWeb(): boolean {
    return platform.name === 'web';
}
