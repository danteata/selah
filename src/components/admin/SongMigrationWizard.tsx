/**
 * Song Migration Wizard for EasyWorship Import
 * 
 * Step-by-step wizard to import songs from EasyWorship 6/7
 */

import { useState, useCallback, useMemo } from 'react';
import { Upload, FileText, Music, AlertCircle, CheckCircle, XCircle, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { parseEasyWorshipFile, toSelahSong } from '../../services/migration/easyWorshipParser';
import type { ParsedSong, MigrationStatus, EasyWorshipFileType } from '../../services/migration/types';

type WizardStep = 'upload' | 'preview' | 'importing' | 'complete';

interface MigrationWizardProps {
    onClose?: () => void;
}

export function SongMigrationWizard({ onClose }: MigrationWizardProps) {
    const [step, setStep] = useState<WizardStep>('upload');
    const [file, setFile] = useState<File | null>(null);
    const [fileType, setFileType] = useState<EasyWorshipFileType>('unknown');
    const [parsedSongs, setParsedSongs] = useState<ParsedSong[]>([]);
    const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set());
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [importedIds, setImportedIds] = useState<string[]>([]);

    const importSongsBatch = useMutation(api.migration.importSongsBatch);
    // Note: checkDuplicates is called dynamically via useConvex().query when needed

    // Get church ID from user context (simplified - would come from auth)
    const churchId = useQuery(api.songs.getAllSongsForUser, {}) as any;
    const userId = 'current-user'; // Would come from auth

    // Handle file drop
    const handleFileDrop = useCallback(async (droppedFile: File) => {
        setFile(droppedFile);
        setStep('upload');
        setParseErrors([]);

        try {
            const result = await parseEasyWorshipFile(droppedFile);
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
        }
    }, []);

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
                                ? 'bg-blue-600 text-white'
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
                        <div
                            className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center cursor-pointer hover:border-blue-500 transition-colors"
                            onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = '.db,.sqlite,.sqlite3,.xml,.csv';
                                input.onchange = (e) => {
                                    const files = (e.target as HTMLInputElement).files;
                                    if (files?.[0]) {
                                        handleFileDrop(files[0]);
                                    }
                                };
                                input.click();
                            }}
                        >
                            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                            <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                                Drop EasyWorship export file here
                            </p>
                            <p className="text-sm text-gray-500 mt-2">
                                or click to browse
                            </p>
                            <p className="text-xs text-gray-400 mt-4">
                                Supports: Songs.db (SQLite), .xml, .csv
                            </p>
                        </div>

                        {file && (
                            <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                <FileText className="w-5 h-5 text-blue-600" />
                                <div>
                                    <p className="font-medium text-blue-900 dark:text-blue-100">
                                        {file.name}
                                    </p>
                                    <p className="text-sm text-blue-600 dark:text-blue-400">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB • {fileType.toUpperCase()}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Instructions */}
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                                How to export from EasyWorship:
                            </h3>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                                <li>Open EasyWorship</li>
                                <li>Go to Songs library</li>
                                <li>Select songs to export (Ctrl+A for all)</li>
                                <li>Right-click → Export → XML or CSV</li>
                                <li>Or copy Songs.db from EasyWorship data folder</li>
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
                                <Music className="w-5 h-5 text-blue-600" />
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
                            <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin" />
                            <p className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                                Importing Songs...
                            </p>
                            <p className="text-gray-500">
                                {importProgress.current} of {importProgress.total} songs
                            </p>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                            <div
                                className="bg-blue-600 h-3 rounded-full transition-all"
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
                                onClick={() => {
                                    // Reset wizard
                                    setStep('upload');
                                    setFile(null);
                                    setParsedSongs([]);
                                    setSelectedSongs(new Set());
                                    setImportProgress({ current: 0, total: 0 });
                                    setImportErrors([]);
                                }}
                                className="px-4 py-2 text-gray-600 hover:text-gray-700 dark:text-gray-400"
                            >
                                Import More
                            </button>
                            {onClose && (
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
                        onClick={() => setStep('upload')}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-700 dark:text-gray-400"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={selectedSongs.size === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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