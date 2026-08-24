/**
 * The sermon archive — every saved recording, and what can be done with one.
 *
 * The action that justifies the whole feature is "Re-transcribe": a service
 * transcribed on a small fast model during the meeting can be redone on a large
 * one afterwards, when nobody is waiting. Everything else here (play, star,
 * delete) exists to make that one usable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
    Star,
    Trash2,
    Play,
    Pause,
    FolderOpen,
    Wand2,
    Copy,
    Check,
    Loader2,
    AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

import {
    deleteRecording,
    formatBytes,
    formatDuration,
    listRecordings,
    recordingsDir,
    retranscribe,
    type RecordingFile,
} from '../../services/sermon-listener/sessionRecordings'
import {
    deleteSermonRecordingMeta,
    getSermonRecordingMeta,
    setSermonRecordingStarred,
} from '../../hooks/useIndexedDB'
import {
    listNativeModels,
    type NativeModelStatus,
} from '../../services/sermon-listener/nativeModelManager'

/** A recording joined to whatever the operator has said about it. */
interface ArchiveRow extends RecordingFile {
    starred: boolean
}

function recordedOn(modifiedMs: number): string {
    return new Date(modifiedMs).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function SermonArchive() {
    const [rows, setRows] = useState<ArchiveRow[] | null>(null)
    const [models, setModels] = useState<NativeModelStatus[]>([])
    const [modelId, setModelId] = useState('')
    const [playing, setPlaying] = useState<string | null>(null)
    const [working, setWorking] = useState<string | null>(null)
    const [result, setResult] = useState<{ sessionId: string; text: string } | null>(null)
    const [copied, setCopied] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

    const audioRef = useRef<HTMLAudioElement | null>(null)

    const refresh = useCallback(async () => {
        const [files, meta] = await Promise.all([listRecordings(), getSermonRecordingMeta()])
        const starred = new Set(meta.filter((m) => m.starred).map((m) => m.sessionId))
        setRows(files.map((file) => ({ ...file, starred: starred.has(file.session_id) })))
    }, [])

    useEffect(() => {
        void refresh()
        void listNativeModels().then((all) => {
            const downloaded = all.filter((model) => model.is_downloaded)
            setModels(downloaded)
            // Default to the most accurate model on disk — the reason for
            // re-transcribing at all is that the live one was not good enough.
            const best = [...downloaded].sort((a, b) => b.accuracy - a.accuracy)[0]
            if (best) setModelId(best.id)
        })
    }, [refresh])

    // Never leave audio playing behind an unmount.
    useEffect(
        () => () => {
            audioRef.current?.pause()
            audioRef.current = null
        },
        [],
    )

    const togglePlay = useCallback((row: ArchiveRow) => {
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current = null
        }
        if (playing === row.session_id) {
            setPlaying(null)
            return
        }
        const audio = new Audio(convertFileSrc(row.path))
        audio.onended = () => setPlaying(null)
        audio.onerror = () => {
            setPlaying(null)
            toast.error('That recording could not be played', {
                description: 'The file may be damaged or still being written.',
            })
        }
        audioRef.current = audio
        setPlaying(row.session_id)
        void audio.play().catch(() => {
            setPlaying(null)
            audioRef.current = null
        })
    }, [playing])

    const toggleStar = useCallback(
        async (row: ArchiveRow) => {
            await setSermonRecordingStarred(row.session_id, !row.starred)
            await refresh()
        },
        [refresh],
    )

    const remove = useCallback(
        async (row: ArchiveRow) => {
            if (playing === row.session_id) {
                audioRef.current?.pause()
                audioRef.current = null
                setPlaying(null)
            }
            const ok = await deleteRecording(row.session_id)
            if (!ok) {
                toast.error('That recording could not be deleted')
                return
            }
            // Drop the metadata too, or a future recording that reuses the id
            // would inherit a stale star.
            await deleteSermonRecordingMeta(row.session_id)
            if (result?.sessionId === row.session_id) setResult(null)
            setConfirmingDelete(null)
            await refresh()
        },
        [playing, refresh, result],
    )

    const runRetranscribe = useCallback(
        async (row: ArchiveRow) => {
            if (!modelId) return
            setWorking(row.session_id)
            setResult(null)
            try {
                const out = await retranscribe(row.path, modelId)
                setResult({ sessionId: row.session_id, text: out.text })
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                toast.error('Re-transcription failed', { description: message })
            } finally {
                setWorking(null)
            }
        },
        [modelId],
    )

    const copyResult = useCallback(async () => {
        if (!result) return
        try {
            await navigator.clipboard.writeText(result.text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            toast.error('Could not copy to the clipboard')
        }
    }, [result])

    /**
     * Show where the files live.
     *
     * Not "reveal in Finder": this project has no opener plugin, and adding one
     * for a convenience button is more surface than it is worth. Copying the
     * path gets the operator to the same place — and unlike a reveal, it also
     * works when they are describing the problem to someone else over the phone.
     */
    const showFolder = useCallback(async () => {
        const dir = await recordingsDir()
        if (!dir) return
        let copiedPath = false
        try {
            await navigator.clipboard.writeText(dir)
            copiedPath = true
        } catch {
            // Fall through — the path is still worth showing.
        }
        toast.info(copiedPath ? 'Folder path copied' : 'Recordings folder', { description: dir })
    }, [])

    if (rows === null) {
        return (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading recordings…
            </div>
        )
    }

    if (rows.length === 0) {
        return (
            <div className="py-6 text-sm text-gray-500 dark:text-gray-400">
                No recordings yet. They appear here after a service that was recorded.
            </div>
        )
    }

    const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                    {rows.length} recording{rows.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        disabled={models.length === 0}
                        title="Model used when re-transcribing"
                        className="p-1.5 text-xs rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                    >
                        {models.length === 0 && <option value="">No models downloaded</option>}
                        {models.map((model) => (
                            <option key={model.id} value={model.id}>
                                {model.name}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => void showFolder()}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-[var(--accent-teal)]"
                    >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Where are these?
                    </button>
                </div>
            </div>

            <ul className="space-y-1.5">
                {rows.map((row) => {
                    const isWorking = working === row.session_id
                    const isConfirming = confirmingDelete === row.session_id
                    return (
                        <li
                            key={row.session_id}
                            className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5"
                        >
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => togglePlay(row)}
                                    title={playing === row.session_id ? 'Pause' : 'Play'}
                                    className="p-1.5 rounded-md text-gray-500 hover:text-[var(--accent-teal)]"
                                >
                                    {playing === row.session_id ? (
                                        <Pause className="w-4 h-4" />
                                    ) : (
                                        <Play className="w-4 h-4" />
                                    )}
                                </button>

                                <div className="min-w-0 flex-1">
                                    <div className="text-sm text-gray-900 dark:text-white truncate">
                                        {recordedOn(row.modified_ms)}
                                    </div>
                                    <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                                        {formatDuration(row.duration_secs)} · {formatBytes(row.bytes)}
                                        {row.duration_secs === null && (
                                            <span
                                                className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                                                title="The length could not be read — the recording may be damaged."
                                            >
                                                <AlertTriangle className="w-3 h-3" />
                                                length unknown
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <button
                                    onClick={() => void toggleStar(row)}
                                    title={
                                        row.starred
                                            ? 'Starred — never deleted automatically'
                                            : 'Star to keep this recording'
                                    }
                                    className={`p-1.5 rounded-md ${row.starred ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
                                >
                                    <Star
                                        className="w-4 h-4"
                                        fill={row.starred ? 'currentColor' : 'none'}
                                    />
                                </button>

                                <button
                                    onClick={() => void runRetranscribe(row)}
                                    disabled={isWorking || !modelId}
                                    title="Transcribe this recording again with the selected model"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-[var(--accent-teal)] disabled:opacity-40"
                                >
                                    {isWorking ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Wand2 className="w-3.5 h-3.5" />
                                    )}
                                    {isWorking ? 'Working…' : 'Re-transcribe'}
                                </button>

                                {isConfirming ? (
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => void remove(row)}
                                            className="px-2 py-1.5 text-xs rounded-lg bg-red-600 text-white"
                                        >
                                            Delete
                                        </button>
                                        <button
                                            onClick={() => setConfirmingDelete(null)}
                                            className="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setConfirmingDelete(row.session_id)}
                                        title="Delete this recording"
                                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            {isConfirming && (
                                <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                                    The audio file is removed straight away and cannot be recovered.
                                </p>
                            )}

                            {result?.sessionId === row.session_id && (
                                <div className="mt-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 p-2.5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                                            New transcript
                                        </span>
                                        <button
                                            onClick={() => void copyResult()}
                                            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[var(--accent-teal)]"
                                        >
                                            {copied ? (
                                                <Check className="w-3 h-3" />
                                            ) : (
                                                <Copy className="w-3 h-3" />
                                            )}
                                            {copied ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200 max-h-48 overflow-y-auto whitespace-pre-wrap">
                                        {result.text || 'The model produced no text for this recording.'}
                                    </p>
                                </div>
                            )}
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

export default SermonArchive
