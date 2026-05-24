#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = 'Systran/faster-whisper-base.en'
const BASE_URL = `https://huggingface.co/${REPO}/resolve/main`

const isWindows = process.platform === 'win32'

const MODELS_DIR = join(__dirname, '..', 'src-tauri', 'assets', 'whisper-models')
const BASE_EN_DIR = join(MODELS_DIR, 'base.en')

const FILES = [
    'model.bin',
    'tokenizer.json',
    'vocabulary.txt',
    'config.json',
    'preprocessor_config.json',
    'tokenizer_config.json',
]

mkdirSync(BASE_EN_DIR, { recursive: true })

const allExist = FILES.every(f => {
    const p = join(BASE_EN_DIR, f)
    return existsSync(p) && statSync(p).size > 0
})

if (allExist) {
    console.log(`Whisper base.en model already exists at ${BASE_EN_DIR}`)
    console.log('To re-download, delete the directory first.')
    process.exit(0)
}

console.log(`Downloading faster-whisper base.en model (CTranslate2 format)...`)
console.log(`  Source: https://huggingface.co/${REPO}`)
console.log(`  Destination: ${BASE_EN_DIR}`)

for (const file of FILES) {
    const dest = join(BASE_EN_DIR, file)
    if (existsSync(dest) && statSync(dest).size > 0) {
        console.log(`  [skip] ${file} (already exists)`)
        continue
    }
    console.log(`  [downloading] ${file}`)
    const url = `${BASE_URL}/${file}`
    // curl is available on modern Windows (10+) and all Unix systems
    execSync(`curl -fL --retry 3 --retry-delay 2 -o "${dest}" "${url}"`, { stdio: 'inherit' })
}

console.log(`\nDownload complete! Model files:`)
for (const f of FILES) {
    const p = join(BASE_EN_DIR, f)
    if (existsSync(p)) {
        const size = statSync(p).size
        console.log(`  ${f} (${(size / 1024 / 1024).toFixed(1)} MB)`)
    }
}