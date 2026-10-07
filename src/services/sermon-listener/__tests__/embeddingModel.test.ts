import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EMBEDDING_GEMMA, MINILM } from '../embeddingModel'
import { SCORE_CALIBRATION } from '../embeddingCalibration'
import { calibrateScore as calibrateFor, rawScoreFor as rawFor } from '../scoreCalibration'
// The build scripts' copy of the model config.
import { EMBEDDING_MODEL as SCRIPT_MODEL } from '../../../../scripts/lib/embeddingModel.mjs'

const REPO_ROOT = join(__dirname, '../../../..')

// Four things must name the same model: the native embedder, the build
// scripts, the verse pack queries are scored against, and the score
// calibration. Any one of them drifting doesn't fail at runtime — it ranks
// verses at random, or quietly shifts every detection threshold — so drift has
// to fail here instead.
describe('EmbeddingGemma wiring (desktop)', () => {
    it('the build scripts use the same model as the app', () => {
        expect(SCRIPT_MODEL).toEqual(EMBEDDING_GEMMA)
    })

    it('the desktop WEB pack was built with that model', () => {
        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'src-tauri/semantic-packs/WEB/manifest.json'), 'utf8'),
        )
        expect(manifest.modelName).toBe(EMBEDDING_GEMMA.id)
        expect(manifest.dim).toBe(EMBEDDING_GEMMA.dimensions)
    })

    it('the score calibration was fitted for that model', () => {
        expect(SCORE_CALIBRATION.modelId).toBe(EMBEDDING_GEMMA.id)
        expect(SCORE_CALIBRATION.referenceModelId).toBe(MINILM.id)
        expect(SCORE_CALIBRATION.knots.length).toBeGreaterThanOrEqual(2)
    })

    it('the native embedder runs the bundled model with the same width and limit', () => {
        const rust = readFileSync(join(REPO_ROOT, 'src-tauri/src/embeddings.rs'), 'utf8')
        expect(rust).toContain(`const MODEL_DIR: &str = "assets/embedding-models/${EMBEDDING_GEMMA.id}";`)
        expect(rust).toContain(`pub const DIMENSIONS: usize = ${EMBEDDING_GEMMA.dimensions};`)
        expect(rust).toContain(`const MAX_TOKENS: usize = ${EMBEDDING_GEMMA.maxTokens};`)
    })
})

describe('MiniLM wiring (web)', () => {
    it('the web WEB pack was built with MiniLM', () => {
        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'public/embedding-packs/WEB/manifest.json'), 'utf8'),
        )
        expect(manifest.modelName).toBe(MINILM.id)
        expect(manifest.dim).toBe(MINILM.dimensions)
    })
})

describe('score calibration', () => {
    const calibrateScore = (raw: number) => calibrateFor(raw, EMBEDDING_GEMMA.id)
    const rawScoreFor = (t: number) => rawFor(t, EMBEDDING_GEMMA.id)

    it('leaves MiniLM scores alone: they are the scale the thresholds speak', () => {
        expect(calibrateFor(0.73, MINILM.id)).toBe(0.73)
        expect(rawFor(0.73, MINILM.id)).toBe(0.73)
    })

    it('is strictly increasing, so it never reorders candidates', () => {
        const xs = Array.from({ length: 101 }, (_, i) => -0.2 + i * 0.012)
        const ys = xs.map(calibrateScore)
        for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
    })

    it('translates a threshold back to the raw score that meets it', () => {
        for (const t of [0.55, 0.6, 0.62, 0.65, 0.68, 0.7, 0.72]) {
            expect(calibrateScore(rawScoreFor(t))).toBeCloseTo(t, 6)
        }
    })

    it('maps each knot exactly', () => {
        for (const [raw, calibrated] of SCORE_CALIBRATION.knots) {
            expect(calibrateScore(raw)).toBeCloseTo(calibrated, 6)
        }
    })
})
