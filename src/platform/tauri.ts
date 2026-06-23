/**
 * Tauri platform implementation
 * Provides native desktop features when running in Tauri
 */

import type { Platform, UpdateInfo, DialogOptions, SaveDialogOptions, MessageDialogOptions } from './types';

// Check if running in Tauri. Use `__TAURI_INTERNALS__` (always injected
// by Tauri v2) — `__TAURI__` is gated on `withGlobalTauri` and is
// unreliable in packaged builds. See note in `platform/index.ts`.
const isTauri = () => {
    if (typeof window === 'undefined') return false;
    return (
        '__TAURI_INTERNALS__' in window ||
        '__TAURI__' in window ||
        window.location.protocol === 'tauri:'
    );
};

const tauriFilesystem = {
    isAvailable: isTauri(),

    readFile: async (path: string): Promise<string> => {
        if (!isTauri()) throw new Error('Not running in Tauri');
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return readTextFile(path);
    },

    writeFile: async (path: string, content: string): Promise<void> => {
        if (!isTauri()) throw new Error('Not running in Tauri');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, content);
    },

    exists: async (path: string): Promise<boolean> => {
        if (!isTauri()) return false;
        const { exists } = await import('@tauri-apps/plugin-fs');
        return exists(path);
    },

    mkdir: async (path: string): Promise<void> => {
        if (!isTauri()) throw new Error('Not running in Tauri');
        const { mkdir } = await import('@tauri-apps/plugin-fs');
        await mkdir(path, { recursive: true });
    },

    readDir: async (path: string): Promise<string[]> => {
        if (!isTauri()) return [];
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(path);
        return entries.map(entry => entry.name);
    },

    remove: async (path: string): Promise<void> => {
        if (!isTauri()) throw new Error('Not running in Tauri');
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(path);
    },
};

const tauriWindow = {
    isAvailable: isTauri(),

    minimize: async (): Promise<void> => {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().minimize();
    },

    maximize: async (): Promise<void> => {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().toggleMaximize();
    },

    close: async (): Promise<void> => {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
    },

    setTitle: async (title: string): Promise<void> => {
        if (!isTauri()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setTitle(title);
    },

    getTitle: async (): Promise<string> => {
        if (!isTauri()) return document.title;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        return getCurrentWindow().title();
    },
};

const tauriUpdater = {
    isAvailable: isTauri(),

    checkForUpdates: async (): Promise<UpdateInfo | null> => {
        if (!isTauri()) return null;
        try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check();
            if (update) {
                return {
                    version: update.version,
                    currentVersion: update.currentVersion,
                    date: update.date,
                    body: update.body,
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to check for updates:', error);
            return null;
        }
    },

    downloadUpdate: async (): Promise<void> => {
        if (!isTauri()) return;
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
            await update.downloadAndInstall();
        }
    },

    installUpdate: async (): Promise<void> => {
        if (!isTauri()) return;
        // The downloadAndInstall method handles both download and install
        await tauriUpdater.downloadUpdate();
    },
};

const tauriDialog = {
    isAvailable: isTauri(),

    open: async (options?: DialogOptions): Promise<string | string[] | null> => {
        if (!isTauri()) return null;
        const { open } = await import('@tauri-apps/plugin-dialog');
        return open({
            defaultPath: options?.defaultPath,
            directory: options?.directory,
            multiple: options?.multiple,
            filters: options?.filters,
            title: options?.title,
        });
    },

    save: async (options?: SaveDialogOptions): Promise<string | null> => {
        if (!isTauri()) return null;
        const { save } = await import('@tauri-apps/plugin-dialog');
        return save({
            defaultPath: options?.defaultPath,
            filters: options?.filters,
            title: options?.title,
        });
    },

    message: async (message: string, options?: MessageDialogOptions): Promise<void> => {
        if (!isTauri()) {
            alert(message);
            return;
        }
        const { message: showMessage } = await import('@tauri-apps/plugin-dialog');
        await showMessage(message, {
            title: options?.title,
            kind: options?.type || 'info',
            okLabel: options?.okLabel,
        });
    },

    ask: async (message: string, options?: MessageDialogOptions): Promise<boolean> => {
        if (!isTauri()) {
            return window.confirm(message);
        }
        const { ask } = await import('@tauri-apps/plugin-dialog');
        return ask(message, {
            title: options?.title,
            kind: options?.type || 'info',
            okLabel: options?.okLabel,
            cancelLabel: options?.cancelLabel,
        });
    },

    confirm: async (message: string, options?: MessageDialogOptions): Promise<boolean> => {
        if (!isTauri()) {
            return window.confirm(message);
        }
        const { confirm: confirmDialog } = await import('@tauri-apps/plugin-dialog');
        return confirmDialog(message, {
            title: options?.title,
            kind: options?.type || 'info',
            okLabel: options?.okLabel,
            cancelLabel: options?.cancelLabel,
        });
    },
};

export const tauriPlatform: Platform = {
    name: 'tauri',
    filesystem: tauriFilesystem,
    window: tauriWindow,
    updater: tauriUpdater,
    dialog: tauriDialog,
};
