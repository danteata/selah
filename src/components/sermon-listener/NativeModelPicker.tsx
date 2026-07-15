import { useEffect, useState, useCallback } from 'react'
import { Check, Download, Loader2, X, Cpu, Globe, Languages, Trash2, Star, Zap } from 'lucide-react'
import {
    listNativeModels,
    downloadNativeModel,
    cancelNativeDownload,
    deleteNativeModel,
    onDownloadProgress,
    formatModelSize,
    languageLabel,
    type NativeModelStatus,
} from '../../services/sermon-listener/nativeModelManager'

interface NativeModelPickerProps {
    /** Currently selected model id. */
    selectedId: string
    /** Called when the user selects a downloaded model. */
    onSelect: (modelId: string) => void
}

interface ProgressState {
    downloaded: number
    total: number | null
    error?: string | null
}

/** A tiny 0–1 score bar (accuracy / speed). */
function ScoreBar({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[10px] w-12 text-gray-400 dark:text-gray-500">{label}</span>
            <div className="h-1 w-16 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full bg-[var(--accent-teal)]" style={{ width: `${Math.round(value * 100)}%` }} />
            </div>
        </div>
    )
}

/**
 * Lists the native transcription model catalog (from Rust) with download/select
 * controls, live progress, accuracy/speed bars, language + translation badges,
 * and delete. Whisper = GGUF (GPU); Parakeet/Canary/Cohere/SenseVoice/etc = ONNX.
 */
export function NativeModelPicker({ selectedId, onSelect }: NativeModelPickerProps) {
    const [models, setModels] = useState<NativeModelStatus[]>([])
    const [progress, setProgress] = useState<Record<string, ProgressState>>({})
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        setModels(await listNativeModels())
        setLoading(false)
    }, [])

    useEffect(() => {
        refresh()
        const unsubscribe = onDownloadProgress((p) => {
            setProgress((prev) => ({
                ...prev,
                [p.model_id]: { downloaded: p.downloaded, total: p.total, error: p.error },
            }))
            if (p.done || p.error) {
                setProgress((prev) => {
                    const next = { ...prev }
                    delete next[p.model_id]
                    return next
                })
                refresh()
            }
        })
        return unsubscribe
    }, [refresh])

    const handleDownload = useCallback(async (modelId: string) => {
        setProgress((prev) => ({ ...prev, [modelId]: { downloaded: 0, total: null } }))
        try {
            await downloadNativeModel(modelId)
        } catch (err) {
            setProgress((prev) => ({
                ...prev,
                [modelId]: { downloaded: 0, total: null, error: err instanceof Error ? err.message : String(err) },
            }))
        }
    }, [])

    const handleDelete = useCallback(async (modelId: string) => {
        try {
            await deleteNativeModel(modelId)
        } catch (err) {
            console.warn('[NativeModelPicker] delete failed:', err)
        }
        refresh()
    }, [refresh])

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading models…
            </div>
        )
    }

    if (models.length === 0) {
        return (
            <p className="text-xs text-gray-500 dark:text-gray-400">
                Native models are only available in the desktop app.
            </p>
        )
    }

    // Downloaded first, then by accuracy.
    const sorted = [...models].sort((a, b) =>
        Number(b.is_downloaded) - Number(a.is_downloaded) || b.accuracy - a.accuracy,
    )

    return (
        <div className="space-y-2">
            {sorted.map((m) => {
                const isSelected = m.id === selectedId
                const prog = progress[m.id]
                const isDownloading = !!prog || m.is_downloading
                const pct = prog?.total ? Math.round((prog.downloaded / prog.total) * 100) : null

                return (
                    <div
                        key={m.id}
                        className={`p-2.5 rounded-lg border transition-all ${isSelected
                            ? 'border-[var(--accent-teal)] bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm text-gray-900 dark:text-white">{m.name}</span>
                                    {isSelected && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-teal)] text-white">Active</span>
                                    )}
                                    {m.recommended && !isSelected && (
                                        <span className="text-[10px] text-amber-500 flex items-center gap-0.5"><Star className="w-3 h-3" /> recommended</span>
                                    )}
                                </div>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{m.description}</div>
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center gap-1">
                                        {m.languages.length === 1 && m.languages[0] === 'en'
                                            ? <Cpu className="w-3 h-3" />
                                            : <Globe className="w-3 h-3" />}
                                        {languageLabel(m)}
                                    </span>
                                    {m.supports_translation && (
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5">
                                            <Languages className="w-3 h-3" /> translate
                                        </span>
                                    )}
                                    {m.supports_streaming && (
                                        <span className="text-[10px] text-[var(--accent-teal)] flex items-center gap-0.5" title="See text as you speak">
                                            <Zap className="w-3 h-3" /> live
                                        </span>
                                    )}
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatModelSize(m.size_bytes)}</span>
                                </div>
                                {prog?.error && <div className="text-[11px] text-red-500 mt-1">{prog.error}</div>}
                                {isDownloading && (
                                    <div className="mt-1.5 h-1 w-full rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                        <div className="h-full bg-[var(--accent-teal)] transition-all" style={{ width: pct != null ? `${pct}%` : '100%' }} />
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <ScoreBar label="accuracy" value={m.accuracy} />
                                <ScoreBar label="speed" value={m.speed} />
                            </div>

                            <div className="flex-shrink-0 w-20 text-right">
                                {isDownloading ? (
                                    <button onClick={() => cancelNativeDownload(m.id)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-500" title="Cancel">
                                        {pct != null ? `${pct}%` : <Loader2 className="w-4 h-4 animate-spin" />} <X className="w-3.5 h-3.5" />
                                    </button>
                                ) : m.is_downloaded ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                        <button
                                            onClick={() => onSelect(m.id)}
                                            disabled={isSelected}
                                            className={`text-xs px-2 py-1 rounded ${isSelected ? 'text-[var(--accent-teal)]' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                        >
                                            {isSelected ? <Check className="w-3.5 h-3.5" /> : 'Select'}
                                        </button>
                                        {!m.bundled && (
                                            <button onClick={() => handleDelete(m.id)} className="text-gray-400 hover:text-red-500" title="Delete download">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <button onClick={() => handleDownload(m.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--accent-teal)] hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Download">
                                        <Download className="w-3.5 h-3.5" /> Get
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default NativeModelPicker
