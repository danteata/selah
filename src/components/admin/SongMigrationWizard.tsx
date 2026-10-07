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
import type { ParsedSong } from '../../services/migration/types';
import { openFileDialog, filePathsToFiles } from '../../utils/fileDialog';
import { useSongs, type ImportedSong } from '../../hooks/useSongs';
import { useConvexConnection } from '../../providers/ConvexConnectionProvider';
import { isDesktop } from '../../platform';
import { nonSongReason } from '../../lib/songLibraryFilter';
import { useSongSyncStatus } from '../../hooks/useSongLibrarySync';
import { requestSongSync } from '../../services/songs/songSync';

type WizardStep = 'upload' | 'preview' | 'importing' | 'complete';

/**
 * Whether a parsed entry reads as a song. EasyWorship libraries also hold
 * sermon outlines, prayer points and announcements; those start unticked so
 * they don't go to the church's shared library unless someone ticks them.
 */
function looksLikeSong(song: ParsedSong): boolean {
    return nonSongReason(toSelahSong(song)) === null;
}

/** "Saved here; N waiting to sync" with a Sync now button. */
export function SongSyncStatusLine() {
    const { pending, syncing, lastError } = useSongSyncStatus();
    const { isOffline } = useConvexConnection();
    let text: string;
    if (syncing) text = `Syncing to your church library… ${pending} left`;
    else if (pending === 0) text = 'Everything is in your church library.';
    else if (isOffline) text = `${pending} song${pending === 1 ? '' : 's'} will sync to your church library when you're back online.`;
    else if (lastError) text = `${pending} song${pending === 1 ? '' : 's'} couldn't sync yet (${lastError}).`;
    else text = `${pending} song${pending === 1 ? '' : 's'} waiting to sync to your church library.`;
    return (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">
            <span className="text-gray-600 dark:text-gray-300 flex items-center gap-2">
                {syncing && <Loader2 className="w-4 h-4 animate-spin" />}
                {text}
            </span>
            {pending > 0 && !syncing && !isOffline && (
                <button
                    type="button"
                    onClick={requestSongSync}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap"
                >
                    Sync now
                </button>
            )}
        </div>
    );
}

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
    const [parsedSongs, setParsedSongs] = useState<ParsedSong[]>([]);
    const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set());
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const [importErrors, setImportErrors] = useState<string[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const { importSongs, songs: existingSongs } = useSongs();
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

    // Handle single file upload
    const handleSingleFileUpload = useCallback(async (file: File) => {
        setIsParsing(true);
        setFiles({ singleFile: file });
        setParseErrors([]);

        try {
            const result = await parseEasyWorshipFile(file);
            setParsedSongs(result.songs);
            setParseErrors(result.errors);

            // Select all valid songs by default
            const validIndices = result.songs
                .map((s, i) => s.isValid && looksLikeSong(s) ? i : -1)
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
    const addFilesRef = useRef<(incoming: File[]) => void>(() => {});

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
                        .then((droppedFiles) => addFilesRef.current(droppedFiles))
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
        setParseErrors([]);

        try {
            const songs = await parseEasyWorshipDatabases({ songsDb, songWordsDb });
            setParsedSongs(songs);

            // Select all valid songs by default
            const validIndices = songs
                .map((s, i) => s.isValid && looksLikeSong(s) ? i : -1)
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

    // Route whatever arrives — dropped together or chosen one at a time — to
    // the right slot by name (EasyWorship always names them Songs.db and
    // SongWords.db). An .xml or .csv export is a whole library on its own.
    // Reading starts as soon as SongWords.db is here alongside Songs.db.
    const addFiles = useCallback((incoming: File[]) => {
        if (incoming.length === 0) return;
        const single = incoming.find((f) => /\.(xml|csv)$/i.test(f.name));
        if (single) {
            handleSingleFileUpload(single);
            return;
        }
        const next = { songsDb: files.songsDb, songWordsDb: files.songWordsDb };
        const unknown: string[] = [];
        for (const file of incoming) {
            const name = file.name.toLowerCase();
            if (name.includes('songwords')) next.songWordsDb = file;
            else if (/^songs?\b/.test(name) && /\.(db|sqlite3?)$/.test(name)) next.songsDb = file;
            else unknown.push(file.name);
        }
        setFiles(next);
        setParseErrors(unknown.length > 0
            ? [`Not an EasyWorship song file: ${unknown.join(', ')}. Expected Songs.db and SongWords.db.`]
            : []);
        if (next.songsDb && next.songWordsDb) {
            void handleMultipleFilesUpload(next.songsDb, next.songWordsDb);
        }
    }, [files.songsDb, files.songWordsDb, handleSingleFileUpload, handleMultipleFilesUpload]);
    addFilesRef.current = addFiles;

    const chooseFiles = useCallback(async (accept: string, multiple: boolean) => {
        try {
            const chosen = await openFileDialog({ multiple, accept });
            if (chosen && chosen.length > 0) addFiles(chosen);
        } catch (error) {
            console.error('Error selecting file:', error);
        }
    }, [addFiles]);

    // SongWords.db alone still has every lyric; only the titles come from
    // Songs.db, so allow importing without it (titles read "Song 123").
    const importLyricsOnly = useCallback(() => {
        if (files.songWordsDb) void handleSingleFileUpload(files.songWordsDb);
    }, [files.songWordsDb, handleSingleFileUpload]);

    // Import to this device in one write. Songs are marked for upload and
    // useSongLibrarySync sends them to the church library in batches whenever
    // the app is online — instead of one server call per song, which also
    // made every device re-download the whole library after each one.
    //
    // With "Replace existing", a song whose title is already in the library
    // is updated in place (its id kept, so service orders that use it stay
    // valid); otherwise it is skipped.
    const handleImport = useCallback(async () => {
        if (selectedSongs.size === 0) return;

        setStep('importing');
        setImportProgress({ current: 0, total: selectedSongs.size });
        setImportErrors([]);

        const songsToImport = Array.from(selectedSongs)
            .map(i => parsedSongs[i])
            .filter(Boolean)
            .map(toSelahSong);

        const items: ImportedSong[] = [];
        const seenTitles = new Set<string>();
        let skipped = 0;
        for (const song of songsToImport) {
            const titleKey = song.title.toLowerCase().trim();
            const existingId = existingByTitle.get(titleKey);
            // A library can list one title twice; import it once.
            if ((existingId && !replaceExisting) || seenTitles.has(titleKey)) {
                skipped++;
                continue;
            }
            seenTitles.add(titleKey);
            items.push({
                replaceId: existingId,
                data: {
                    title: song.title,
                    artist: song.artist || song.author || 'Unknown',
                    lyrics: song.lyrics,
                    verses: song.verses,
                    sections: song.sections,
                    defaultArrangement: song.defaultArrangement,
                    author: song.author,
                },
            });
        }

        const messages: string[] = [];
        try {
            const { created, updated } = await importSongs(items);
            setImportProgress({ current: created + updated, total: selectedSongs.size });
            if (updated > 0) messages.push(`${updated} song${updated === 1 ? '' : 's'} replaced in place.`);
        } catch (error) {
            messages.push(`Import failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        if (skipped > 0) {
            messages.push(`${skipped} song${skipped === 1 ? '' : 's'} skipped (already in your library).`);
        }
        setImportErrors(messages);
        setStep('complete');
    }, [selectedSongs, parsedSongs, importSongs, existingByTitle, replaceExisting]);

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
                        <SongSyncStatusLine />

                        {/* One drop zone for everything: both database files at
                            once, one at a time, or a single .xml / .csv export. */}
                        <div
                            role="button"
                            tabIndex={0}
                            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragging
                                ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/10'
                                : 'border-gray-300 dark:border-gray-700 hover:border-[var(--accent-teal)]'
                                }`}
                            onClick={() => void chooseFiles('.db,.sqlite,.sqlite3,.xml,.csv', true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    void chooseFiles('.db,.sqlite,.sqlite3,.xml,.csv', true);
                                }
                            }}
                            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDesktop()) setIsDragging(true); }}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDesktop()) setIsDragging(true); }}
                            onDragLeave={(e) => { e.stopPropagation(); if (!isDesktop()) setIsDragging(false); }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (isDesktop()) return; // handled by the Tauri onDragDropEvent listener above
                                setIsDragging(false);
                                addFiles(Array.from(e.dataTransfer.files ?? []));
                            }}
                        >
                            <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-[var(--accent-teal)]' : 'text-gray-400'}`} />
                            <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                                {isDragging ? 'Drop to add' : 'Drop Songs.db and SongWords.db here'}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                                or click to choose them — both at once, or one at a time
                            </p>
                            <p className="text-xs text-gray-400 mt-3">
                                An EasyWorship .xml or .csv export works too
                            </p>
                        </div>

                        {/* What has been added so far */}
                        <div className="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
                            {([
                                { key: 'songWordsDb', name: 'SongWords.db', what: 'The lyrics', icon: FileStack },
                                { key: 'songsDb', name: 'Songs.db', what: 'Titles, authors and copyright', icon: Database },
                            ] as const).map(({ key, name, what, icon: Icon }) => {
                                const file = files[key];
                                return (
                                    <div key={key} className="flex items-center gap-3 px-4 py-3">
                                        <Icon className="w-5 h-5 text-[var(--accent-teal)] flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{name}</p>
                                            <p className="text-xs text-gray-500 truncate">
                                                {file ? <span className="text-green-600 dark:text-green-400">✓ {file.name}</span> : what}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void chooseFiles('.db,.sqlite,.sqlite3', false)}
                                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                                        >
                                            {file ? 'Change' : 'Choose…'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {files.songWordsDb && !files.songsDb && !isParsing && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Add Songs.db for song titles, or{' '}
                                <button type="button" onClick={importLyricsOnly} className="text-[var(--accent-teal)] hover:underline">
                                    import the lyrics without titles
                                </button>.
                            </p>
                        )}
                        {files.songsDb && !files.songWordsDb && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Now add SongWords.db — it holds the lyrics.
                            </p>
                        )}
                        {files.songsDb && files.songWordsDb && !isParsing && parseErrors.length > 0 && (
                            <button
                                onClick={() => void handleMultipleFilesUpload(files.songsDb!, files.songWordsDb!)}
                                className="w-full px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 flex items-center justify-center gap-2"
                            >
                                <FileText className="w-4 h-4" />
                                Try again
                            </button>
                        )}

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
                                Where EasyWorship keeps them
                            </h3>
                            <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                                <li>Close EasyWorship on the computer that runs it.</li>
                                <li>
                                    Open this folder (EasyWorship 6 and 7):
                                    <code className="block mt-1 ml-4 text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-1 rounded break-all">
                                        C:\Users\Public\Documents\Softouch\EasyWorship\Default\v6.1\Databases\Data
                                    </code>
                                    <span className="block ml-4 mt-1 text-xs">
                                        If you use a profile other than Default, replace <code>Default</code> with its name.
                                    </span>
                                </li>
                                <li>Copy <strong>Songs.db</strong> and <strong>SongWords.db</strong> (a USB stick or cloud folder is fine if Selah is on another computer).</li>
                                <li>Drop both here. Songs you already have can be replaced on the next step.</li>
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

                        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                            <p className="text-3xl font-bold text-green-600">
                                {importProgress.current}
                            </p>
                            <p className="text-sm text-green-700 dark:text-green-400">
                                Songs saved on this computer
                            </p>
                        </div>

                        <SongSyncStatusLine />

                        {importErrors.length > 0 && (
                            <ul className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-300 list-disc list-inside space-y-1">
                                {importErrors.map((note, i) => (
                                    <li key={i} className={note.startsWith('Import failed') ? 'text-red-600 dark:text-red-400' : undefined}>
                                        {note}
                                    </li>
                                ))}
                            </ul>
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
