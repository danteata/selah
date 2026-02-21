/**
 * Platform abstraction types for Selah
 * Allows the app to work in both web and desktop (Tauri) environments
 */

export interface Platform {
    name: 'web' | 'tauri';
    filesystem: PlatformFilesystem;
    window: PlatformWindow;
    updater: PlatformUpdater;
    dialog: PlatformDialog;
}

export interface PlatformFilesystem {
    isAvailable: boolean;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    readDir(path: string): Promise<string[]>;
    remove(path: string): Promise<void>;
}

export interface PlatformWindow {
    isAvailable: boolean;
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    setTitle(title: string): Promise<void>;
    getTitle(): Promise<string>;
}

export interface PlatformUpdater {
    isAvailable: boolean;
    checkForUpdates(): Promise<UpdateInfo | null>;
    downloadUpdate(): Promise<void>;
    installUpdate(): Promise<void>;
}

export interface UpdateInfo {
    version: string;
    currentVersion: string;
    date?: string;
    body?: string;
}

export interface PlatformDialog {
    isAvailable: boolean;
    open(options?: DialogOptions): Promise<string | string[] | null>;
    save(options?: SaveDialogOptions): Promise<string | null>;
    message(message: string, options?: MessageDialogOptions): Promise<void>;
    ask(message: string, options?: MessageDialogOptions): Promise<boolean>;
    confirm(message: string, options?: MessageDialogOptions): Promise<boolean>;
}

export interface DialogOptions {
    defaultPath?: string;
    directory?: boolean;
    multiple?: boolean;
    filters?: FileFilter[];
    title?: string;
}

export interface SaveDialogOptions {
    defaultPath?: string;
    filters?: FileFilter[];
    title?: string;
}

export interface MessageDialogOptions {
    title?: string;
    type?: 'info' | 'warning' | 'error';
    okLabel?: string;
    cancelLabel?: string;
}

export interface FileFilter {
    name: string;
    extensions: string[];
}
