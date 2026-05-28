/**
 * Transcript Export Utilities
 *
 * Converts timestamped transcript segments into various export formats.
 * Requires TranscriptSegment[] with sermon-relative timestamps.
 */

import type { TranscriptSegment } from '../../types/sermon-listener'

export interface TranscriptMeta {
    title: string
    date: string
    provider: string
    language?: string
    durationMs?: number
}

/**
 * Format milliseconds as HH:MM:SS.mmm (for SRT/VTT)
 */
function formatTimestamp(ms: number, alwaysIncludeHours = false, decimalMarker: ',' | '.' = ','): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const milliseconds = ms % 1000

    const hh = String(hours).padStart(2, '0')
    const mm = String(minutes).padStart(2, '0')
    const ss = String(seconds).padStart(2, '0')
    const mmm = String(milliseconds).padStart(3, '0')

    if (alwaysIncludeHours || hours > 0) {
        return `${hh}:${mm}:${ss}${decimalMarker}${mmm}`
    }
    return `${mm}:${ss}${decimalMarker}${mmm}`
}

/**
 * Export as plain text with optional verse references inline.
 */
export function exportAsText(
    segments: TranscriptSegment[],
    _meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; startMs?: number; endMs?: number }>
): string {
    const lines = segments.map(s => s.text)
    let text = lines.join(' ')

    if (detectedVerses && detectedVerses.length > 0) {
        text += '\n\n--- Detected Verses ---\n'
        text += detectedVerses.map(v => `- ${v.reference}`).join('\n')
    }

    return text
}

/**
 * Export as SRT subtitle format.
 * Properly formatted with sequential numbering, comma decimal, and HH:MM:SS,mmm timestamps.
 */
export function exportAsSrt(
    segments: TranscriptSegment[],
    _meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; startMs?: number; endMs?: number }>
): string {
    const entries: string[] = []

    let index = 1
    for (const seg of segments) {
        if (!seg.text.trim()) continue
        const start = formatTimestamp(seg.startMs, true, ',')
        const end = formatTimestamp(seg.endMs, true, ',')
        entries.push(`${index}\n${start} --> ${end}\n${seg.text.trim()}\n`)
        index++
    }

    // Add detected verses as subtitle cues
    if (detectedVerses) {
        for (const verse of detectedVerses) {
            if (verse.startMs !== undefined && verse.endMs !== undefined) {
                const start = formatTimestamp(verse.startMs, true, ',')
                const end = formatTimestamp(verse.endMs, true, ',')
                entries.push(`${index}\n${start} --> ${end}\n[${verse.reference}]\n`)
                index++
            }
        }
    }

    return entries.join('\n')
}

/**
 * Export as WebVTT format.
 * Includes the required WEBVTT header (fixes Vibe's bug of omitting it).
 * Uses period decimal separator per spec.
 */
export function exportAsVtt(
    segments: TranscriptSegment[],
    _meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; startMs?: number; endMs?: number }>
): string {
    const lines: string[] = ['WEBVTT', '']

    let cueId = 1
    for (const seg of segments) {
        if (!seg.text.trim()) continue
        const start = formatTimestamp(seg.startMs, true, '.')
        const end = formatTimestamp(seg.endMs, true, '.')
        lines.push(`${cueId}`)
        lines.push(`${start} --> ${end}`)
        lines.push(seg.text.trim())
        lines.push('')
        cueId++
    }

    // Add detected verses as subtitle cues
    if (detectedVerses) {
        for (const verse of detectedVerses) {
            if (verse.startMs !== undefined && verse.endMs !== undefined) {
                const start = formatTimestamp(verse.startMs, true, '.')
                const end = formatTimestamp(verse.endMs, true, '.')
                lines.push(`${cueId}`)
                lines.push(`${start} --> ${end}`)
                lines.push(`[${verse.reference}]`)
                lines.push('')
                cueId++
            }
        }
    }

    return lines.join('\n')
}

/**
 * Export as JSON with full segment and verse data.
 */
export function exportAsJson(
    segments: TranscriptSegment[],
    meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; book?: string; chapter?: number; verseStart?: number; verseEnd?: number; confidence?: string; startMs?: number; endMs?: number }>
): string {
    return JSON.stringify({
        title: meta.title,
        date: meta.date,
        provider: meta.provider,
        language: meta.language,
        durationMs: meta.durationMs,
        segments: segments.map(s => ({
            id: s.id,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
            source: s.source,
            confidence: s.confidence,
            speaker: s.speaker,
        })),
        detectedVerses: detectedVerses || [],
    }, null, 2)
}

/**
 * Export transcript in the specified format.
 */
export type ExportFormat = 'txt' | 'srt' | 'vtt' | 'json'

export function exportTranscript(
    format: ExportFormat,
    segments: TranscriptSegment[],
    meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; book?: string; chapter?: number; verseStart?: number; verseEnd?: number; confidence?: string; startMs?: number; endMs?: number }>
): string {
    const verses = detectedVerses?.map(v => ({
        reference: v.reference,
        startMs: v.startMs,
        endMs: v.endMs,
    }))

    switch (format) {
        case 'txt':
            return exportAsText(segments, meta, verses)
        case 'srt':
            return exportAsSrt(segments, meta, verses)
        case 'vtt':
            return exportAsVtt(segments, meta, verses)
        case 'json':
            return exportAsJson(segments, meta, detectedVerses?.map(v => ({
                reference: v.reference,
                book: v.book,
                chapter: v.chapter,
                verseStart: v.verseStart,
                verseEnd: v.verseEnd,
                confidence: v.confidence,
                startMs: v.startMs,
                endMs: v.endMs,
            })))
        default:
            return exportAsText(segments, meta, verses)
    }
}

/**
 * Download exported transcript as a file.
 */
export function downloadTranscript(
    format: ExportFormat,
    segments: TranscriptSegment[],
    meta: TranscriptMeta,
    detectedVerses?: Array<{ reference: string; book?: string; chapter?: number; verseStart?: number; verseEnd?: number; confidence?: string; startMs?: number; endMs?: number }>
): void {
    const content = exportTranscript(format, segments, meta, detectedVerses)
    const mimeTypes: Record<ExportFormat, string> = {
        txt: 'text/plain',
        srt: 'application/x-subrip',
        vtt: 'text/vtt',
        json: 'application/json',
    }
    const extensions: Record<ExportFormat, string> = {
        txt: '.txt',
        srt: '.srt',
        vtt: '.vtt',
        json: '.json',
    }

    const blob = new Blob([content], { type: mimeTypes[format] })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${meta.title.replace(/[^a-zA-Z0-9]/g, '_')}_${meta.date.split('T')[0]}${extensions[format]}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}