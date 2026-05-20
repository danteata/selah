#!/usr/bin/env node
/**
 * Build a prebuilt verse embedding pack for the desktop bundle.
 *
 * Why this exists
 * ---------------
 * First-run semantic search currently has to embed the entire KJV (31k+
 * verses) on the user's CPU. That takes 1-2 minutes on a fast laptop and
 * 5-8 minutes on the kind of machine a small church actually owns. Worse,
 * if the user kills the app mid-sync they start from zero.
 *
 * This script generates the same embeddings *once*, on the developer's
 * machine, and ships them inside the app as a binary asset. On first
 * launch the runtime just memory-maps the file into a Float32Array and
 * hands it to the similarity worker — instant search, zero CPU, fully
 * offline.
 *
 * Usage
 * -----
 *   node scripts/build-embedding-pack.mjs --version KJV \
 *     [--url https://example.com/bibles/kjv.json] \
 *     [--out src-tauri/assets/embedding-packs/KJV] \
 *     [--batch 64]
 *
 * If `--url` is omitted the script tries common public sources in order
 * (see `KNOWN_SOURCES` below). The KJV source is committed as the
 * canonical reference; for new versions, supply `--url` explicitly.
 *
 * Output (under `--out`):
 *   manifest.json        — { version, dim, count, modelName, builtAt }
 *   metadata.json        — array of verse metadata (no embeddings)
 *   embeddings.f32       — flat Float32 buffer (count × dim × 4 bytes)
 *
 * The runtime loader is `src/services/sermon-listener/embeddingPackLoader.ts`.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
    options: {
        version: { type: 'string', default: 'KJV' },
        url: { type: 'string' },
        out: { type: 'string' },
        batch: { type: 'string', default: '64' },
        model: { type: 'string', default: 'Xenova/all-MiniLM-L6-v2' },
    },
})

const VERSION = args.version
const BATCH = parseInt(args.batch, 10) || 64
const MODEL_NAME = args.model
const OUT_DIR = args.out
    ? (args.out.startsWith('/') ? args.out : join(REPO_ROOT, args.out))
    : join(REPO_ROOT, 'src-tauri', 'assets', 'embedding-packs', VERSION)

// ---------------------------------------------------------------------------
// Bible source resolution
// ---------------------------------------------------------------------------

const BOOK_TO_NUMBER = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14, 'Ezra': 15,
    'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19, 'Proverbs': 20,
    'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25,
    'Ezekiel': 26, 'Daniel': 27, 'Hosea': 28, 'Joel': 29, 'Amos': 30,
    'Obadiah': 31, 'Jonah': 32, 'Micah': 33, 'Nahum': 34, 'Habakkuk': 35,
    'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38, 'Malachi': 39,
    'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
    'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47, 'Galatians': 48, 'Ephesians': 49,
    'Philippians': 50, 'Colossians': 51, '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54,
    '2 Timothy': 55, 'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59,
    '1 Peter': 60, '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64,
    'Jude': 65, 'Revelation': 66,
}
const NUMBER_TO_BOOK = Object.fromEntries(Object.entries(BOOK_TO_NUMBER).map(([k, v]) => [v, k]))

/**
 * Known public sources to try when no `--url` is provided. Each entry is a
 * URL plus a normaliser that maps the raw payload to the canonical
 * `{ book, chapter, verse, scripture }` shape that `embeddingSyncManager`
 * already consumes at runtime.
 */
const KNOWN_SOURCES = {
    KJV: [
        {
            url: 'https://cdn.jsdelivr.net/gh/bibleapi/bibleapi-bibles-json@master/kjv.json',
            normalise: (raw) => {
                // The bibleapi format: { resultset: { row: { "0": { field: [id, book, chapter, verse, text] }, ... } } }
                let rows
                if (raw.resultset?.row) {
                    rows = Object.values(raw.resultset.row)
                } else if (Array.isArray(raw)) {
                    rows = raw
                } else if (raw.data) {
                    rows = Array.isArray(raw.data) ? raw.data : Object.values(raw.data)
                } else {
                    rows = Object.values(raw)
                }

                return rows.map((r) => {
                    if (r.field && Array.isArray(r.field)) {
                        const [, bookNum, chapter, verse, text] = r.field
                        const bookName = NUMBER_TO_BOOK[bookNum] || String(bookNum)
                        return { book: bookName, chapter: String(chapter), verse: String(verse), scripture: text }
                    }
                    return { book: r.book_name ?? r.book, chapter: String(r.chapter), verse: String(r.verse), scripture: r.text ?? r.scripture }
                })
            },
        },
    ],
}

async function fetchVerses(versionId, explicitUrl) {
    if (explicitUrl) {
        console.log(`[fetch] ${explicitUrl}`)
        const res = await fetch(explicitUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${explicitUrl}`)
        const raw = await res.json()
        if (!Array.isArray(raw)) throw new Error('Expected JSON array')
        return raw.map((r) => ({
            book: r.book_name ?? r.book,
            chapter: String(r.chapter),
            verse: String(r.verse),
            scripture: r.text ?? r.scripture,
        }))
    }
    const candidates = KNOWN_SOURCES[versionId] || []
    if (candidates.length === 0) {
        throw new Error(
            `No known source for version "${versionId}". Pass --url to specify one.`,
        )
    }
    let lastErr
    for (const source of candidates) {
        try {
            console.log(`[fetch] ${source.url}`)
            const res = await fetch(source.url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const raw = await res.json()
            return source.normalise(raw)
        } catch (err) {
            console.warn(`  ✗ ${err.message}`)
            lastErr = err
        }
    }
    throw new Error(`All known sources for ${versionId} failed: ${lastErr?.message}`)
}

// ---------------------------------------------------------------------------
// Embedding model
// ---------------------------------------------------------------------------

async function loadEmbedder() {
    console.log(`[model] loading ${MODEL_NAME} (this downloads ~22 MB on first run)…`)
    // @xenova/transformers is already a dependency of the app for runtime
    // use in the browser. Node 20+ ships fetch + URL globals which the
    // package needs.
    const { pipeline, env } = await import('@xenova/transformers')

    // Prefer the locally-bundled model files if available — the desktop
    // prebuild step downloads them into `src-tauri/assets/embedding-models/`.
    const localDir = join(REPO_ROOT, 'src-tauri', 'assets', 'embedding-models')
    if (existsSync(join(localDir, MODEL_NAME))) {
        env.allowLocalModels = true
        env.localModelPath = localDir
        env.allowRemoteModels = false
        console.log(`  using local model dir: ${localDir}`)
    } else {
        env.allowLocalModels = false
        env.allowRemoteModels = true
        console.log('  using remote model (HuggingFace Hub)')
    }
    return pipeline('feature-extraction', MODEL_NAME, { quantized: true })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const start = Date.now()

    const verses = await fetchVerses(VERSION, args.url)
    console.log(`[fetch] got ${verses.length} verses`)

    const embedder = await loadEmbedder()
    // Sniff dimension from one inference.
    const probe = await embedder('hello', { pooling: 'mean', normalize: true })
    const dim = probe.data.length
    console.log(`[model] ready, dim=${dim}`)

    const count = verses.length
    const packed = new Float32Array(count * dim)
    const metadata = new Array(count)

    let done = 0
    for (let i = 0; i < count; i += BATCH) {
        const slice = verses.slice(i, i + BATCH)
        const texts = slice.map((v) => v.scripture.trim())
        const tensor = await embedder(texts, { pooling: 'mean', normalize: true })

        // transformers.js returns a single concatenated Tensor of shape (batch, dim).
        const flat = tensor.data
        for (let b = 0; b < slice.length; b++) {
            const off = (i + b) * dim
            for (let d = 0; d < dim; d++) {
                packed[off + d] = flat[b * dim + d]
            }

            const v = slice[b]
            let bookNumber
            let bookName
            const parsedBook = parseInt(v.book, 10)
            if (!isNaN(parsedBook)) {
                bookNumber = parsedBook
                bookName = NUMBER_TO_BOOK[bookNumber] || v.book
            } else {
                bookNumber = BOOK_TO_NUMBER[v.book] ?? 0
                bookName = v.book
            }
            metadata[i + b] = {
                reference: `${bookName} ${v.chapter}:${v.verse}`,
                book: bookName,
                bookNumber,
                chapter: parseInt(v.chapter, 10),
                verse: parseInt(v.verse, 10),
                text: texts[b],
            }
        }

        done += slice.length
        if (done % (BATCH * 16) === 0 || done === count) {
            const pct = ((done / count) * 100).toFixed(1)
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            console.log(`[embed] ${done}/${count} (${pct}%) — ${elapsed}s elapsed`)
        }
    }

    // -----------------------------------------------------------------------
    // Write the three files
    // -----------------------------------------------------------------------

    mkdirSync(OUT_DIR, { recursive: true })

    const manifest = {
        version: VERSION,
        dim,
        count,
        modelName: MODEL_NAME,
        builtAt: new Date().toISOString(),
    }

    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
    writeFileSync(join(OUT_DIR, 'metadata.json'), JSON.stringify(metadata))
    // Write the Float32Array as raw little-endian bytes (matches how
    // `new Float32Array(arrayBuffer)` reads it back at runtime).
    writeFileSync(join(OUT_DIR, 'embeddings.f32'), Buffer.from(packed.buffer))

    const totalSec = ((Date.now() - start) / 1000).toFixed(1)
    const sizeMb = (packed.byteLength / (1024 * 1024)).toFixed(1)
    console.log('')
    console.log(`✅ Wrote pack to ${OUT_DIR}`)
    console.log(`   manifest.json       (${count} verses, dim ${dim})`)
    console.log(`   metadata.json`)
    console.log(`   embeddings.f32      (${sizeMb} MB)`)
    console.log(`   built in ${totalSec}s`)
}

main().catch((err) => {
    console.error('[error]', err)
    process.exit(1)
})
