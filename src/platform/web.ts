/**
 * Web platform implementation
 * Provides stubs/no-ops for desktop-only features when running in browser
 */

import type { Platform } from './types';

const webFilesystem = {
    isAvailable: false,
    readFile: async () => {
        throw new Error('Filesystem not available in web mode');
    },
    writeFile: async () => {
        throw new Error('Filesystem not available in web mode');
    },
    exists: async () => false,
    mkdir: async () => {
        throw new Error('Filesystem not available in web mode');
    },
    readDir: async () => [],
    remove: async () => {
        throw new Error('Filesystem not available in web mode');
    },
};

const webWindow = {
    isAvailable: false,
    minimize: async () => {
        console.warn('Window controls not available in web mode');
    },
    maximize: async () => {
        console.warn('Window controls not available in web mode');
    },
    close: async () => {
        console.warn('Window controls not available in web mode');
    },
    setTitle: async () => {
        console.warn('Window controls not available in web mode');
    },
    getTitle: async () => document.title,
};

const webUpdater = {
    isAvailable: false,
    checkForUpdates: async () => null,
    downloadUpdate: async () => {
        throw new Error('Updater not available in web mode');
    },
    installUpdate: async () => {
        throw new Error('Updater not available in web mode');
    },
};

const webDialog = {
    isAvailable: false,
    open: async () => null,
    save: async () => null,
    message: async (message: string) => {
        alert(message);
    },
    ask: async (message: string) => {
        return confirm(message);
    },
    confirm: async (message: string) => {
        return confirm(message);
    },
};

export const webPlatform: Platform = {
    name: 'web',
    filesystem: webFilesystem,
    window: webWindow,
    updater: webUpdater,
    dialog: webDialog,
};
