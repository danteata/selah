import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Validates the web pack produced by scripts/build-web-embedding-pack.mjs.
// Skips when the asset hasn't been generated (keeps CI green without it).
const packDir = join(process.cwd(), 'public/embedding-packs/KJV')
const present = existsSync(join(packDir, 'manifest.json'))

interface WebManifest { version: string; dim: number; count: number; quantization?: string; scale?: number; hasFragments?: boolean }

describe.skipIf(!present)('web embedding pack (KJV)', () => {
    const manifest: WebManifest = present
        ? JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'))
        : { version: 'KJV', dim: 0, count: 0 }

    it('is a verses-only int8 pack with consistent sizes', () => {
        expect(manifest.quantization).toBe('int8')
        expect(manifest.hasFragments).toBe(false)
        expect(manifest.dim).toBe(384)

        const i8 = readFileSync(join(packDir, 'embeddings.i8'))
        expect(i8.byteLength).toBe(manifest.count * manifest.dim)

        const meta = JSON.parse(readFileSync(join(packDir, 'metadata.json'), 'utf8'))
        expect(meta.length).toBe(manifest.count)
        // Canonical verses only — no clause fragments leaked in.
        expect(meta.every((m: { reference: string }) => !m.reference.includes('__'))).toBe(true)
    })

    it('dequantized vectors stay ~unit norm, so cosine is preserved', () => {
        const buf = readFileSync(join(packDir, 'embeddings.i8'))
        const i8 = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        const dim = manifest.dim
        const scale = manifest.scale ?? 127
        // Check a few rows spread across the corpus.
        for (const row of [0, 1000, manifest.count - 1]) {
            let sumSq = 0
            for (let d = 0; d < dim; d++) {
                const x = i8[row * dim + d] / scale
                sumSq += x * x
            }
            const norm = Math.sqrt(sumSq)
            expect(norm).toBeGreaterThan(0.95)
            expect(norm).toBeLessThan(1.05)
        }
    })
})
