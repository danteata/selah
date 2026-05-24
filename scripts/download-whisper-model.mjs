#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = 'Systran/faster-whisper-base.en'
const BASE_URL = `https://huggingface.co/${REPO}/resolve/main`

const MODELS_DIR = join(__dirname, '..', 'src-tauri', 'assets', 'whisper-models')
const BASE_EN_DIR = join(MODELS_DIR, 'base.en')

// Expected file sizes in bytes (minimum — actual may be slightly larger
// due to server-side compression differences). Files smaller than these
// are considered truncated / corrupted and will be re-downloaded.
const EXPECTED_SIZES = {
    'model.bin': 140_000_000,
    'tokenizer.json': 2_000_000,
    'vocabulary.txt': 400_000,
    'config.json': 200,
}

const FILES = Object.keys(EXPECTED_SIZES)

mkdirSync(BASE_EN_DIR, { recursive: true })

let needsDownload = false
for (const f of FILES) {
    const p = join(BASE_EN_DIR, f)
    const minSize = EXPECTED_SIZES[f]
    if (!existsSync(p) || statSync(p).size < minSize) {
        if (existsSync(p)) {
            const actualSize = statSync(p).size
            console.log(`  ${f}: ${(actualSize / 1024 / 1024).toFixed(1)} MB (expected >= ${(minSize / 1024 / 1024).toFixed(1)} MB) — re-downloading`)
            unlinkSync(p)
        }
        needsDownload = true
    }
}

if (!needsDownload) {
    console.log(`Whisper base.en model already exists at ${BASE_EN_DIR}`)
    console.log('To force re-download, delete the directory first.')
    process.exit(0)
}

console.log(`Downloading faster-whisper base.en model (CTranslate2 format)...`)
console.log(`  Source: https://huggingface.co/${REPO}`)
console.log(`  Destination: ${BASE_EN_DIR}`)

for (const file of FILES) {
    const dest = join(BASE_EN_DIR, file)
    const minSize = EXPECTED_SIZES[file]
    if (existsSync(dest) && statSync(dest).size >= minSize) {
        console.log(`  [skip] ${file} (already exists, ${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
        continue
    }
    console.log(`  [downloading] ${file}...`)
    const url = `${BASE_URL}/${file}`
    execSync(`curl -fL --retry 3 --retry-delay 2 -o "${dest}" "${url}"`, { stdio: 'inherit' })
    // Verify download
    if (!existsSync(dest) || statSync(dest).size < minSize) {
        console.error(`ERROR: ${file} download failed or is truncated (got ${statSync(dest)?.size ?? 0} bytes, expected >= ${minSize})`)
        process.exit(1)
    }
}

console.log(`\nDownload complete! Model files:`)
for (const f of FILES) {
    const p = join(BASE_EN_DIR, f)
    if (existsSync(p)) {
        const size = statSync(p).size
        console.log(`  ${f} (${(size / 1024 / 1024).toFixed(1)} MB)`)
    }
}