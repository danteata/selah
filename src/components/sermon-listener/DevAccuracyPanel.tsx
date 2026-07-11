/**
 * Dev-only accuracy review panel.
 *
 * Lists the last few sermon-listener sessions recorded to disk (see
 * `sessionAudioRecorder.ts`) and lets a developer re-transcribe one offline
 * with a bigger/more-accurate model, then diff the result against what the
 * live detector actually flagged — surfacing missed verses and false
 * positives to guide manual threshold tuning. Not rendered in production
 * builds (the parent only mounts this when `import.meta.env.DEV`).
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
    generateAccuracyReport,
    listRecentRecordings,
    type AccuracyReport,
    type RecordingSummary,
} from '../../services/sermon-listener/devAccuracyReport'

// Bigger/slower models than realtime uses, per the native model catalog
// (src-tauri/src/transcription/models.rs) — must already be downloaded via
// the regular Sermon Listener Settings model manager.
const GROUND_TRUTH_MODEL_OPTIONS = [
    { id: 'medium', label: 'Whisper Medium' },
    { id: 'turbo', label: 'Whisper Turbo' },
    { id: 'large', label: 'Whisper Large (most accurate)' },
]

interface DevAccuracyPanelProps {
    /** Bumped by the parent each time a session's sidecar finishes writing,
     * so the list refreshes even if the panel was already expanded when the
     * recording completed (not just when it's newly expanded). */
    refreshSignal?: number
}

export function DevAccuracyPanel({ refreshSignal }: DevAccuracyPanelProps) {
    const [expanded, setExpanded] = useState(false)
    const [recordings, setRecordings] = useState<RecordingSummary[]>([])
    const [modelId, setModelId] = useState(GROUND_TRUTH_MODEL_OPTIONS[2].id)
    const [runningSessionId, setRunningSessionId] = useState<string | null>(null)
    const [reports, setReports] = useState<Record<string, AccuracyReport>>({})

    const refresh = () => {
        listRecentRecordings()
            .then(setRecordings)
            .catch((err) => console.warn('[DevAccuracyPanel] Failed to list recordings:', err))
    }

    useEffect(() => {
        if (expanded) refresh()
        // Also re-fetch (while expanded) whenever a new session finishes
        // recording, not just when the panel is first expanded.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded, refreshSignal])

    const handleCompare = async (sessionId: string) => {
        setRunningSessionId(sessionId)
        try {
            const report = await generateAccuracyReport(sessionId, modelId)
            setReports((prev) => ({ ...prev, [sessionId]: report }))
            toast.success(`Report ready: ${report.missed.length} missed, ${report.falsePositives.length} false positives`)
        } catch (err) {
            console.error('[DevAccuracyPanel] Failed to generate report:', err)
            toast.error(err instanceof Error ? err.message : 'Failed to generate accuracy report')
        } finally {
            setRunningSessionId(null)
        }
    }

    return (
        <div className="rounded-lg border border-dashed border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs">
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center justify-between font-medium text-amber-700 dark:text-amber-400"
            >
                <span>Dev: Accuracy Review</span>
                <span>{expanded ? '−' : '+'}</span>
            </button>

            {expanded && (
                <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                        <label className="text-gray-600 dark:text-gray-400">Ground-truth model:</label>
                        <select
                            value={modelId}
                            onChange={(e) => setModelId(e.target.value)}
                            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-1 py-0.5"
                        >
                            {GROUND_TRUTH_MODEL_OPTIONS.map((m) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                        </select>
                        <button onClick={refresh} className="ml-auto text-amber-700 dark:text-amber-400 underline">
                            Refresh
                        </button>
                    </div>

                    {recordings.length === 0 && (
                        <p className="text-gray-500 dark:text-gray-400">No recorded sessions yet — start/stop listening to create one.</p>
                    )}

                    {recordings.map((r) => {
                        const report = reports[r.sessionId]
                        return (
                            <div key={r.sessionId} className="rounded border border-gray-200 dark:border-gray-700 p-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                        {new Date(r.startedAt).toLocaleString()}
                                    </span>
                                    <span className="text-gray-500 dark:text-gray-400">{r.verseCount} live verse{r.verseCount === 1 ? '' : 's'}</span>
                                    <button
                                        onClick={() => void handleCompare(r.sessionId)}
                                        disabled={runningSessionId === r.sessionId}
                                        className="ml-auto px-2 py-0.5 rounded bg-amber-500 hover:brightness-110 text-white disabled:opacity-50"
                                    >
                                        {runningSessionId === r.sessionId ? 'Re-transcribing…' : 'Re-transcribe & Compare'}
                                    </button>
                                </div>

                                {report && (
                                    <div className="mt-1.5 space-y-1">
                                        <p className="text-red-600 dark:text-red-400">
                                            Missed ({report.missed.length}): {report.missed.map((m) => m.reference).join(', ') || 'none'}
                                        </p>
                                        <p className="text-orange-600 dark:text-orange-400">
                                            False positives ({report.falsePositives.length}): {report.falsePositives.map((f) => f.reference).join(', ') || 'none'}
                                        </p>
                                        <p className="text-green-600 dark:text-green-400">
                                            Matched ({report.matched.length}): {report.matched.join(', ') || 'none'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
