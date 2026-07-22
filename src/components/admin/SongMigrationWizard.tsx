/**
 * Song Migration Wizard for EasyWorship Import
 * 
 * Step-by-step wizard to import songs from EasyWorship 6/7
 * 
 * Supports:
 * - Single SQLite file (Songs.db or SongWords.db)
 * - Multiple SQLite files (Songs.db + SongWords.db for complete data)
 * - XML export files
 * - CSV export files
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Upload, FileText, Music, AlertCircle, CheckCircle, XCircle, ChevronRight, ChevronLeft, Loader2, Database, FileStack } from 'lucide-react';
import { parseEasyWorshipFile, parseEasyWorshipDatabases, toSelahSong } from '../../services/migration/easyWorshipParser';
import type { ParsedSong, MigrationStatus, EasyWorshipFileType } from '../../services/migration/types';
import { openFileDialog, filePathsToFiles } from '../../utils/fileDialog';
import { useSongs } from '../../hooks/useSongs';
import { useConvexConnection } from '../../providers/ConvexConnectionProvider';
import { isDesktop } from '../../platform';

type WizardStep = 'upload' | 'preview' | 'importing' | 'complete';

interface MigrationWizardProps {
    onClose?: () => void;
}

export function SongMigrationWizard({ onClose }: MigrationWizardProps) {
    const [step, setStep] = useState<WizardStep>('upload');
    const [files, setFiles] = useState<{
        songsDb?: File;
        songWordsDb?: File;
        singleFile?: File;
    }>({});
    const [fileType, setFileType] = useState<EasyWorshipFileType>('unknown');
    const [parsedSongs, setParsedSongs] = useState<ParsedSong[]>([]);
    const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set());
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [importedIds, setImportedIds] = useState<string[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const { createSong, updateSong, songs: existingSongs } = useSongs();
    const { isOffline } = useConvexConnection();

    // Local duplicate detection — works fully offline. We need the song's
    // _id too so we can call updateSong() against the existing row when
    // "Replace existing" is enabled (preserves the song id, so slides that
    // reference it stay valid).
    const existingByTitle = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of existingSongs) {
            if (!s.title) continue
            const key = s.title.toLowerCase().trim()
            const id = s._id || s.id
            if (id) map.set(key, id)
        }
        return map
    }, [existingSongs]);

    const existingTitles = useMemo(
        () => new Set(existingByTitle.keys()),
        [existingByTitle],
    );

    // Handle single file upload
    const handleSingleFileUpload = useCallback(async (file: File) => {
        setIsParsing(true);
        setFiles({ singleFile: file });
        setParseErrors([]);

        try {
            const result = await parseEasyWorshipFile(file);
            setFileType(result.fileType);
            setParsedSongs(result.songs);
            setParseErrors(result.errors);

            // Select all valid songs by default
            const validIndices = result.songs
                .map((s, i) => s.isValid ? i : -1)
                .filter(i => i >= 0);
            setSelectedSongs(new Set(validIndices));

            // Move to preview if songs were parsed
            if (result.songs.length > 0) {
                setStep('preview');
            }
        } catch (error) {
            setParseErrors([error instanceof Error ? error.message : 'Failed to parse file']);
        } finally {
            setIsParsing(false);
        }
    }, []);

    // On desktop (Tauri), the browser's HTML5 drag/drop events receive empty
    // `dataTransfer.files` because Tauri intercepts OS-level file drags before
    // they reach the webview. We therefore listen to Tauri's own webview
    // drag-drop event, which hands back real file paths that we read off disk
    // the same way the native file picker does. This mirrors the MediaUpload
    // drop zone (src/components/media/MediaUpload.tsx) so behaviour is
    // consistent across the app. The HTML5 handlers below early-return on
    // desktop to avoid double-processing.
    const handleSingleFileUploadRef = useRef(handleSingleFileUpload);
    handleSingleFileUploadRef.current = handleSingleFileUpload;

    useEffect(() => {
        if (!isDesktop()) return;

        let unlisten: (() => void) | undefined;
        let cancelled = false;

        import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
            if (cancelled) return;
            getCurrentWebview().onDragDropEvent((event) => {
                if (event.payload.type === 'enter' || event.payload.type === 'over') {
                    setIsDragging(true);
                } else if (event.payload.type === 'drop') {
                    setIsDragging(false);
                    filePathsToFiles(event.payload.paths)
                        .then((droppedFiles) => {
                            if (droppedFiles.length > 0) {
                                handleSingleFileUploadRef.current(droppedFiles[0]);
                            }
                        })
                        .catch((error) => console.error('Failed to read dropped file:', error));
                } else {
                    setIsDragging(false);
                }
            }).then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            });
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    // Handle multiple database files
    const handleMultipleFilesUpload = useCallback(async (songsDb: File, songWordsDb: File) => {
        setIsParsing(true);
        setFiles({ songsDb, songWordsDb });
        setFileType('sqlite');
        setParseErrors([]);

        try {
            const songs = await parseEasyWorshipDatabases({ songsDb, songWordsDb });
            setParsedSongs(songs);

            // Select all valid songs by default
            const validIndices = songs
                .map((s, i) => s.isValid ? i : -1)
                .filter(i => i >= 0);
            setSelectedSongs(new Set(validIndices));

            if (songs.length > 0) {
                setStep('preview');
            } else {
                setParseErrors(['No songs found in the provided database files']);
            }
        } catch (error) {
            setParseErrors([error instanceof Error ? error.message : 'Failed to parse database files']);
        } finally {
            setIsParsing(false);
        }
    }, []);

    // Handle file input change for single file
    const handleSingleFileClick = useCallback(async () => {
        try {
            const resultFiles = await openFileDialog({
                multiple: false,
                accept: '.db,.sqlite,.sqlite3,.xml,.csv',
            });
            if (resultFiles && resultFiles.length > 0) {
                handleSingleFileUpload(resultFiles[0]);
            }
        } catch (error) {
            console.error('Error selecting file:', error);
        }
    }, [handleSingleFileUpload]);

    // Handle file input change for Songs.db
    const handleSongsDbClick = useCallback(async () => {
        try {
            const resultFiles = await openFileDialog({
                multiple: false,
                accept: '.db,.sqlite,.sqlite3',
            });
            if (resultFiles && resultFiles.length > 0) {
                setFiles(prev => ({ ...prev, songsDb: resultFiles[0] }));
            }
        } catch (error) {
            console.error('Error selecting file:', error);
        }
    }, []);

    // Handle file input change for SongWords.db
    const handleSongWordsDbClick = useCallback(async () => {
        try {
            const resultFiles = await openFileDialog({
                multiple: false,
                accept: '.db,.sqlite,.sqlite3',
            });
            if (resultFiles && resultFiles.length > 0) {
                setFiles(prev => ({ ...prev, songWordsDb: resultFiles[0] }));
            }
        } catch (error) {
            console.error('Error selecting file:', error);
        }
    }, []);

    // Process multiple files when both are selected
    const processMultipleFiles = useCallback(() => {
        if (files.songsDb && files.songWordsDb) {
            handleMultipleFilesUpload(files.songsDb, files.songWordsDb);
        }
    }, [files, handleMultipleFilesUpload]);

    // Handle import — offline-first via useSongs.createSong (which writes to
    // IndexedDB locally and syncs to Convex when online). Each song is imported
    // independently so a single failure doesn't abort the whole batch.
    //
    // When `replaceExisting` is on, a song that already exists by title is
    // updated in place (lyrics/verses/artist replaced, id preserved) rather
    // than skipped. This is the recovery path for re-parsing after fixing
    // the RTF parser, and prevents duplicate rows for the same song.
    const handleImport = useCallback(async () => {
        if (selectedSongs.size === 0) return;

        setStep('importing');
        setImportProgress({ current: 0, total: selectedSongs.size });
        setImportErrors([]);
        setImportedIds([]);

        const songsToImport = Array.from(selectedSongs)
            .map(i => parsedSongs[i])
            .filter(Boolean)
            .map(toSelahSong);

        const allImportedIds: string[] = [];
        const allErrors: string[] = [];
        let imported = 0;
        let updated = 0;
        let skipped = 0;

        // Process with bounded concurrency (8 parallel) so import feels fast on
        // large libraries while not overwhelming IndexedDB / Convex.
        const CONCURRENCY = 8;
        // Per-song timeout. A dead Convex websocket can leave useMutation
        // promises unresolved forever; without this, a single bad song would
        // freeze the import. Picked to be larger than the 15s mutation
        // timeout in useSongs.ts so genuine slow paths can still complete.
        const SONG_TIMEOUT_MS = 45_000;
        let cursor = 0;

        const withSongTimeout = <T,>(p: Promise<T>, title: string): Promise<T> =>
            new Promise<T>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`Timed out after ${SONG_TIMEOUT_MS}ms`)),
                    SONG_TIMEOUT_MS,
                );
                p.then(
                    (v) => { clearTimeout(timer); resolve(v); },
                    (e) => { clearTimeout(timer); reject(e); },
                );
            });

        const worker = async () => {
            while (cursor < songsToImport.length) {
                const idx = cursor++;
                const song = songsToImport[idx];
                if (!song) continue;

                // Duplicates by title (case-insensitive) — skip or replace
                const titleKey = song.title.toLowerCase().trim();
                const existingId = existingByTitle.get(titleKey);
                if (existingId && !replaceExisting) {
                    skipped++;
                    setImportProgress(p => ({ current: p.current + 1, total: p.total }));
                    continue;
                }

                try {
                    if (existingId && replaceExisting) {
                        const ok = await withSongTimeout(
                            updateSong(existingId, {
                                title: song.title,
                                artist: song.artist || song.author || 'Unknown',
                                lyrics: song.lyrics,
                                verses: song.verses,
                                sections: song.sections,
                                defaultArrangement: song.defaultArrangement,
                                author: song.author,
                            }),
                            song.title,
                        );
                        if (ok) {
                            allImportedIds.push(existingId);
                            updated++;
                        } else {
                            allErrors.push(`Failed to update "${song.title}"`);
                        }
                    } else {
                        const created = await withSongTimeout(
                            createSong({
                                title: song.title,
                                artist: song.artist || song.author || 'Unknown',
                                lyrics: song.lyrics,
                                verses: song.verses,
                                sections: song.sections,
                                defaultArrangement: song.defaultArrangement,
                                author: song.author,
                            }),
                            song.title,
                        );
                        if (created) {
                            const newId = (created as any)._id || (created as any).id || '';
                            allImportedIds.push(newId);
                            existingByTitle.set(titleKey, newId);
                            imported++;
                        } else {
                            allErrors.push(`Failed to import "${song.title}"`);
                        }
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : 'Unknown error';
                    allErrors.push(`Failed to import "${song.title}": ${msg}`);
                    // If Convex is dead, abort the rest of the import to avoid
                    // hammering a broken connection. Local IndexedDB writes
                    // already succeeded, so data isn't lost.
                    if (msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('websocket')) {
                        allErrors.unshift(
                            'Import aborted: Convex connection lost. ' +
                            `${imported + updated} song${imported + updated === 1 ? '' : 's'} saved locally and will sync when you reconnect.`,
                        );
                        cursor = songsToImport.length;
                    }
                }
                setImportProgress(p => ({ current: p.current + 1, total: p.total }));
            }
        };

        await Promise.all(Array.from({ length: CONCURRENCY }, worker));

        if (skipped > 0) {
            allErrors.unshift(`${skipped} song${skipped === 1 ? '' : 's'} skipped (already exist by title).`);
        }
        if (updated > 0) {
            allErrors.unshift(`${updated} song${updated === 1 ? '' : 's'} replaced (lyrics/verses updated in place).`);
        }
        if (isOffline && imported > 0) {
            allErrors.unshift(`Imported ${imported} song${imported === 1 ? '' : 's'} locally — they will sync to the server when you reconnect.`);
        }

        setImportedIds(allImportedIds);
        setImportErrors(allErrors);
        setStep('complete');
    }, [selectedSongs, parsedSongs, createSong, updateSong, existingByTitle, replaceExisting, isOffline]);

    // Toggle song selection
    const toggleSong = useCallback((index: number) => {
        setSelectedSongs(prev => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    }, []);

    // Select/deselect all
    const toggleAll = useCallback((select: boolean) => {
        if (select) {
            const allValid = parsedSongs
                .map((s, i) => s.isValid ? i : -1)
                .filter(i => i >= 0);
            setSelectedSongs(new Set(allValid));
        } else {
            setSelectedSongs(new Set());
        }
    }, [parsedSongs]);

    // Stats for preview
    const stats = useMemo(() => ({
        total: parsedSongs.length,
        selected: selectedSongs.size,
        invalid: parsedSongs.filter(s => !s.isValid).length,
    }), [parsedSongs, selectedSongs]);

    // Reset wizard
    const resetWizard = useCallback(() => {
        setStep('upload');
        setFiles({});
        setParsedSongs([]);
        setSelectedSongs(new Set());
        setImportProgress({ current: 0, total: 0 });
        setImportErrors([]);
        setParseErrors([]);
    }, []);

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Import Songs from EasyWorship
                    </h2>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                            <XCircle className="w-5 h-5" />
                        </button>
                    )}
                </div>
                {/* Progress indicator */}
                <div className="flex items-center gap-2 mt-3">
                    {(['upload', 'preview', 'importing', 'complete'] as WizardStep[]).map((s, i) => (
                        <div key={s} className="flex items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step === s
                                ? 'bg-[var(--accent-teal)] text-white'
                                : i < ['upload', 'preview', 'importing', 'complete'].indexOf(step)
                                    ? 'bg-green-500 text-white'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                                }`}>
                                {i < ['upload', 'preview', 'importing', 'complete'].indexOf(step) ? (
                                    <CheckCircle className="w-4 h-4" />
                                ) : (
                                    i + 1
                                )}
                            </div>
                            {i < 3 && (
                                <div className={`w-12 h-1 mx-1 ${i < ['upload', 'preview', 'importing', 'complete'].indexOf(step)
                                    ? 'bg-green-500'
                                    : 'bg-gray-200 dark:bg-gray-700'
                                    }`} />
                            )}
                        </div>
                    ))}
                </div>
                {isOffline && (
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-200">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Offline mode — songs will be saved locally and synced when you reconnect.</span>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Step 1: Upload */}
                {step === 'upload' && (
                    <div className="space-y-6">
                        {/* Single file upload */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                                Quick Import (Single File)
                            </h3>
                            <div
                                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragging
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-gray-300 dark:border-gray-700 hover:border-blue-500'
                                    }`}
                                onClick={handleSingleFileClick}
                                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDesktop()) setIsDragging(true); }}
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDesktop()) setIsDragging(true); }}
                                onDragLeave={(e) => { e.stopPropagation(); if (!isDesktop()) setIsDragging(false); }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isDesktop()) return; // handled by Tauri onDragDropEvent listener above
                                    setIsDragging(false);
                                    const file = e.dataTransfer.files?.[0];
                                    if (file) {
                                        handleSingleFileUpload(file);
                                    }
                                }}
                            >
                                <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                                <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                                    {isDragging ? 'Drop file to import' : 'Drop EasyWorship export file here'}
                                </p>
                                <p className="text-sm text-gray-500 mt-1">
                                    or click to browse
                                </p>
                                <p className="text-xs text-gray-400 mt-3">
                                    Supports: Songs.db, SongWords.db, .xml, .csv
                                </p>
                            </div>
                        </div>

                        {/* Divider */}
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300 dark:border-gray-700" />
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white dark:bg-gray-900 text-gray-500">
                                    OR - For complete data, upload both files
                                </span>
                            </div>
                        </div>

                        {/* Multiple file upload */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                                Complete Import (Multiple Files)
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                {/* Songs.db */}
                                <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Database className="w-5 h-5 text-[var(--accent-teal)]" />
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            Songs.db
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Contains song titles, authors, copyright info
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSongsDbClick}
                                        className="block w-full px-3 py-2 text-center text-sm border border-gray-300 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                                    >
                                        {files.songsDb ? (
                                            <span className="text-green-600 dark:text-green-400">
                                                ✓ {files.songsDb.name}
                                            </span>
                                        ) : (
                                            'Select Songs.db'
                                        )}
                                    </button>
                                </div>

                                {/* SongWords.db */}
                                <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <FileStack className="w-5 h-5 text-[var(--accent-teal)]" />
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            SongWords.db
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Contains lyrics in RTF format
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSongWordsDbClick}
                                        className="block w-full px-3 py-2 text-center text-sm border border-gray-300 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                                    >
                                        {files.songWordsDb ? (
                                            <span className="text-green-600 dark:text-green-400">
                                                ✓ {files.songWordsDb.name}
                                            </span>
                                        ) : (
                                            'Select SongWords.db'
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Process button */}
                            {files.songsDb && files.songWordsDb && (
                                <button
                                    onClick={processMultipleFiles}
                                    disabled={isParsing}
                                    className="mt-4 w-full px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm"
                                >
                                    {isParsing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <FileText className="w-4 h-4" />
                                            Process Both Files
                                        </>
                                    )}
                                </button>
                            )}
                        </div>

                        {/* Parsing indicator */}
                        {isParsing && (
                            <div className="flex items-center justify-center gap-2 text-[var(--accent-teal)]">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Parsing files...</span>
                            </div>
                        )}

                        {/* Parse errors */}
                        {parseErrors.length > 0 && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                    <AlertCircle className="w-5 h-5" />
                                    <span className="font-medium">Errors</span>
                                </div>
                                <ul className="mt-2 text-sm text-red-600 dark:text-red-300 list-disc list-inside">
                                    {parseErrors.map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Instructions */}
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                                How to find EasyWorship database files:
                            </h3>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                                <li>Open EasyWorship data folder:
                                    <ul className="list-disc list-inside ml-4 mt-1">
                                        <li>Windows: <code className="text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">%DOCUMENTS%\EasyWorship\</code></li>
                                        <li>Or: <code className="text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">%APPDATA%\EasyWorship\</code></li>
                                    </ul>
                                </li>
                                <li>Look for these files:
                                    <ul className="list-disc list-inside ml-4 mt-1">
                                        <li><strong>Songs.db</strong> - Song metadata</li>
                                        <li><strong>SongWords.db</strong> - Lyrics</li>
                                    </ul>
                                </li>
                                <li>Copy both files to your computer</li>
                                <li>Upload them using the form above</li>
                            </ol>
                        </div>
                    </div>
                )}

                {/* Step 2: Preview */}
                {step === 'preview' && (
                    <div className="space-y-4">
                        {/* Stats */}
                        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <div className="flex items-center gap-2">
                                <Music className="w-5 h-5 text-[var(--accent-teal)]" />
                                <span className="font-medium">{stats.total} songs found</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                                <span>{stats.selected} selected</span>
                            </div>
                            {stats.invalid > 0 && (
                                <div className="flex items-center gap-2">
                                    <AlertCircle className="w-5 h-5 text-amber-600" />
                                    <span>{stats.invalid} need review</span>
                                </div>
                            )}
                        </div>

                        {/* Parse errors */}
                        {parseErrors.length > 0 && (
                            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                    <AlertCircle className="w-5 h-5" />
                                    <span className="font-medium">Warnings</span>
                                </div>
                                <ul className="mt-2 text-sm text-amber-600 dark:text-amber-300 list-disc list-inside">
                                    {parseErrors.map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Selection controls */}
                        <div className="flex items-center gap-4 flex-wrap">
                            <button
                                onClick={() => toggleAll(true)}
                                className="text-sm text-blue-600 hover:text-blue-700"
                            >
                                Select All
                            </button>
                            <button
                                onClick={() => toggleAll(false)}
                                className="text-sm text-gray-600 hover:text-gray-700 dark:text-gray-400"
                            >
                                Deselect All
                            </button>
                            {existingByTitle.size > 0 && (
                                <label className="flex items-center gap-2 ml-auto cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={replaceExisting}
                                        onChange={(e) => setReplaceExisting(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        Replace existing ({existingByTitle.size} match{existingByTitle.size === 1 ? '' : 'es'} by title)
                                    </span>
                                </label>
                            )}
                        </div>

                        {/* Song list */}
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
                            {parsedSongs.slice(0, 100).map((song, index) => (
                                <div
                                    key={index}
                                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${!song.isValid ? 'bg-amber-50 dark:bg-amber-900/10' : ''
                                        }`}
                                    onClick={() => toggleSong(index)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedSongs.has(index)}
                                        onChange={() => toggleSong(index)}
                                        className="w-4 h-4 rounded border-gray-300"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-white truncate">
                                            {song.title || <span className="text-amber-600">Missing title</span>}
                                        </p>
                                        <p className="text-sm text-gray-500 truncate">
                                            {song.author}
                                        </p>
                                    </div>
                                    {!song.isValid && (
                                        <span className="text-xs text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded">
                                            Review needed
                                        </span>
                                    )}
                                    {song.verses.length > 0 && (
                                        <span className="text-xs text-gray-400">
                                            {song.verses.length} verses
                                        </span>
                                    )}
                                </div>
                            ))}
                            {parsedSongs.length > 100 && (
                                <div className="p-3 text-center text-sm text-gray-500">
                                    ... and {parsedSongs.length - 100} more songs
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 3: Importing */}
                {step === 'importing' && (
                    <div className="space-y-6 py-8">
                        <div className="text-center">
                            <Loader2 className="w-12 h-12 mx-auto text-[var(--accent-teal)] animate-spin" />
                            <p className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                                Importing Songs...
                            </p>
                            <p className="text-gray-500">
                                {importProgress.current} of {importProgress.total} songs
                            </p>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                            <div
                                className="bg-[var(--accent-teal)] h-3 rounded-full transition-all"
                                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Step 4: Complete */}
                {step === 'complete' && (
                    <div className="space-y-6 py-4">
                        <div className="text-center">
                            <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                            <p className="mt-4 text-xl font-medium text-gray-900 dark:text-white">
                                Import Complete!
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                <p className="text-3xl font-bold text-green-600">
                                    {importProgress.current}
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-400">
                                    Songs Imported
                                </p>
                            </div>
                            {importErrors.length > 0 && (
                                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                                    <p className="text-3xl font-bold text-red-600">
                                        {importErrors.length}
                                    </p>
                                    <p className="text-sm text-red-700 dark:text-red-400">
                                        Errors
                                    </p>
                                </div>
                            )}
                        </div>

                        {importErrors.length > 0 && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                <p className="font-medium text-red-700 dark:text-red-400">
                                    Some errors occurred:
                                </p>
                                <ul className="mt-2 text-sm text-red-600 dark:text-red-300 list-disc list-inside max-h-32 overflow-y-auto">
                                    {importErrors.slice(0, 10).map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={resetWizard}
                                className="px-4 py-2 text-gray-600 hover:text-gray-700 dark:text-gray-400"
                            >
                                Import More
                            </button>
                            {onClose && (
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                                >
                                    Done
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            {step === 'preview' && (
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-between">
                    <button
                        onClick={resetWizard}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-700 dark:text-gray-400"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={selectedSongs.size === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                        Import {selectedSongs.size} Songs
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}

export default SongMigrationWizard;
