/**
 * Maps the embedding model's cosine scores onto the scale every threshold in
 * the semantic path was tuned on.
 *
 * Those thresholds — the word-count bands and window floor in
 * `semanticRetrievalPolicy`, the "good match" bar, the ambiguity margin, the
 * chapter-dedup deltas — were set against all-MiniLM-L6-v2 and against real
 * false positives it produced. A different model scores the same pair on a
 * different scale (EmbeddingGemma puts a true paraphrase near 0.70 where
 * MiniLM put it near 0.82), so swapping the model without this would quietly
 * re-tune every one of them at once.
 *
 * The map is monotonic, so it never reorders candidates: whatever the new
 * model ranks first stays first. It is fitted by quantile matching — score the
 * same queries with both models, then pair the two score distributions rank
 * for rank — and stored as knots in `embeddingCalibration.ts`, which
 * `scripts/calibrate-embedding-scores.mjs` generates. Re-run that after any
 * model change; a calibration fitted for another model is ignored rather than
 * applied (scores then pass through unchanged, and a warning says so).
 */

import { EMBEDDING_MODEL } from './embeddingModel'
import { SCORE_CALIBRATION } from './embeddingCalibration'

type Knots = ReadonlyArray<readonly [raw: number, calibrated: number]>

let warned = false

function activeKnots(): Knots | null {
    if (SCORE_CALIBRATION.modelId === EMBEDDING_MODEL.id && SCORE_CALIBRATION.knots.length >= 2) {
        return SCORE_CALIBRATION.knots
    }
    if (!warned) {
        warned = true
        console.warn(
            `[ScoreCalibration] calibration is for ${SCORE_CALIBRATION.modelId}, model is ${EMBEDDING_MODEL.id}; ` +
                'scores are uncalibrated — run scripts/calibrate-embedding-scores.mjs',
        )
    }
    return null
}

/** Piecewise-linear through the knots, extending the end segments past them. */
function interpolate(knots: Knots, x: number, from: 0 | 1, to: 0 | 1): number {
    let i = 1
    while (i < knots.length - 1 && x > knots[i][from]) i++
    const [a, b] = [knots[i - 1], knots[i]]
    const span = b[from] - a[from]
    if (span <= 0) return b[to]
    return a[to] + ((x - a[from]) / span) * (b[to] - a[to])
}

/** Model cosine → the reference scale the thresholds speak. */
export function calibrateScore(raw: number): number {
    const knots = activeKnots()
    return knots ? interpolate(knots, raw, 0, 1) : raw
}

/** Reference-scale threshold → the model cosine that meets it. */
export function rawScoreFor(calibrated: number): number {
    const knots = activeKnots()
    return knots ? interpolate(knots, calibrated, 1, 0) : calibrated
}
