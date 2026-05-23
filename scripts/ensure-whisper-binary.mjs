#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'

if (isWindows) {
    const bat = join(__dirname, 'ensure-whisper-binary.bat')
    execSync(`"${bat}"`, { stdio: 'inherit' })
} else {
    const sh = join(__dirname, 'ensure-whisper-binary.sh')
    execSync(`"${sh}"`, { stdio: 'inherit' })
}