/**
 * Dev-only accuracy report generator.
 *
 * Given a session recorded by `sessionAudioRecorder`, re-transcribes its
 * saved audio offline with a bigger/more-accurate model than realtime
 * affords, extracts a "ground truth" verse list from that transcript, and
 * diffs it against what the live detector actually flagged for the same
 * session — surfacing missed verses (false negatives) and wrongly-flagged
 * verses (false positives) to guide manual threshold tuning in
 * `src/lib/semanticRetrievalPolicy.ts` / `verseDetection.ts`.
 *
 * Entirely local/offline: no Convex round-trip. The "ground truth" and the
 * "live" side are correlated purely by a session id + a JSON sidecar file
 * written next to the recording, not by any server-side record.
 */
import { invoke } from '@tauri-apps/api/core'
import { readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { detectVerses, type DetectedVerse } from './verseDetection'

const RECORDINGS_DIR = 'dev-sermon-recordings'

export interface SessionSidecar {
    sessionId: string
    startedAt: number
    stoppedAt: number
    liveDetectedVerses: DetectedVerse[]
    rawUtterances: Array<{ text: string; timestamp: number; confidence?: number }>
}

async function recordingsDir(): Promise<string> {
    return join(await appDataDir(), RECORDINGS_DIR)
}

/** Write the sidecar JSON for a just-finished session, next to its `.wav`. */
export async function writeSessionSidecar(sidecar: SessionSidecar): Promise<void> {
    if (!import.meta.env.DEV) return
    const dir = await recordingsDir()
    const path = await join(dir, `${sidecar.sessionId}.json`)
    await writeTextFile(path, JSON.stringify(sidecar, null, 2))
}

export interface RecordingSummary {
    sessionId: string
    startedAt: number
    stoppedAt: number
    verseCount: number
}

/** List recordings that have a sidecar (i.e. a session that was properly stopped), most recent first. */
export async function listRecentRecordings(): Promise<RecordingSummary[]> {
    if (!import.meta.env.DEV) return []

    const dir = await recordingsDir()
    let entries: Awaited<ReturnType<typeof readDir>>
    try {
        entries = await readDir(dir)
    } catch {
        return []
    }

    const summaries: RecordingSummary[] = []
    for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith('.json')) continue
        const sessionId = entry.name.replace(/\.json$/, '')
        try {
            const raw = await readTextFile(await join(dir, entry.name))
            const sidecar = JSON.parse(raw) as SessionSidecar
            summaries.push({
                sessionId,
                startedAt: sidecar.startedAt,
                stoppedAt: sidecar.stoppedAt,
                verseCount: sidecar.liveDetectedVerses.length,
            })
        } catch {
            // Corrupt or unreadable sidecar — skip it.
        }
    }

    summaries.sort((a, b) => b.startedAt - a.startedAt)
    return summaries
}

interface DiffEntry {
    reference: string
    confidence?: string
}

export interface AccuracyReport {
    sessionId: string
    modelId: string
    groundTruthText: string
    /** In the offline ground-truth pass but not flagged live. */
    missed: DiffEntry[]
    /** Flagged live but not supported by the offline ground-truth pass. */
    falsePositives: DiffEntry[]
    /** Confirmed by both passes. */
    matched: string[]
}

/**
 * Re-transcribe `sessionId`'s saved recording with `modelId` (typically a
 * bigger model than realtime uses), extract ground-truth verses, diff
 * against the session's live-detected verses, and write a Markdown report
 * next to the recording.
 */
export async function generateAccuracyReport(sessionId: string, modelId: string): Promise<AccuracyReport> {
    const dir = await recordingsDir()
    const wavPath = await join(dir, `${sessionId}.wav`)
    const jsonPath = await join(dir, `${sessionId}.json`)

    const groundTruthText = await invoke<string>('transcribe_audio_file', {
        filePath: wavPath,
        modelId,
    })
    const groundTruthVerses = detectVerses(groundTruthText)

    const sidecarRaw = await readTextFile(jsonPath)
    const sidecar = JSON.parse(sidecarRaw) as SessionSidecar

    const groundTruthRefs = new Set(groundTruthVerses.map((v) => v.reference))
    const liveRefs = new Set(sidecar.liveDetectedVerses.map((v) => v.reference))

    const missed: DiffEntry[] = groundTruthVerses
        .filter((v) => !liveRefs.has(v.reference))
        .map((v) => ({ reference: v.reference, confidence: v.confidence }))

    const falsePositives: DiffEntry[] = sidecar.liveDetectedVerses
        .filter((v) => !groundTruthRefs.has(v.reference))
        .map((v) => ({ reference: v.reference, confidence: v.confidence }))

    const matched = sidecar.liveDetectedVerses
        .filter((v) => groundTruthRefs.has(v.reference))
        .map((v) => v.reference)

    const report: AccuracyReport = {
        sessionId,
        modelId,
        groundTruthText,
        missed,
        falsePositives,
        matched,
    }

    const reportPath = await join(dir, `${sessionId}-report.md`)
    await writeTextFile(reportPath, renderMarkdownReport(report))

    return report
}

function renderMarkdownReport(report: AccuracyReport): string {
    const lines: string[] = []
    lines.push(`# Accuracy report — session ${report.sessionId}`)
    lines.push('')
    lines.push(`Ground-truth model: \`${report.modelId}\``)
    lines.push('')
    lines.push(`## Missed — in ground truth, not detected live (${report.missed.length})`)
    if (report.missed.length === 0) {
        lines.push('_None._')
    } else {
        for (const m of report.missed) {
            lines.push(`- **${m.reference}**${m.confidence ? ` — would be \`${m.confidence}\` confidence` : ''}`)
        }
    }
    lines.push('')
    lines.push(`## False positives — detected live, not in ground truth (${report.falsePositives.length})`)
    if (report.falsePositives.length === 0) {
        lines.push('_None._')
    } else {
        for (const f of report.falsePositives) {
            lines.push(`- **${f.reference}** — was \`${f.confidence ?? 'unknown'}\` confidence live`)
        }
    }
    lines.push('')
    lines.push(`## Matched (${report.matched.length})`)
    if (report.matched.length === 0) {
        lines.push('_None._')
    } else {
        for (const r of report.matched) lines.push(`- ${r}`)
    }
    lines.push('')
    lines.push('## Ground-truth transcript')
    lines.push('')
    lines.push('```')
    lines.push(report.groundTruthText)
    lines.push('```')
    return lines.join('\n')
}
