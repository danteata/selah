#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'

if (isWindows) {
    // On Windows, use curl directly (available on modern Windows)
    const REPO = 'Xenova/all-MiniLM-L6-v2'
    const BASE_URL = `https://huggingface.co/${REPO}/resolve/main`
    const DEST_DIR = join(__dirname, '..', 'src-tauri', 'assets', 'embedding-models', ...REPO.split('/'))

    const FILES = [
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
        'onnx/model_quantized.onnx',
    ]

    for (const file of FILES) {
        const out = join(DEST_DIR, file)
        if (existsSync(out) && statSync(out).size > 0) {
            console.log(`[skip] ${file} already present`)
            continue
        }
        console.log(`[fetch] ${file}`)
        mkdirSync(dirname(out), { recursive: true })
        execSync(`curl -fL --retry 3 --retry-delay 2 -o "${out}" "${BASE_URL}/${file}"`, { stdio: 'inherit' })
    }

    console.log(`\nEmbedding model ready at:\n  ${DEST_DIR}`)
} else {
    const sh = join(__dirname, 'download-embedding-model.sh')
    execSync(`"${sh}"`, { stdio: 'inherit' })
}