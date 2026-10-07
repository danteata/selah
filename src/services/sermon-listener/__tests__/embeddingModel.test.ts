import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EMBEDDING_MODEL } from '../embeddingModel'
import { SCORE_CALIBRATION } from '../embeddingCalibration'
import { calibrateScore, rawScoreFor } from '../scoreCalibration'
// The build scripts' copy of the model config.
import { EMBEDDING_MODEL as SCRIPT_MODEL } from '../../../../scripts/lib/embeddingModel.mjs'

const REPO_ROOT = join(__dirname, '../../../..')

// Three things must name the same model: the worker's config, the verse pack
// queries are scored against, and the score calibration. Any one of them
// drifting doesn't fail at runtime — it ranks verses at random, or quietly
// shifts every detection threshold — so drift has to fail here instead.
describe('embedding model wiring', () => {
    it('the build scripts use the same model as the app', () => {
        expect(SCRIPT_MODEL).toEqual(EMBEDDING_MODEL)
    })

    it('the shipped WEB pack was built with that model', () => {
        const manifest = JSON.parse(
            readFileSync(join(REPO_ROOT, 'public/embedding-packs/WEB/manifest.json'), 'utf8'),
        )
        expect(manifest.modelName).toBe(EMBEDDING_MODEL.id)
        expect(manifest.dim).toBe(EMBEDDING_MODEL.dimensions)
    })

    it('the score calibration was fitted for that model', () => {
        expect(SCORE_CALIBRATION.modelId).toBe(EMBEDDING_MODEL.id)
        expect(SCORE_CALIBRATION.knots.length).toBeGreaterThanOrEqual(2)
    })
})

describe('score calibration', () => {
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
