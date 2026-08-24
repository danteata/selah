/**
 * The sermon archive: recordings on disk, and the policy that decides which
 * ones survive.
 *
 * Why the audio is kept at all: a transcript can be wrong in ways nobody
 * notices until later — the wrong mic was selected, the band bled into the
 * vocal aux, the model struggled with an accent. Text alone cannot be fixed
 * after the fact. The audio can be re-transcribed with a better model, but only
 * if it still exists.
 *
 * ## Recording is off until a church turns it on
 *
 * This records a room, not a person: congregational prayer, a testimony,
 * someone's child. That is different in kind from the few seconds of your own
 * voice a dictation tool captures, so nothing here happens by default, the
 * files never leave the machine, and deleting a session deletes its audio for
 * real. See `plan/dictation-mode-and-distribution.md` §5.3.
 *
 * ## Retention lives here, not in Rust
 *
 * Rust owns the files; this owns the policy. It has to, because the policy
 * depends on which sessions the operator starred, and that lives in IndexedDB
 * alongside the transcript. Rust cannot see it.
 */
import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '../../platform'

/** Mirrors Rust `RecordingFile`. */
export interface RecordingFile {
    session_id: string
    path: string
    bytes: number
    modified_ms: number
    /** Null when the header could not be parsed — truncated or in progress. */
    duration_secs: number | null
}

/**
 * How long recordings are kept.
 *
 * Shapes taken from Handy, which has had these in front of real users:
 * an explicit "keep everything", a count cap, and three durations. A church
 * that wants last month's sermons and a church that wants none of them are
 * both normal.
 */
export type RetentionPolicy =
    | 'never'          // keep everything — the operator manages it themselves
    | 'last10'
    | 'days30'
    | 'months3'
    | 'months12'

export const DEFAULT_RETENTION: RetentionPolicy = 'months3'

/** Every policy, in the order the settings dropdown should offer them. */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
    'days30',
    'months3',
    'months12',
    'last10',
    'never',
] as const

const DAY_MS = 24 * 60 * 60 * 1000

/** Maximum age in ms, or null when the policy is not age-based. */
function maxAgeMs(policy: RetentionPolicy): number | null {
    switch (policy) {
        case 'days30':
            return 30 * DAY_MS
        case 'months3':
            return 90 * DAY_MS
        case 'months12':
            return 365 * DAY_MS
        default:
            return null
    }
}

/** Maximum count, or null when the policy is not count-based. */
function maxCount(policy: RetentionPolicy): number | null {
    return policy === 'last10' ? 10 : null
}

export function describeRetention(policy: RetentionPolicy): string {
    switch (policy) {
        case 'never':
            return 'Keep until I delete them'
        case 'last10':
            // Says "unstarred" because starred recordings are exempt from the
            // cap entirely — without that word the count reads as a total, and
            // an operator with twelve starred sermons would expect to have lost
            // two of them.
            return 'Keep the 10 most recent unstarred'
        case 'days30':
            return 'Delete after 30 days'
        case 'months3':
            return 'Delete after 3 months'
        case 'months12':
            return 'Delete after a year'
    }
}

// --- disk ------------------------------------------------------------------

export async function startRecording(sessionId: string): Promise<string | null> {
    if (!isDesktop()) return null
    try {
        return await invoke<string>('start_sermon_recording', { sessionId })
    } catch (err) {
        // A failed recording must never take the service down with it. The
        // listener carries on; the operator loses the archive for this session
        // only, and the caller surfaces that.
        console.error('[recordings] could not start:', err)
        return null
    }
}

export async function stopRecording(): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('stop_sermon_recording')
    } catch (err) {
        console.warn('[recordings] could not stop cleanly:', err)
    }
}

export async function listRecordings(): Promise<RecordingFile[]> {
    if (!isDesktop()) return []
    try {
        return await invoke<RecordingFile[]>('list_sermon_recordings')
    } catch (err) {
        console.warn('[recordings] could not list:', err)
        return []
    }
}

export async function deleteRecording(sessionId: string): Promise<boolean> {
    if (!isDesktop()) return false
    try {
        await invoke('delete_sermon_recording', { sessionId })
        return true
    } catch (err) {
        console.warn(`[recordings] could not delete ${sessionId}:`, err)
        return false
    }
}

export async function recordingsDir(): Promise<string | null> {
    if (!isDesktop()) return null
    try {
        return await invoke<string>('sermon_recordings_dir')
    } catch {
        return null
    }
}

// --- retention --------------------------------------------------------------

export interface SweepResult {
    deleted: string[]
    /** Bytes reclaimed, by the size the files reported before deletion. */
    freedBytes: number
}

/**
 * Apply the retention policy, sparing anything starred.
 *
 * `now` is injectable so the age arithmetic is testable without waiting three
 * months. `starred` is the set of session ids the operator marked to keep —
 * they are exempt from both the age and the count rule, which is the whole
 * point of starring: retention is for the services nobody chose to keep, and a
 * sweep that quietly removed the one sermon someone deliberately saved would be
 * the worst possible behaviour for this feature.
 */
export async function sweepRetention(
    policy: RetentionPolicy,
    starred: ReadonlySet<string>,
    now: number = Date.now(),
): Promise<SweepResult> {
    const result: SweepResult = { deleted: [], freedBytes: 0 }
    if (policy === 'never') return result

    const all = await listRecordings()
    // `listRecordings` returns newest first; keep that order for the count rule.
    const candidates = all.filter((file) => !starred.has(file.session_id))

    const doomed = new Map<string, RecordingFile>()

    const age = maxAgeMs(policy)
    if (age !== null) {
        for (const file of candidates) {
            if (now - file.modified_ms > age) doomed.set(file.session_id, file)
        }
    }

    const count = maxCount(policy)
    if (count !== null) {
        // The cap counts starred recordings as occupying no slot: an operator
        // who stars twelve sermons should keep twelve, not lose the unstarred
        // ones and then start losing starred ones too.
        for (const file of candidates.slice(count)) {
            doomed.set(file.session_id, file)
        }
    }

    for (const file of doomed.values()) {
        if (await deleteRecording(file.session_id)) {
            result.deleted.push(file.session_id)
            result.freedBytes += file.bytes
        }
    }

    return result
}

/** "1.4 GB", "312 MB" — for the settings panel's disk-usage line. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** "48 min", "1 h 12 min" — recording lengths read as durations, not seconds. */
export function formatDuration(seconds: number | null): string {
    if (seconds === null || !isFinite(seconds) || seconds <= 0) return '—'
    const total = Math.round(seconds)
    // Under a minute reads as seconds — rounding 30 s up to "1 min" is wrong in
    // the one range where the exact number is the informative part (a recording
    // that captured almost nothing).
    if (total < 60) return `${total} s`

    let hours = Math.floor(total / 3600)
    let minutes = Math.round((total % 3600) / 60)
    // 3599 s rounds to 60 minutes; carry it rather than printing "60 min".
    if (minutes === 60) {
        hours += 1
        minutes = 0
    }
    return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`
}

/**
 * Run the retention sweep once, at app start.
 *
 * At start rather than after each service, for the reason the dev recorder
 * already prunes at start: a session that ends by the app being force-quit
 * never reaches its own cleanup, so tying the sweep to the end of a recording
 * means a crash wedges retention forever. Doing it on the way up means the
 * next launch always tidies, whatever happened last time.
 *
 * Silent by design. Deleting a recording the operator never starred, under a
 * policy they chose, is not news — and a toast about it during service setup
 * would be noise at the worst moment.
 */
export async function runRetentionOnStartup(
    enabled: boolean,
    policy: RetentionPolicy,
    starred: ReadonlySet<string>,
): Promise<SweepResult | null> {
    if (!enabled || !isDesktop()) return null
    try {
        const result = await sweepRetention(policy, starred)
        if (result.deleted.length > 0) {
            console.info(
                `[recordings] retention removed ${result.deleted.length} recording(s), ` +
                    `${formatBytes(result.freedBytes)} reclaimed`
            )
        }
        return result
    } catch (err) {
        // Retention failing must never stop the app starting.
        console.warn('[recordings] retention sweep failed:', err)
        return null
    }
}
