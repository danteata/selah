import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { isDesktop } from '../platform';

export interface FileDialogOptions {
    multiple?: boolean;
    /**
     * Comma-separated or standard accept string for web (e.g., 'image/*,video/*')
     * or an array of extensions for Tauri (e.g., ['png', 'jpg', 'mp4']).
     * The utility will attempt to map the accept string to extensions if necessary.
     */
    accept?: string;
    directory?: boolean;
}

/**
 * Extracts file extensions from a standard accept string.
 * This is a basic mapping and won't cover every MIME type perfectly,
 * but handles common cases for images, videos, audio, and documents.
 */
function getExtensionsFromAccept(accept: string): string[] {
    const exts: string[] = [];
    const parts = accept.split(',');

    for (const part of parts) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed.startsWith('.')) {
            exts.push(trimmed.substring(1));
        } else if (trimmed === 'image/*') {
            exts.push('png', 'jpg', 'jpeg', 'webp', 'gif', 'svg');
        } else if (trimmed === 'video/*') {
            exts.push('mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv');
        } else if (trimmed === 'audio/*') {
            exts.push('mp3', 'wav', 'ogg', 'm4a', 'flac');
        } else {
            // For specific mime types like image/jpeg, extract jpeg
            const match = trimmed.match(/^\w+\/([a-z0-9+-]+)$/);
            if (match && match[1]) {
                exts.push(match[1]);
            }
        }
    }

    // Remove exact duplicates and return
    return Array.from(new Set(exts));
}

/**
 * Helper to extract filename from a full path
 */
function getFilenameFromPath(path: string): string {
    // Handle both Windows and Unix path separators
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
}

/**
 * Helper to guess MIME type from filename/extension
 */
function guessMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    const mimeMap: Record<string, string> = {
        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',

        // Videos
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',

        // Audio
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'flac': 'audio/flac',

        // Documents/Data
        'db': 'application/octet-stream',
        'sqlite': 'application/x-sqlite3',
        'sqlite3': 'application/x-sqlite3',
        'xml': 'application/xml',
        'csv': 'text/csv',
        'pdf': 'application/pdf',
        'txt': 'text/plain',
    };

    return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Reads native file paths (e.g. from a Tauri drag-drop event or dialog
 * result) off disk via the Tauri fs plugin and returns them as standard JS
 * File objects, so downstream code (blob URLs, upload previews) can treat
 * desktop-sourced files identically to browser-sourced ones.
 */
export async function filePathsToFiles(paths: string[]): Promise<File[]> {
    const files: File[] = [];

    for (const filePath of paths) {
        if (!filePath) continue; // Skip if somehow empty

        // Read file bytes via Tauri fs (returns Uint8Array)
        const bytes = await readFile(filePath);

        const filename = getFilenameFromPath(filePath);
        const mimeType = guessMimeType(filename);

        files.push(new File([bytes], filename, { type: mimeType }));
    }

    return files;
}

/**
 * Opens a native file dialog on desktop or a browser file picker on the web,
 * and returns the selected files as JavaScript File objects.
 */
export async function openFileDialog(options: FileDialogOptions = {}): Promise<File[] | null> {
    const { multiple = false, accept, directory = false } = options;

    if (isDesktop()) {
        try {
            // Parse extensions for Tauri dialog filter
            const filters = [];
            if (accept) {
                const exts = getExtensionsFromAccept(accept);
                if (exts.length > 0) {
                    filters.push({
                        name: 'Supported Files',
                        extensions: exts,
                    });
                }
            }

            const result = await open({
                multiple,
                directory,
                filters: filters.length > 0 ? filters : undefined,
            });

            if (!result) {
                return null; // User cancelled
            }

            const paths = Array.isArray(result) ? result : [result];
            const files = await filePathsToFiles(paths);

            return files.length > 0 ? files : null;
        } catch (error) {
            console.error('Failed to open native file dialog or read files:', error);
            // Fallback to web implementation if Tauri fails unexpectedly
        }
    }

    // Web Implementation (Fallback for Desktop if needed, primary for Web)
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;

        // Tauri handles directory selection differently, but web uses webkitdirectory
        if (directory) {
            input.webkitdirectory = true;
        }

        if (accept) {
            input.accept = accept;
        }

        input.onchange = (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                // Convert FileList to Array
                resolve(Array.from(target.files));
            } else {
                resolve(null);
            }
            // Cleanup
            input.remove();
        };

        input.oncancel = () => {
            resolve(null);
            input.remove();
        };

        // Trigger dialog
        input.click();
    });
}
