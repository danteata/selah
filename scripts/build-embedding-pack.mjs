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
 *     [--batch 64] \
 *     [--fragments]
 *
 * If `--url` is omitted the script tries common public sources in order
 * (see `KNOWN_SOURCES` below). The KJV source is committed as the
 * canonical reference; for new versions, supply `--url` explicitly.
 *
 * Pass `--fragments` to embed clause + sliding-window fragments alongside
 * full verses (~3-4× more rows, ~90-120k for KJV). This dramatically improves
 * short-phrase / paraphrase detection but increases pack size to ~100-130 MB.
 *
 * Output (under `--out`):
 *   manifest.json        — { version, dim, count, hasFragments, modelName, builtAt }
 *   metadata.json        — array of verse metadata (no embeddings)
 *   embeddings.f32       — flat Float32 buffer (count × dim × 4 bytes)
 *
 * The runtime loader is `src/services/sermon-listener/embeddingPackLoader.ts`.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, copyFileSync } from 'node:fs'
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
        fragments: { type: 'boolean', default: false },
    },
})

const VERSION = args.version
const BATCH = parseInt(args.batch, 10) || 128
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
// Fragment generation (mirrors src/lib/extractVerseFragments.ts)
// ---------------------------------------------------------------------------

const MIN_FRAGMENT_WORDS = 4
const MAX_FRAGMENT_WORDS = 14
const WINDOW_SIZE = 6
const WINDOW_STRIDE = 3
const MAX_WINDOW_WORDS = 20
const MAX_FRAGMENTS_PER_VERSE = 6

function splitClauses(text) {
    const parts = text.split(/[,;:().!?]/)
    return parts
        .map(p => p.trim())
        .filter(p => {
            const wordCount = p.split(/\s+/).filter(Boolean).length
            return wordCount >= MIN_FRAGMENT_WORDS && wordCount <= MAX_FRAGMENT_WORDS
        })
}

function generateWindows(words) {
    if (words.length < MIN_FRAGMENT_WORDS) return []
    const sourceWords = words.slice(0, MAX_WINDOW_WORDS)
    if (sourceWords.length <= WINDOW_SIZE) {
        return [sourceWords.join(' ')]
    }
    const windows = []
    for (let i = 0; i <= sourceWords.length - WINDOW_SIZE; i += WINDOW_STRIDE) {
        windows.push(sourceWords.slice(i, i + WINDOW_SIZE).join(' '))
    }
    const lastWindow = sourceWords.slice(-WINDOW_SIZE).join(' ')
    if (windows[windows.length - 1] !== lastWindow) {
        windows.push(lastWindow)
    }
    return windows
}

function fragmentSimilarity(a, b) {
    const aWords = new Set(a.toLowerCase().split(/\s+/))
    const bWords = new Set(b.toLowerCase().split(/\s+/))
    const intersection = [...aWords].filter(w => bWords.has(w)).length
    return (2 * intersection) / (aWords.size + bWords.size)
}

function extractVerseFragments(verseText) {
    if (!verseText || !verseText.trim()) return []
    const fragments = []
    let fragmentIndex = 0

    fragments.push({ text: verseText.trim(), type: 'full', fragmentIndex: fragmentIndex++ })

    for (const clause of splitClauses(verseText)) {
        fragments.push({ text: clause, type: 'clause', fragmentIndex: fragmentIndex++ })
    }

    const words = verseText.split(/\s+/).filter(Boolean)
    for (const window of generateWindows(words)) {
        if (window.split(/\s+/).filter(Boolean).length >= MIN_FRAGMENT_WORDS) {
            fragments.push({ text: window, type: 'window', fragmentIndex: fragmentIndex++ })
        }
    }

    // Deduplicate near-identical fragments using Dice coefficient on word sets.
    // Threshold 0.7 means ≥70% word overlap (e.g. "the lord is my shepherd" vs
    // "the lord is my ship" scores ~0.67; we keep both). 0.6 was too aggressive
    // and discarded meaningful variants; 0.8 kept too many near-duplicates.
    const kept = []
    for (const f of fragments) {
        if (f.type === 'full') { kept.push(f); continue }
        const dup = kept.some(k => k.type !== 'full' && fragmentSimilarity(f.text, k.text) >= 0.7)
        if (!dup) kept.push(f)
    }

    if (kept.length > MAX_FRAGMENTS_PER_VERSE) {
        const full = kept.filter(f => f.type === 'full')
        const rest = kept.filter(f => f.type !== 'full').slice(0, MAX_FRAGMENTS_PER_VERSE - 1)
        return [...full, ...rest]
    }
    return kept
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function buildEmbedItems(verses, withFragments) {
    const embedItems = []
    for (const v of verses) {
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
        const baseRef = `${bookName} ${v.chapter}:${v.verse}`

        if (withFragments) {
            const frags = extractVerseFragments(v.scripture.trim())
            for (const frag of frags) {
                embedItems.push({
                    text: frag.text,
                    reference: frag.type === 'full'
                        ? baseRef
                        : `${baseRef}__${frag.type}_${frag.fragmentIndex}`,
                    book: bookName,
                    bookNumber,
                    chapter: parseInt(v.chapter, 10),
                    verse: parseInt(v.verse, 10),
                    type: frag.type,
                })
            }
        } else {
            embedItems.push({
                text: v.scripture.trim(),
                reference: baseRef,
                book: bookName,
                bookNumber,
                chapter: parseInt(v.chapter, 10),
                verse: parseInt(v.verse, 10),
                type: 'full',
            })
        }
    }
    return embedItems
}

async function main() {
    const start = Date.now()

    const manifestPath = join(OUT_DIR, 'manifest.json')
    const embeddingsPath = join(OUT_DIR, 'embeddings.f32')
    const metadataPath = join(OUT_DIR, 'metadata.json')
    const checkpointPath = join(OUT_DIR, 'checkpoint.json')
    const partialEmbPath = join(OUT_DIR, 'embeddings.f32.partial')
    const partialMetaPath = join(OUT_DIR, 'metadata.partial.json')

    if (existsSync(manifestPath) && existsSync(embeddingsPath) && existsSync(metadataPath)) {
        const fs = await import('node:fs/promises')
        const size = (await fs.stat(embeddingsPath)).size
        if (size > 0) {
            let existingHasFragments = false
            try {
                const manifestRaw = await fs.readFile(manifestPath, 'utf8')
                const existingManifest = JSON.parse(manifestRaw)
                existingHasFragments = existingManifest.hasFragments === true
            } catch {
                // ignore parse errors, just rebuild
            }
            if (args.fragments && !existingHasFragments) {
                console.log(`[rebuild] ${VERSION} pack exists but lacks fragments, rebuilding...`)
            } else {
                console.log(`[skip] ${VERSION} embedding pack already built (${(size / (1024 * 1024)).toFixed(1)} MB)`)
                return
            }
        }
    }

    // Load existing verse-only pack for embedding reuse when upgrading to --fragments
    let reuseEmbeddings = null
    let reuseDim = 0
    if (args.fragments && existsSync(embeddingsPath) && existsSync(metadataPath)) {
        try {
            const fs = await import('node:fs/promises')
            const existingMeta = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
            const existingBuf = Buffer.from(await fs.readFile(embeddingsPath))
            reuseDim = existingMeta.length > 0 ? Math.round(existingBuf.byteLength / (existingMeta.length * 4)) : 0
            if (reuseDim > 0) {
                reuseEmbeddings = { metadata: existingMeta, buffer: existingBuf, dim: reuseDim }
                console.log(`[reuse] loaded ${existingMeta.length} verse embeddings from existing pack (dim=${reuseDim})`)
            }
        } catch (e) {
            console.warn(`[reuse] could not load existing pack for reuse: ${e.message}`)
            reuseEmbeddings = null
        }
    }

    const verses = await fetchVerses(VERSION, args.url)
    console.log(`[fetch] got ${verses.length} verses`)

    const embedder = await loadEmbedder()
    const probe = await embedder('hello', { pooling: 'mean', normalize: true })
    const dim = probe.data.length
    console.log(`[model] ready, dim=${dim}`)

    const embedItems = buildEmbedItems(verses, args.fragments)
    const count = embedItems.length
    console.log(`[fragments] ${args.fragments ? 'enabled' : 'disabled'} — total items to embed: ${count}`)

    // Build a lookup for reuse: reference -> offset in existing pack
    let reuseLookup = null
    if (reuseEmbeddings && reuseEmbeddings.dim === dim) {
        reuseLookup = new Map()
        for (let i = 0; i < reuseEmbeddings.metadata.length; i++) {
            const ref = reuseEmbeddings.metadata[i].reference
            // Also match fragment references like "John 3:16__clause_1" if they exist
            reuseLookup.set(ref, i)
        }
    }

    const packed = new Float32Array(count * dim)
    const metadata = new Array(count)

    // Check for checkpoint to resume from
    let resumeFrom = 0
    if (existsSync(checkpointPath) && existsSync(partialEmbPath) && existsSync(partialMetaPath)) {
        try {
            const cp = JSON.parse(readFileSync(checkpointPath, 'utf8'))
            if (cp.count === count && cp.dim === dim && cp.batch === BATCH) {
                const partialBuf = Buffer.from(readFileSync(partialEmbPath))
                const partialMeta = JSON.parse(readFileSync(partialMetaPath, 'utf8'))
                if (partialBuf.byteLength === cp.done * dim * 4 && partialMeta.length === cp.done) {
                    packed.set(new Float32Array(partialBuf.buffer, partialBuf.byteOffset, cp.done * dim))
                    for (let i = 0; i < cp.done; i++) {
                        metadata[i] = partialMeta[i]
                    }
                    resumeFrom = cp.done
                    console.log(`[resume] continuing from item ${resumeFrom}/${count} (${((resumeFrom / count) * 100).toFixed(1)}%)`)
                } else {
                    console.log(`[resume] checkpoint size mismatch, starting fresh`)
                }
            } else {
                console.log(`[resume] checkpoint params changed, starting fresh`)
            }
        } catch (e) {
            console.warn(`[resume] could not load checkpoint: ${e.message}`)
        }
    }

    mkdirSync(OUT_DIR, { recursive: true })

    let done = resumeFrom
    let needsEmbed = 0
    let reusedCount = 0
    for (let i = resumeFrom; i < count; i += BATCH) {
        const batchEnd = Math.min(i + BATCH, count)
        const slice = embedItems.slice(i, batchEnd)

        // Split batch into items we can reuse vs items needing embedding
        const reuseIndices = []
        const embedIndices = []
        for (let b = 0; b < slice.length; b++) {
            const item = slice[b]
            if (reuseLookup && item.type === 'full' && reuseLookup.has(item.reference)) {
                reuseIndices.push(b)
            } else {
                embedIndices.push(b)
            }
        }

        // Copy reused embeddings directly from the existing pack
        for (const b of reuseIndices) {
            const item = slice[b]
            const srcIdx = reuseLookup.get(item.reference)
            const srcOff = srcIdx * reuseEmbeddings.dim
            const dstOff = (i + b) * dim
            for (let d = 0; d < dim; d++) {
                packed[dstOff + d] = reuseEmbeddings.buffer.readFloatLE(srcOff * 4 + d * 4)
            }
            metadata[i + b] = {
                reference: item.reference,
                book: item.book,
                bookNumber: item.bookNumber,
                chapter: item.chapter,
                verse: item.verse,
                text: item.text,
            }
            reusedCount++
        }

        // Embed only the items that need fresh embeddings
        if (embedIndices.length > 0) {
            const embedSlice = embedIndices.map(b => slice[b])
            const texts = embedSlice.map(item => item.text)
            const tensor = await embedder(texts, { pooling: 'mean', normalize: true })

            const flat = tensor.data
            for (let ei = 0; ei < embedSlice.length; ei++) {
                const b = embedIndices[ei]
                const item = slice[b]
                const off = (i + b) * dim
                for (let d = 0; d < dim; d++) {
                    packed[off + d] = flat[ei * dim + d]
                }
                metadata[i + b] = {
                    reference: item.reference,
                    book: item.book,
                    bookNumber: item.bookNumber,
                    chapter: item.chapter,
                    verse: item.verse,
                    text: item.text,
                }
            }
            needsEmbed += embedIndices.length
        }

        done = batchEnd
        if (done % (BATCH * 16) === 0 || done === count) {
            const pct = ((done / count) * 100).toFixed(1)
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            const reusePct = reusedCount > 0 ? ` (${reusedCount} reused)` : ''
            console.log(`[embed] ${done}/${count} (${pct}%) — ${elapsed}s elapsed${reusePct}`)
        }

        // Write checkpoint after each batch
        writeFileSync(partialEmbPath, Buffer.from(packed.buffer, 0, done * dim * 4))
        writeFileSync(partialMetaPath, JSON.stringify(metadata.slice(0, done)))
        writeFileSync(checkpointPath, JSON.stringify({ done, count, dim, batch: BATCH }))
    }

    if (reusedCount > 0) {
        console.log(`[reuse] reused ${reusedCount} existing verse embeddings, embedded ${needsEmbed} new items`)
    }

    const manifest = {
        version: VERSION,
        dim,
        count,
        hasFragments: args.fragments,
        modelName: MODEL_NAME,
        builtAt: new Date().toISOString(),
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    writeFileSync(metadataPath, JSON.stringify(metadata))
    writeFileSync(embeddingsPath, Buffer.from(packed.buffer))

    // Clean up checkpoint files
    for (const f of [checkpointPath, partialEmbPath, partialMetaPath]) {
        try { unlinkSync(f) } catch {}
    }

    const totalSec = ((Date.now() - start) / 1000).toFixed(1)
    const sizeMb = (packed.byteLength / (1024 * 1024)).toFixed(1)
    console.log('')
    console.log(`✅ Wrote pack to ${OUT_DIR}`)
    console.log(`   manifest.json       (${count} items, dim ${dim})`)
    console.log(`   metadata.json`)
    console.log(`   embeddings.f32      (${sizeMb} MB)`)
    console.log(`   built in ${totalSec}s`)
}

main().catch((err) => {
    console.error('[error]', err)
    process.exit(1)
})
