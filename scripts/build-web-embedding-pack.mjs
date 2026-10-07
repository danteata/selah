#!/usr/bin/env node
/**
 * Build the compact int8 pack the desktop app searches, from the float32 pack
 * `build-embedding-pack.mjs` writes.
 *
 * Output goes to `src-tauri/semantic-packs/<VERSION>/` (bundled as a Tauri
 * resource): these scripts embed with EmbeddingGemma, the desktop model. The
 * web's MiniLM pack in `public/embedding-packs` is a frozen artifact built by
 * this script's predecessor; don't point --out at it, or the web would score
 * MiniLM queries against EmbeddingGemma vectors.
 *
 * Original rationale (written when this produced the web pack):
 *
 * The desktop pack under `src-tauri/assets/embedding-packs/<VERSION>/` is
 * ~250 MB: full verses PLUS clause/sliding-window fragments, as float32.
 * That's fine bundled in a native app, but far too heavy to download in a
 * browser — which is why web currently falls back to the Convex vector
 * search (a per-query server cost).
 *
 * This script produces a small web-servable pack so the browser can do the
 * same search locally (and offline), with Convex as a fallback only:
 *   - drop the clause fragments, keep only canonical verses (~31k), and
 *   - quantize the float32 embeddings to int8 (÷4 the size).
 * Result is ~12 MB of vectors + ~5 MB metadata instead of ~250 MB.
 *
 * No embedding model is run — this is a pure transform of the existing
 * float32 pack, so it's fast and deterministic.
 *
 * Int8 scheme: embeddings are L2-normalised (components in [-1, 1]); we store
 * round(x * 127) clamped to [-127, 127]. The loader dequantizes with q / 127,
 * which preserves cosine similarity to well within the threshold tolerances.
 *
 * Usage:
 *   node scripts/build-web-embedding-pack.mjs \
 *     [--version WEB] \
 *     [--in src-tauri/assets/embedding-packs/WEB] \
 *     [--out src-tauri/semantic-packs/WEB]
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const { values } = parseArgs({
    options: {
        version: { type: 'string', default: 'WEB' },
        in: { type: 'string' },
        out: { type: 'string' },
    },
})

const version = values.version
const fromRepo = (p) => (isAbsolute(p) ? p : join(REPO_ROOT, p))
const inDir = values.in ? fromRepo(values.in) : join(REPO_ROOT, 'src-tauri/assets/embedding-packs', version)
const outDir = values.out ? fromRepo(values.out) : join(REPO_ROOT, 'src-tauri/semantic-packs', version)

// The int8 scale is chosen from the data: the largest |component| maps to 127.
// A fixed 127 assumes components span [-1, 1], but a unit vector spreads its
// length over every dimension — at 768 dims a typical component is ~0.04, so a
// fixed scale left about five levels per component. The loader reads `scale`
// from the manifest, so any pack built either way loads correctly.

function main() {
    const manifestPath = join(inDir, 'manifest.json')
    const metadataPath = join(inDir, 'metadata.json')
    const embeddingsPath = join(inDir, 'embeddings.f32')

    for (const p of [manifestPath, metadataPath, embeddingsPath]) {
        if (!existsSync(p)) {
            console.error(`[web-pack] Missing source file: ${p}`)
            console.error('[web-pack] Build/download the desktop pack first (npm run download-embedding-model / build-embedding-pack).')
            process.exit(1)
        }
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dim = manifest.dim
    const srcCount = manifest.count
    console.log(`[web-pack] Source: ${version} — ${srcCount} rows × ${dim} dims`)

    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    if (metadata.length !== srcCount) {
        console.error(`[web-pack] metadata length ${metadata.length} != manifest count ${srcCount}`)
        process.exit(1)
    }

    const buf = readFileSync(embeddingsPath)
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
    if (f32.length !== srcCount * dim) {
        console.error(`[web-pack] embeddings length ${f32.length} != count×dim ${srcCount * dim}`)
        process.exit(1)
    }

    // Keep only canonical verses (reference has no "__fragment" suffix).
    const canonicalIdx = []
    for (let i = 0; i < metadata.length; i++) {
        if (!String(metadata[i].reference).includes('__')) canonicalIdx.push(i)
    }
    const count = canonicalIdx.length
    console.log(`[web-pack] Keeping ${count} canonical verses (dropped ${srcCount - count} fragments)`)

    const outMeta = new Array(count)
    const out = new Int8Array(count * dim)
    let clamped = 0
    let maxAbs = 0
    for (let n = 0; n < count; n++) {
        const srcOff = canonicalIdx[n] * dim
        for (let d = 0; d < dim; d++) maxAbs = Math.max(maxAbs, Math.abs(f32[srcOff + d]))
    }
    const SCALE = maxAbs > 0 ? 127 / maxAbs : 127
    console.log(`[web-pack] Largest component ${maxAbs.toFixed(4)} → int8 scale ${SCALE.toFixed(1)}`)

    for (let n = 0; n < count; n++) {
        const srcRow = canonicalIdx[n]
        outMeta[n] = metadata[srcRow]
        const srcOff = srcRow * dim
        const dstOff = n * dim
        for (let d = 0; d < dim; d++) {
            let q = Math.round(f32[srcOff + d] * SCALE)
            if (q > 127) { q = 127; clamped++ }
            else if (q < -127) { q = -127; clamped++ }
            out[dstOff + d] = q
        }
    }
    console.log(`[web-pack] Quantized to int8 (${clamped} components clamped)`)

    mkdirSync(outDir, { recursive: true })
    const outManifest = {
        version,
        dim,
        count,
        quantization: 'int8',
        scale: SCALE,
        hasFragments: false,
        modelName: manifest.modelName,
        builtAt: new Date().toISOString(),
        source: 'build-web-embedding-pack',
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(outManifest, null, 2))
    writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(outMeta))
    writeFileSync(join(outDir, 'embeddings.i8'), Buffer.from(out.buffer, out.byteOffset, out.byteLength))

    const mb = (n) => (n / (1024 * 1024)).toFixed(1)
    console.log(`[web-pack] Wrote ${outDir}`)
    console.log(`[web-pack]   embeddings.i8  ${mb(out.byteLength)} MB`)
    console.log(`[web-pack]   metadata.json  ${mb(Buffer.byteLength(JSON.stringify(outMeta)))} MB`)
    console.log('[web-pack] Done.')
}

main()
