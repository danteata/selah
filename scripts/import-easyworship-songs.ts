/**
 * Offline bulk importer: EasyWorship (Songs.db + SongWords.db) → structured
 * Selah songs with `sections` + `defaultArrangement` for the predictive lyric
 * tracker (Phase 1).
 *
 * Reuses the app's existing, tested RTF pipeline
 * (`src/services/migration/rtfParser.ts`) plus the new section deriver
 * (`src/lib/songSections.ts`) so this script and the in-app SongMigrationWizard
 * produce identical structure.
 *
 * Run with Bun (native TS + bundled SQLite):
 *   bun run scripts/import-easyworship-songs.ts \
 *       [--songs Songs.db] [--words SongWords.db] [--out path.json] [--limit N]
 *
 * Writes a JSON array of structured songs and prints coverage stats. By default
 * it writes to the scratchpad so the repo stays clean; pass --out to persist.
 */
import { Database } from 'bun:sqlite'
import { extractVerseStructureFromRTF, parseRTF } from '../src/services/migration/rtfParser'
import { deriveSongStructure } from '../src/lib/songSections'
import type { SongSection } from '../src/types'

interface Args {
    songsDb: string
    wordsDb: string
    out: string
    limit: number
    compact: boolean
}

function parseArgs(): Args {
    const argv = process.argv.slice(2)
    const get = (flag: string, fallback: string) => {
        const i = argv.indexOf(flag)
        return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
    }
    return {
        songsDb: get('--songs', 'Songs.db'),
        wordsDb: get('--words', 'SongWords.db'),
        out: get('--out', '/tmp/easyworship-structured.json'),
        limit: parseInt(get('--limit', '0'), 10) || 0,
        // --compact emits the minimal shape the in-app seeder needs; lyrics and
        // verses are reconstructed from `sections` at seed time to save bytes.
        compact: argv.includes('--compact'),
    }
}

interface Metadata {
    title: string
    author: string
    copyright?: string
    ccli?: string
    tags?: string
}

interface StructuredSong {
    sourceId: number
    title: string
    artist: string
    author: string
    lyrics: string
    verses: string[]
    sections: SongSection[]
    defaultArrangement: string[]
    copyright?: string
    ccli?: string
}

function loadMetadata(songsDb: string): Map<number, Metadata> {
    const db = new Database(songsDb, { readonly: true })
    const rows = db
        .query(
            'SELECT rowid, title, author, copyright, reference_number, tags FROM song',
        )
        .all() as Array<{
            rowid: number
            title: string | null
            author: string | null
            copyright: string | null
            reference_number: string | null
            tags: string | null
        }>
    db.close()

    const map = new Map<number, Metadata>()
    for (const r of rows) {
        map.set(r.rowid, {
            title: (r.title ?? '').trim() || `Song ${r.rowid}`,
            author: (r.author ?? '').trim() || 'Unknown',
            copyright: r.copyright ?? undefined,
            ccli: r.reference_number ?? undefined,
            tags: r.tags ?? undefined,
        })
    }
    return map
}

function main() {
    const args = parseArgs()
    console.log(`Reading ${args.songsDb} + ${args.wordsDb} ...`)

    const metadata = loadMetadata(args.songsDb)
    console.log(`Loaded metadata for ${metadata.size} songs.`)

    const wordsDb = new Database(args.wordsDb, { readonly: true })
    let query = 'SELECT song_id, words FROM word'
    if (args.limit > 0) query += ` LIMIT ${args.limit}`
    const wordRows = wordsDb.query(query).all() as Array<{
        song_id: number
        words: string | null
    }>
    wordsDb.close()

    const songs: StructuredSong[] = []
    const stats = {
        total: 0,
        empty: 0,
        multiSection: 0,
        singleSection: 0,
        withChorus: 0,
        rtfResidue: 0,
        sectionHistogram: {} as Record<string, number>,
    }

    for (const row of wordRows) {
        stats.total++
        const rtf = row.words ?? ''
        if (!rtf.trim()) {
            stats.empty++
            continue
        }

        const meta = metadata.get(row.song_id)
        const plainLyrics = parseRTF(rtf).trim()
        const labeledBlocks = extractVerseStructureFromRTF(rtf)
        const { sections, defaultArrangement } = deriveSongStructure(plainLyrics, labeledBlocks)

        if (sections.length === 0) {
            stats.empty++
            continue
        }

        // Flatten sections back into a canonical lyrics string so the freeform
        // representation and the structured one always agree.
        const lyrics = sections.map((s) => s.lines.join('\n')).join('\n\n')

        songs.push({
            sourceId: row.song_id,
            title: meta?.title ?? `Song ${row.song_id}`,
            artist: meta?.author ?? 'Unknown',
            author: meta?.author ?? 'Unknown',
            lyrics,
            verses: sections.map((s) => s.lines.join('\n')),
            sections,
            defaultArrangement,
            copyright: meta?.copyright,
            ccli: meta?.ccli,
        })

        // Stats
        if (sections.length > 1) stats.multiSection++
        else stats.singleSection++
        if (sections.some((s) => s.type === 'chorus')) stats.withChorus++
        if (/\\[a-z]+\d*/i.test(lyrics)) stats.rtfResidue++
        const bucket = sections.length >= 6 ? '6+' : String(sections.length)
        stats.sectionHistogram[bucket] = (stats.sectionHistogram[bucket] ?? 0) + 1
    }

    if (args.compact) {
        // Minimal, seeder-friendly shape. `s` = sections, `a` = arrangement.
        // Keys are short because this ships as a bundled asset over the wire.
        const compact = {
            version: 1,
            source: 'easyworship',
            songs: songs.map((s) => ({
                id: `ew_${s.sourceId}`,
                title: s.title,
                artist: s.artist,
                author: s.author,
                sections: s.sections,
                defaultArrangement: s.defaultArrangement,
            })),
        }
        Bun.write(args.out, JSON.stringify(compact))
    } else {
        Bun.write(args.out, JSON.stringify(songs, null, 2))
    }

    console.log('\n=== Import summary ===')
    console.log(`Songs processed:      ${stats.total}`)
    console.log(`Structured songs:     ${songs.length}`)
    console.log(`Empty / unparseable:  ${stats.empty}`)
    console.log(`Multi-section:        ${stats.multiSection}`)
    console.log(`Single-section:       ${stats.singleSection}`)
    console.log(`With a chorus:        ${stats.withChorus}`)
    console.log(`⚠ RTF residue in out: ${stats.rtfResidue}`)
    console.log(`Section-count buckets:`, stats.sectionHistogram)
    console.log(`\nWrote ${songs.length} songs → ${args.out}`)

    // Show a couple of samples for eyeballing.
    for (const sample of songs.slice(0, 2)) {
        console.log(`\n--- ${sample.title} (${sample.artist}) ---`)
        for (const s of sample.sections) {
            console.log(`  [${s.id}] ${s.label}: ${s.lines[0]?.slice(0, 40) ?? ''}...`)
        }
        console.log(`  arrangement: ${sample.defaultArrangement.join(' → ')}`)
    }
}

main()
