#!/usr/bin/env node
/**
 * Downloads the bundled GGUF model for the native (transcribe-cpp) transcription
 * engine. This is the offline default that `ModelManager::seed_bundled` copies
 * into the app data dir on first run.
 *
 * The bundled model is a **streaming** one, so live transcription works with zero
 * downloads on a fresh install. The previous bundled model (whisper base.en)
 * could not stream, which meant the out-of-the-box experience was batch
 * transcription with a full VAD-utterance of latency. It stays in the catalog as
 * a legacy entry so existing installs keep working.
 *
 * Keep FILE/SHA256 in sync with the `bundled: true` entry in
 * `src-tauri/src/transcription/models.rs`.
 *
 * Run as part of desktop:prebuild (and standalone via `npm run download-gguf-model`).
 */
import {
    existsSync,
    mkdirSync,
    statSync,
    unlinkSync,
    createWriteStream,
    createReadStream,
    readdirSync,
    rmSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Moonshine Streaming Small (Q8_0) from the public handy-computer HF org.
const FILE = 'moonshine-streaming-small-Q8_0.gguf'
const REPO = 'handy-computer/moonshine-streaming-small-gguf'
const URL = `https://huggingface.co/${REPO}/resolve/main/${FILE}`
// Hugging Face stores an LFS blob's oid as the file's sha256, which is where
// this came from; verified by hashing the downloaded artifact.
const SHA256 = 'd03670f69629b649085d0f44a63d97668b4119117cc9611a4e4ad94341713dfc'
const EXPECTED_SIZE = 198_506_848

const DEST_DIR = join(__dirname, '..', 'src-tauri', 'assets', 'whisper-models-gguf')
const DEST = join(DEST_DIR, FILE)

mkdirSync(DEST_DIR, { recursive: true })

// Everything in DEST_DIR is shipped via the `assets/whisper-models-gguf/**/*`
// resource glob in tauri.conf.json, so a previously-bundled model left on a dev
// machine or in a warm CI cache would silently add its full size to the
// installer. Drop stale *model* files only — README.md is committed and keeps
// the resource glob valid before this script has run.
for (const stale of readdirSync(DEST_DIR)) {
    if (stale === FILE) continue
    if (!/\.(gguf|bin)$/i.test(stale)) continue
    console.log(`  removing superseded bundled model: ${stale}`)
    rmSync(join(DEST_DIR, stale), { force: true })
}

async function sha256File(path) {
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    return hash.digest('hex')
}

if (existsSync(DEST) && statSync(DEST).size === EXPECTED_SIZE) {
    // Size alone can't distinguish a corrupt file, and re-downloading ~190 MB on
    // every prebuild is worse, so verify the hash of what's already there.
    const actual = await sha256File(DEST)
    if (actual === SHA256) {
        console.log(`✔︎ ${FILE} already present and verified (${(EXPECTED_SIZE / 1024 / 1024).toFixed(0)} MB)`)
        process.exit(0)
    }
    console.log(`  ${FILE} failed checksum — re-downloading`)
    unlinkSync(DEST)
} else if (existsSync(DEST)) {
    console.log(`  ${FILE} has an unexpected size — re-downloading`)
    unlinkSync(DEST)
}

console.log(`Downloading ${FILE} from ${URL} …`)
const res = await fetch(URL)
if (!res.ok || !res.body) {
    console.error(`Failed to download ${FILE}: HTTP ${res.status}`)
    process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST))

const size = statSync(DEST).size
if (size !== EXPECTED_SIZE) {
    console.error(`Downloaded ${FILE} is ${size} bytes, expected ${EXPECTED_SIZE} — likely truncated`)
    unlinkSync(DEST)
    process.exit(1)
}
const actual = await sha256File(DEST)
if (actual !== SHA256) {
    console.error(`Downloaded ${FILE} failed checksum:\n  expected ${SHA256}\n  actual   ${actual}`)
    unlinkSync(DEST)
    process.exit(1)
}
console.log(`✔︎ Downloaded and verified ${FILE} (${(size / 1024 / 1024).toFixed(0)} MB)`)
