#!/usr/bin/env node
/**
 * Fetch the semantic-search embedding model into
 * `src-tauri/assets/embedding-models/<repo>/`, where the desktop bundle picks it
 * up as a Tauri resource — so the installed app embeds offline from first
 * launch instead of downloading ~330 MB of weights mid-service.
 *
 * The model, revision and file hashes live in `lib/embeddingModel.mjs`. Every
 * file is verified against its pinned sha256; a mismatch deletes the file and
 * fails the run rather than bundling something unverified. Also writes the
 * Gemma Terms notice the model's licence requires to ship alongside it.
 *
 * Plain Node (fetch + crypto), so the same script runs on every CI platform.
 * Re-running skips files that are already present and verified.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { EMBEDDING_MODEL, EMBEDDING_MODEL_FILES, EMBEDDING_MODEL_REVISION, GEMMA_NOTICE } from './lib/embeddingModel.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST_DIR = join(REPO_ROOT, 'src-tauri', 'assets', 'embedding-models', ...EMBEDDING_MODEL.id.split('/'))
const BASE_URL = `https://huggingface.co/${EMBEDDING_MODEL.id}/resolve/${EMBEDDING_MODEL_REVISION}`

async function sha256Of(path) {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
}

async function fetchTo(url, out, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url)
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
            await pipeline(Readable.fromWeb(res.body), createWriteStream(out))
            return
        } catch (err) {
            if (attempt >= attempts) throw err
            console.warn(`  retry ${attempt}/${attempts - 1} after ${err.message}`)
            await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
    }
}

async function main() {
    for (const file of EMBEDDING_MODEL_FILES) {
        const out = join(DEST_DIR, file.path)
        if (existsSync(out) && statSync(out).size === file.size && (await sha256Of(out)) === file.sha256) {
            console.log(`[skip] ${file.path} already present`)
            continue
        }
        console.log(`[fetch] ${file.path} (${(file.size / 1e6).toFixed(1)} MB)`)
        mkdirSync(dirname(out), { recursive: true })
        await fetchTo(`${BASE_URL}/${file.path}`, out)
        const got = await sha256Of(out)
        if (got !== file.sha256) {
            rmSync(out, { force: true })
            throw new Error(`${file.path}: sha256 ${got} does not match pinned ${file.sha256}`)
        }
    }
    writeFileSync(join(DEST_DIR, 'NOTICE.txt'), GEMMA_NOTICE)
    console.log(`\nEmbedding model ready at:\n  ${DEST_DIR}`)
}

main().catch((err) => {
    console.error('[download-embedding-model] failed:', err.message)
    process.exit(1)
})
