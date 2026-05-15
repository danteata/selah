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

import { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, Music, AlertCircle, CheckCircle, XCircle, ChevronRight, ChevronLeft, Loader2, Database, FileStack } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { parseEasyWorshipFile, parseEasyWorshipDatabases, toSelahSong } from '../../services/migration/easyWorshipParser';
import type { ParsedSong, MigrationStatus, EasyWorshipFileType } from '../../services/migration/types';
import { openFileDialog } from '../../utils/fileDialog';

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

    const importSongsBatch = useMutation(api.migration.importSongsBatch);

    // Get church ID from user context
    const churchId = useQuery(api.songs.getAllSongsForUser, {}) as any;
    const userId = 'current-user'; // Would come from auth

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

    // Handle import
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

        // Import in batches of 50
        const BATCH_SIZE = 50;
        const batches = [];
        for (let i = 0; i < songsToImport.length; i += BATCH_SIZE) {
            batches.push(songsToImport.slice(i, i + BATCH_SIZE));
        }

        let totalImported = 0;
        const allImportedIds: string[] = [];
        const allErrors: string[] = [];

        for (const batch of batches) {
            try {
                const result = await importSongsBatch({
                    songs: batch,
                    churchId: churchId?.[0]?.churchId || 'default',
                    createdBy: userId,
                });

                totalImported += result.success;
                allImportedIds.push(...result.importedIds);
                allErrors.push(...result.errors);

                setImportProgress({
                    current: totalImported,
                    total: songsToImport.length,
                });
            } catch (error) {
                allErrors.push(`Batch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        setImportedIds(allImportedIds);
        setImportErrors(allErrors);
        setStep('complete');
    }, [selectedSongs, parsedSongs, importSongsBatch, churchId]);

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
                                className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
                                onClick={handleSingleFileClick}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const file = e.dataTransfer.files?.[0];
                                    if (file) {
                                        handleSingleFileUpload(file);
                                    }
                                }}
                            >
                                <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                                <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                                    Drop EasyWorship export file here
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
                        <div className="flex items-center gap-4">
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
