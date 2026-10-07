#!/usr/bin/env node
/**
 * Fit the score calibration that maps the current embedding model's cosine
 * scores onto all-MiniLM-L6-v2's scale — the scale every semantic threshold
 * was tuned on. See `src/services/sermon-listener/scoreCalibration.ts` for why.
 *
 * Method: quantile matching. The same queries are scored against the WEB
 * verses by both models; each model's pooled top-K scores are sorted, and
 * equal ranks are paired into knots. The resulting map is monotonic, so it
 * changes what a threshold means without ever reordering candidates.
 *
 * The queries are what a live service produces: KJV verses read aloud, The
 * Message's paraphrases (a stand-in for a preacher restating a verse), the
 * labeled sets in `lib/semanticEvalSets.mjs`, and ordinary sermon talk that
 * should match nothing. Because KJV and MSG rows carry their reference, the
 * run also reports how often each model ranks the right verse first.
 *
 * Usage:
 *   node scripts/calibrate-embedding-scores.mjs \
 *     [--pack src-tauri/semantic-packs/WEB] \
 *     [--reference-pack public/embedding-packs/WEB] \
 *     [--sample 500] \
 *     [--dump <file.json>]
 *
 * --dump writes every query's top candidates under both models, for
 * `scripts/eval-semantic-policy.ts` to run the detection policy over.
 * --reference-pack defaults to the web's MiniLM pack; pass --reference-pack ''
 * to compute the MiniLM verse vectors here instead (a
 * minute or two). Writes src/services/sermon-listener/embeddingCalibration.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { EMBEDDING_MODEL, loadEmbedder } from './lib/embeddingModel.mjs'
import { LIVE, NEGATIVE, PARAPHRASE } from './lib/semanticEvalSets.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFERENCE_MODEL = 'Xenova/all-MiniLM-L6-v2'
const TOP_K = 10
const QUANTILES = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 0.995, 0.999, 1]

const { values: args } = parseArgs({
    options: {
        pack: { type: 'string', default: 'src-tauri/semantic-packs/WEB' },
        'reference-pack': { type: 'string', default: 'public/embedding-packs/WEB' },
        sample: { type: 'string', default: '500' },
        dump: { type: 'string' },
    },
})
const SAMPLE = parseInt(args.sample, 10)

function loadPack(dir) {
    const abs = dir.startsWith('/') ? dir : join(REPO_ROOT, dir)
    const manifest = JSON.parse(readFileSync(join(abs, 'manifest.json'), 'utf8'))
    const metadata = JSON.parse(readFileSync(join(abs, 'metadata.json'), 'utf8'))
    const raw = readFileSync(join(abs, 'embeddings.i8'))
    const i8 = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const scale = manifest.scale ?? 127
    const vecs = new Float32Array(i8.length)
    for (let i = 0; i < i8.length; i++) vecs[i] = i8[i] / scale
    return { manifest, metadata, vecs, dim: manifest.dim }
}

/** Top-K (score, row) for one query against a flat matrix. */
function topK(vecs, dim, count, q, k = TOP_K) {
    const scores = new Float64Array(k).fill(-Infinity)
    const rows = new Int32Array(k).fill(-1)
    for (let r = 0; r < count; r++) {
        const off = r * dim
        let dot = 0
        for (let d = 0; d < dim; d++) dot += vecs[off + d] * q[d]
        if (dot <= scores[k - 1]) continue
        let p = k - 1
        while (p > 0 && scores[p - 1] < dot) { scores[p] = scores[p - 1]; rows[p] = rows[p - 1]; p-- }
        scores[p] = dot; rows[p] = r
    }
    return { scores: Array.from(scores), rows: Array.from(rows) }
}

/** Deterministic sample so a re-run fits the same knots. */
function sample(rows, n, seed) {
    let x = seed
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pool = rows.filter((r) => r.scripture && r.scripture.split(/\s+/).length >= 5)
    const out = []
    const used = new Set()
    while (out.length < n && used.size < pool.length) {
        const i = Math.floor(rand() * pool.length)
        if (used.has(i)) continue
        used.add(i)
        out.push(pool[i])
    }
    return out
}

async function loadReferenceEmbedder() {
    const { pipeline, env } = await import('@xenova/transformers')
    env.allowRemoteModels = true
    const fe = await pipeline('feature-extraction', REFERENCE_MODEL, { quantized: true })
    return async (texts) => {
        const out = []
        for (let i = 0; i < texts.length; i += 64) {
            const t = await fe(texts.slice(i, i + 64), { pooling: 'mean', normalize: true })
            const dim = t.dims[t.dims.length - 1]
            for (let j = 0; j < t.dims[0]; j++) out.push(Array.from(t.data.slice(j * dim, (j + 1) * dim)))
        }
        return out
    }
}

function quantile(sorted, q) {
    const pos = q * (sorted.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

async function main() {
    const pack = loadPack(args.pack)
    if (pack.manifest.modelName !== EMBEDDING_MODEL.id) {
        throw new Error(`pack ${args.pack} was built with ${pack.manifest.modelName}, not ${EMBEDDING_MODEL.id}`)
    }
    const count = pack.metadata.length
    const keyToRef = new Map(pack.metadata.map((m) => [`${m.bookNumber}:${m.chapter}:${m.verse}`, m.reference]))

    // ---- queries -----------------------------------------------------------
    const kjv = JSON.parse(readFileSync(join(REPO_ROOT, 'public/bibles/kjv.json'), 'utf8'))
    const msg = JSON.parse(readFileSync(join(REPO_ROOT, 'public/bibles/msg.json'), 'utf8'))
    const asQueries = (rows, set) => rows
        .map((r) => ({ q: r.scripture.trim(), target: keyToRef.get(`${Number(r.book)}:${Number(r.chapter)}:${Number(r.verse)}`), set }))
        .filter((x) => x.target)
    const queries = [
        ...asQueries(sample(kjv, SAMPLE, 7), 'kjv'),
        ...asQueries(sample(msg, SAMPLE, 11), 'msg'),
        ...PARAPHRASE.map((x) => ({ ...x, set: 'paraphrase' })),
        ...LIVE.map((x) => ({ ...x, set: 'live' })),
        ...NEGATIVE.map((q) => ({ q, target: null, set: 'negative' })),
    ]
    console.log(`[calibrate] ${queries.length} queries against ${count} verses`)

    // ---- current model -----------------------------------------------------
    console.log(`[calibrate] embedding queries with ${EMBEDDING_MODEL.id}…`)
    const { embed } = await loadEmbedder(REPO_ROOT, { log: () => {} })
    const modelQ = []
    for (let i = 0; i < queries.length; i += 16) modelQ.push(...await embed(queries.slice(i, i + 16).map((x) => x.q), 'query'))

    // ---- reference model ---------------------------------------------------
    console.log(`[calibrate] reference ${REFERENCE_MODEL}…`)
    const refEmbed = await loadReferenceEmbedder()
    let ref
    if (args['reference-pack']) {
        ref = loadPack(args['reference-pack'])
        if (ref.manifest.modelName !== REFERENCE_MODEL) throw new Error(`reference pack is ${ref.manifest.modelName}`)
        if (ref.metadata.length !== count) throw new Error('reference pack has a different verse count')
    } else {
        const vectors = await refEmbed(pack.metadata.map((m) => m.text))
        const dim = vectors[0].length
        const vecs = new Float32Array(count * dim)
        vectors.forEach((v, i) => vecs.set(v, i * dim))
        ref = { metadata: pack.metadata, vecs, dim }
    }
    const refQ = await refEmbed(queries.map((x) => x.q))

    // ---- score -------------------------------------------------------------
    const pooled = { model: [], ref: [] }
    const hits = {}
    const dump = []
    const cands = (meta, res) => res.rows.slice(0, 5).map((row, j) => ({
        reference: meta[row].reference, book: meta[row].book, chapter: meta[row].chapter,
        text: meta[row].text, score: res.scores[j],
    }))
    for (let i = 0; i < queries.length; i++) {
        const { set, target } = queries[i]
        const m = topK(pack.vecs, pack.dim, count, modelQ[i])
        const r = topK(ref.vecs, ref.dim, count, refQ[i])
        pooled.model.push(...m.scores)
        pooled.ref.push(...r.scores)
        if (args.dump) dump.push({ ...queries[i], model: cands(pack.metadata, m), ref: cands(ref.metadata, r) })
        if (target) {
            hits[set] ??= { n: 0, model: 0, ref: 0 }
            hits[set].n++
            if (pack.metadata[m.rows[0]].reference === target) hits[set].model++
            if (ref.metadata[r.rows[0]].reference === target) hits[set].ref++
        }
        if ((i + 1) % 200 === 0) console.log(`  scored ${i + 1}/${queries.length}`)
    }

    console.log('\n  right verse ranked first     reference   current')
    for (const [set, h] of Object.entries(hits)) {
        const pct = (x) => `${((x / h.n) * 100).toFixed(1)}%`.padStart(8)
        console.log(`  ${set.padEnd(12)} (${String(h.n).padStart(3)})       ${pct(h.ref)}  ${pct(h.model)}`)
    }

    // ---- knots -------------------------------------------------------------
    pooled.model.sort((a, b) => a - b)
    pooled.ref.sort((a, b) => a - b)
    const knots = []
    for (const q of QUANTILES) {
        const raw = Number(quantile(pooled.model, q).toFixed(4))
        const cal = Number(quantile(pooled.ref, q).toFixed(4))
        if (knots.length && raw <= knots[knots.length - 1][0]) continue
        knots.push([raw, cal])
    }
    console.log('\n  knots (raw → calibrated):')
    for (const [a, b] of knots) console.log(`    ${a.toFixed(4)} → ${b.toFixed(4)}`)

    const out = `// Generated by scripts/calibrate-embedding-scores.mjs — do not edit by hand.
// Maps ${EMBEDDING_MODEL.id} cosine scores onto ${REFERENCE_MODEL}'s scale by
// quantile matching over ${queries.length} queries × top ${TOP_K} against the
// ${pack.manifest.version} pack (${count} verses). See scoreCalibration.ts.

export const SCORE_CALIBRATION: {
    modelId: string
    referenceModelId: string
    knots: ReadonlyArray<readonly [number, number]>
} = {
    modelId: '${EMBEDDING_MODEL.id}',
    referenceModelId: '${REFERENCE_MODEL}',
    knots: [
${knots.map(([a, b]) => `        [${a}, ${b}],`).join('\n')}
    ],
}
`
    const outPath = join(REPO_ROOT, 'src/services/sermon-listener/embeddingCalibration.ts')
    writeFileSync(outPath, out)
    console.log(`\n[calibrate] wrote ${outPath}`)
    if (args.dump) {
        writeFileSync(args.dump, JSON.stringify(dump))
        console.log(`[calibrate] wrote candidates to ${args.dump}`)
    }
}

main().catch((err) => {
    console.error('[calibrate] failed:', err)
    process.exit(1)
})
