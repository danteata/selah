#!/usr/bin/env node
/**
 * Downloads the bundled GGUF Whisper model for the native (transcribe-rs)
 * transcription engine. This is the offline default that `ModelManager::seed_bundled`
 * copies into the app data dir on first run.
 *
 * Run as part of desktop:prebuild (and standalone via `npm run download-gguf-model`).
 */
import { existsSync, mkdirSync, statSync, unlinkSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ggml GGUF base.en from the official whisper.cpp repo.
const FILE = 'ggml-base.en.bin'
const URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${FILE}`
const MIN_SIZE = 140_000_000 // ~142 MB; smaller means truncated

const DEST_DIR = join(__dirname, '..', 'src-tauri', 'assets', 'whisper-models-gguf')
const DEST = join(DEST_DIR, FILE)

mkdirSync(DEST_DIR, { recursive: true })

if (existsSync(DEST) && statSync(DEST).size >= MIN_SIZE) {
    console.log(`✔︎ ${FILE} already present (${(statSync(DEST).size / 1024 / 1024).toFixed(0)} MB)`)
    process.exit(0)
}

if (existsSync(DEST)) {
    console.log(`  ${FILE} looks truncated — re-downloading`)
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
if (size < MIN_SIZE) {
    console.error(`Downloaded ${FILE} is too small (${size} bytes) — likely corrupt`)
    unlinkSync(DEST)
    process.exit(1)
}
console.log(`✔︎ Downloaded ${FILE} (${(size / 1024 / 1024).toFixed(0)} MB)`)
