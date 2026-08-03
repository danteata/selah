import type { SongSection, SongSectionType } from '../types'

/**
 * Parse a freeform lyrics string into structured {@link SongSection}s.
 *
 * This is the shared core used both by content importers (e.g. the
 * EasyWorship RTF importer) and, later, by the arrangement editor UI and the
 * predictive lyric tracker. It is intentionally pure and dependency-free so it
 * can run in the browser, in a worker, and in a Node import script.
 *
 * Strategy:
 *  1. Split the lyrics into blocks on blank lines (one block ≈ one section),
 *     matching the existing `useSong` splitting behaviour so results line up
 *     with how songs are already sliced today.
 *  2. If a block's first line is a section label ("Chorus", "Verse 2",
 *     "Bridge", "[Verse 1]", "V1", "PreChorus", ...), consume it as the label
 *     and classify the type from it.
 *  3. Otherwise infer: the first unlabelled block is the intro/verse, repeated
 *     identical blocks are treated as choruses, and everything else falls back
 *     to sequential verses.
 *
 * The freeform `lyrics` string remains the source of truth; sections are an
 * additive projection of it.
 */

// Matches an explicit section label line, with optional brackets and number.
// Examples: "Chorus", "Verse 1", "V2", "Pre-Chorus", "[Bridge]", "Tag:",
// "Refrain", "Intro", "Outro", "Ending".
const LABEL_LINE = /^\s*[[(]?\s*(intro|verse|v|prechorus|pre-chorus|pre chorus|chorus|refrain|bridge|tag|outro|ending|end|coda|interlude|instrumental|vamp)\s*[-.]?\s*(\d+)?\s*[)\]]?\s*[:.]?\s*$/i

const LABEL_ALIASES: Record<string, SongSectionType> = {
    intro: 'intro',
    verse: 'verse',
    v: 'verse',
    prechorus: 'prechorus',
    'pre-chorus': 'prechorus',
    'pre chorus': 'prechorus',
    chorus: 'chorus',
    refrain: 'chorus',
    bridge: 'bridge',
    tag: 'tag',
    coda: 'tag',
    outro: 'ending',
    ending: 'ending',
    end: 'ending',
    interlude: 'other',
    instrumental: 'other',
    vamp: 'other',
}

const TYPE_PREFIX: Record<SongSectionType, string> = {
    verse: 'v',
    chorus: 'c',
    prechorus: 'p',
    bridge: 'b',
    tag: 't',
    intro: 'i',
    ending: 'e',
    other: 'o',
}

interface ParsedLabel {
    type: SongSectionType
    number?: number
}

/** Parse a single line as a section label, or return null if it isn't one. */
export function parseSectionLabel(line: string): ParsedLabel | null {
    const match = LABEL_LINE.exec(line)
    if (!match) return null
    const key = match[1].toLowerCase().replace(/\s+/g, ' ')
    const type = LABEL_ALIASES[key] ?? 'other'
    const number = match[2] ? parseInt(match[2], 10) : undefined
    return { type, number }
}

/** Normalize a block's text for equality comparison (chorus detection). */
function fingerprint(lines: string[]): string {
    return lines
        .join('\n')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

interface RawBlock {
    label: ParsedLabel | null
    lines: string[]
}

/** Split lyrics into blocks on blank lines, extracting any leading label. */
function splitBlocks(lyrics: string): RawBlock[] {
    const normalized = lyrics.replace(/\r\n?/g, '\n')
    const blocks: RawBlock[] = []

    for (const raw of normalized.split(/\n\s*\n/)) {
        const lines = raw.split('\n').map((l) => l.trim())
        // Drop leading/trailing empty lines within the block.
        while (lines.length && lines[0] === '') lines.shift()
        while (lines.length && lines[lines.length - 1] === '') lines.pop()
        if (lines.length === 0) continue

        // A block may carry its label on the first line.
        const label = parseSectionLabel(lines[0])
        const body = label ? lines.slice(1).filter((l) => l !== '') : lines.filter((l) => l !== '')

        // A label with no body (e.g. a standalone "Chorus" marker) still counts
        // as a section boundary but produces no lines; skip empty bodies unless
        // there was no label at all.
        if (body.length === 0) continue

        blocks.push({ label, lines: body })
    }

    return blocks
}

function humanLabel(type: SongSectionType, number?: number): string {
    const base: Record<SongSectionType, string> = {
        verse: 'Verse',
        chorus: 'Chorus',
        prechorus: 'Pre-Chorus',
        bridge: 'Bridge',
        tag: 'Tag',
        intro: 'Intro',
        ending: 'Ending',
        other: 'Section',
    }
    return number ? `${base[type]} ${number}` : base[type]
}

/**
 * Parse freeform lyrics into ordered, id'd sections.
 *
 * @param lyrics Raw lyrics text (already RTF-stripped if from EasyWorship).
 * @returns Ordered sections. Empty array for empty/whitespace-only input.
 */
export function parseLyricsIntoSections(lyrics: string): SongSection[] {
    if (!lyrics || !lyrics.trim()) return []

    const blocks = splitBlocks(lyrics)
    if (blocks.length === 0) return []

    // First pass: detect repeated blocks (likely choruses) when unlabelled.
    const seen = new Map<string, number>()
    for (const block of blocks) {
        const fp = fingerprint(block.lines)
        seen.set(fp, (seen.get(fp) ?? 0) + 1)
    }

    const sections: SongSection[] = []
    // Per-type running counter for auto-numbering and id generation.
    const typeCount: Partial<Record<SongSectionType, number>> = {}
    // Remember the id assigned to a given block fingerprint so a repeated
    // chorus reuses the same section id (an arrangement references it twice).
    const fpToId = new Map<string, string>()

    let index = 0
    for (const block of blocks) {
        const fp = fingerprint(block.lines)

        // A repeat of an already-emitted block: don't create a duplicate
        // section, just skip (the arrangement layer handles repeats).
        if (fpToId.has(fp)) {
            index++
            continue
        }

        let type: SongSectionType
        let explicitNumber: number | undefined

        if (block.label) {
            type = block.label.type
            explicitNumber = block.label.number
        } else if ((seen.get(fp) ?? 0) > 1) {
            // Unlabelled but repeated => treat as chorus.
            type = 'chorus'
        } else if (index === 0) {
            // First unlabelled block is a verse (intro markers are explicit).
            type = 'verse'
        } else {
            type = 'verse'
        }

        typeCount[type] = (typeCount[type] ?? 0) + 1
        const number = explicitNumber ?? typeCount[type]!
        const id = `${TYPE_PREFIX[type]}${number}`

        sections.push({
            id,
            type,
            number,
            label: humanLabel(type, number),
            lines: block.lines,
        })
        fpToId.set(fp, id)
        index++
    }

    // Second pass: drop the ordinal from labels for types that occur only once
    // ("Chorus" reads better than "Chorus 1"; "Verse 1"/"Verse 2" keep theirs).
    const finalCount: Partial<Record<SongSectionType, number>> = {}
    for (const s of sections) finalCount[s.type] = (finalCount[s.type] ?? 0) + 1
    for (const s of sections) {
        if ((finalCount[s.type] ?? 0) <= 1) {
            s.label = humanLabel(s.type)
        }
    }

    return sections
}

/**
 * Derive structured sections + a default arrangement for a song.
 *
 * Prefers the labelled block structure produced by the EasyWorship RTF parser
 * (`extractVerseStructureFromRTF`, which already merges multi-slide choruses
 * and reads explicit "Verse 1"/"Chorus" markers) when available, and falls
 * back to parsing the freeform `lyrics` string directly.
 *
 * The labelled blocks are reprojected into a synthetic labelled lyrics string
 * and run back through {@link parseLyricsIntoSections} so that id assignment,
 * numbering, and repeated-chorus collapsing all follow one code path.
 *
 * @param lyrics       Plain (RTF-stripped) lyrics — always the fallback source.
 * @param labeledBlocks Optional `{label, content}[]` from the migration parser.
 */
export function deriveSongStructure(
    lyrics: string,
    labeledBlocks?: { label: string; content: string }[],
): { sections: SongSection[]; defaultArrangement: string[] } {
    const usableBlocks = labeledBlocks?.filter((b) => b.content.trim())

    let sections: SongSection[]
    if (usableBlocks && usableBlocks.length > 0) {
        const synthetic = usableBlocks
            .map((b) => (b.label.trim() ? `${b.label.trim()}\n` : '') + b.content.trim())
            .join('\n\n')
        sections = parseLyricsIntoSections(synthetic)
    } else {
        sections = parseLyricsIntoSections(lyrics)
    }

    return { sections, defaultArrangement: buildDefaultArrangement(sections) }
}

/**
 * Build a default arrangement (play order) from parsed sections.
 *
 * Without external cues we can only reproduce the order the sections appear in
 * the source, so this simply lists each section id once. Repeated choruses in
 * the source are collapsed by {@link parseLyricsIntoSections}, so a smarter
 * arrangement (V1 C V2 C ...) is left to the operator / importer heuristics.
 */
export function buildDefaultArrangement(sections: SongSection[]): string[] {
    return sections.map((s) => s.id)
}

/**
 * The structured sections of a song, deriving them from its lyrics when it has
 * none stored.
 *
 * `Song.sections` is documented as optional and additive — plenty of the
 * library predates it, and importers that only ever produced `lyrics`/`verses`
 * still do. But the song tracker and the song identifier both read
 * `song.sections` directly and treat its absence as "not a song I can work
 * with": the identifier indexes nothing for it, so auto-detect can never name
 * it, and the tracker filters its slides out, so `songTracking.status.songId`
 * stays null and the auto-advance control does not even render. The operator
 * sees a song sitting live with no controls and no explanation.
 *
 * Deriving on read closes that gap without a migration or a schema change, and
 * without touching what is stored: `lyrics` remains the source of truth and
 * sections stay a projection of it.
 */
export function sectionsForSong(song: {
    sections?: SongSection[]
    lyrics?: string
    verses?: string[]
}): SongSection[] {
    if (song.sections && song.sections.length > 0) return song.sections

    const cached = derivedSections.get(song)
    if (cached) return cached

    // `verses` is the already-split form the slide builders use; falling back
    // to it keeps derived sections aligned with the slides the operator can
    // actually see, and blank-line-joining reproduces the block structure
    // parseLyricsIntoSections expects.
    const source = song.lyrics?.trim() ? song.lyrics : (song.verses ?? []).join('\n\n')
    const sections = source.trim() ? parseLyricsIntoSections(source) : []
    derivedSections.set(song, sections)
    return sections
}

/** Derivation is pure and a song object is stable for as long as it is held,
 *  so results are cached against it — the identifier rebuilds its index over
 *  the whole library and would otherwise reparse every song's lyrics. */
const derivedSections = new WeakMap<object, SongSection[]>()
