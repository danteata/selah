import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SEMANTIC_PACK_PREFERENCE } from '../semanticPack'

// Validates the browser-servable packs produced by
// scripts/build-web-embedding-pack.mjs. Every pack under public/embedding-packs
// is checked; the suite skips when none have been generated (keeps CI green
// without the assets).
const packsRoot = join(process.cwd(), 'public/embedding-packs')
const packVersions = existsSync(packsRoot)
    ? readdirSync(packsRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(join(packsRoot, e.name, 'manifest.json')))
          .map((e) => e.name)
    : []

interface WebManifest { version: string; dim: number; count: number; quantization?: string; scale?: number; hasFragments?: boolean }

describe.skipIf(packVersions.length === 0)('browser embedding packs', () => {
    it('ships a pack for the preferred universal default', () => {
        // The resolver walks SEMANTIC_PACK_PREFERENCE in order at runtime, so a
        // missing top choice silently downgrades every user to the next one.
        // Fail loudly here instead.
        expect(packVersions).toContain(SEMANTIC_PACK_PREFERENCE[0])
    })

    describe.each(packVersions)('%s', (version) => {
        const packDir = join(packsRoot, version)
        const manifest: WebManifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'))

        it('is a verses-only int8 pack with consistent sizes', () => {
            expect(manifest.version).toBe(version)
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
})
