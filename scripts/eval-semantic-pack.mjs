#!/usr/bin/env node
/**
 * Compare embedding packs as the UNIVERSAL semantic index.
 *
 * Whichever pack `semanticPack.ts` resolves answers "search by meaning" for
 * every Bible version the user reads. So the question isn't "which translation
 * is best" — it's "which pack's verse text retrieves the right reference from
 * a query someone actually types or says". Those queries are modern English
 * and rarely quote any translation verbatim.
 *
 * This runs the real embedding model (not the token-overlap stub the CI eval
 * uses), so it's opt-in and takes a minute:
 *
 *   node scripts/eval-semantic-pack.mjs
 *   node scripts/eval-semantic-pack.mjs --packs WEB,KJV --k 5
 *
 * Reports Recall@1, Recall@5 and MRR per pack over a paraphrase query set.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { EMBEDDING_MODEL, loadEmbedder } from './lib/embeddingModel.mjs'
import { PARAPHRASE } from './lib/semanticEvalSets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const { values: args } = parseArgs({
    options: {
        packs: { type: 'string', default: 'WEB,KJV' },
        k: { type: 'string', default: '5' },
        verbose: { type: 'boolean', default: false },
    },
})

const K = parseInt(args.k, 10) || 5

/** Paraphrase queries — see `lib/semanticEvalSets.mjs`. */
const QUERIES = PARAPHRASE

function loadPack(version) {
    // The EmbeddingGemma packs the desktop app searches.
    const dir = join(REPO_ROOT, 'src-tauri/semantic-packs', version)
    const manifestPath = join(dir, 'manifest.json')
    if (!existsSync(manifestPath)) return null

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'))
    const raw = readFileSync(join(dir, 'embeddings.i8'))
    const i8 = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const scale = manifest.scale ?? 127

    // Dequantize once into a flat Float32Array — same as the runtime loader.
    const packed = new Float32Array(i8.length)
    for (let i = 0; i < i8.length; i++) packed[i] = i8[i] / scale

    return { version, dim: manifest.dim, count: manifest.count, modelName: manifest.modelName, metadata, packed }
}

/** Rank of `target` in the pack's top-K for this query embedding, or Infinity. */
function rankOf(pack, query, target, k) {
    const { dim, count, packed, metadata } = pack
    // Top-k by dot product (vectors are L2-normalised, so dot == cosine).
    const topScores = new Float64Array(k).fill(-Infinity)
    const topIdx = new Int32Array(k).fill(-1)

    for (let row = 0; row < count; row++) {
        const off = row * dim
        let dot = 0
        for (let d = 0; d < dim; d++) dot += packed[off + d] * query[d]
        if (dot <= topScores[k - 1]) continue
        // Insertion into the small top-k buffer.
        let pos = k - 1
        while (pos > 0 && topScores[pos - 1] < dot) {
            topScores[pos] = topScores[pos - 1]
            topIdx[pos] = topIdx[pos - 1]
            pos--
        }
        topScores[pos] = dot
        topIdx[pos] = row
    }

    for (let i = 0; i < k; i++) {
        if (topIdx[i] >= 0 && metadata[topIdx[i]].reference === target) return i + 1
    }
    return Infinity
}

async function main() {
    const versions = args.packs.split(',').map((s) => s.trim()).filter(Boolean)
    const packs = []
    for (const v of versions) {
        const pack = loadPack(v)
        if (!pack) {
            console.warn(`[eval] no pack at src-tauri/semantic-packs/${v} — skipping`)
            continue
        }
        console.log(`[eval] loaded ${v}: ${pack.count} verses × ${pack.dim} dims`)
        packs.push(pack)
    }
    if (packs.length === 0) {
        console.error('[eval] no packs to compare')
        process.exit(1)
    }

    for (const pack of packs) {
        if (pack.modelName !== EMBEDDING_MODEL.id) {
            console.warn(`[eval] ${pack.version} was built with ${pack.modelName}, not ${EMBEDDING_MODEL.id}: its scores mean nothing here`)
        }
    }
    const { embed } = await loadEmbedder(REPO_ROOT)
    console.log(`[eval] model ready — ${QUERIES.length} paraphrase queries, k=${K}\n`)

    const results = new Map(packs.map((p) => [p.version, { hit1: 0, hitK: 0, rr: 0 }]))

    for (const { q, target } of QUERIES) {
        const [query] = await embed([q], 'query')

        const line = []
        for (const pack of packs) {
            const rank = rankOf(pack, query, target, K)
            const agg = results.get(pack.version)
            if (rank === 1) agg.hit1++
            if (rank <= K) agg.hitK++
            if (rank !== Infinity) agg.rr += 1 / rank
            line.push(`${pack.version}:${rank === Infinity ? '-' : rank}`)
        }
        if (args.verbose) console.log(`  ${line.join('  ')}  ${target}  "${q}"`)
    }

    const n = QUERIES.length
    console.log('\n  pack   Recall@1   Recall@%d   MRR', K)
    console.log('  ' + '-'.repeat(38))
    for (const pack of packs) {
        const { hit1, hitK, rr } = results.get(pack.version)
        console.log(
            `  ${pack.version.padEnd(6)} ${((hit1 / n) * 100).toFixed(1).padStart(7)}%  ${((hitK / n) * 100).toFixed(1).padStart(8)}%  ${(rr / n).toFixed(3).padStart(6)}`,
        )
    }
    console.log('')
}

main().catch((err) => {
    console.error('[eval] failed:', err)
    process.exit(1)
})
