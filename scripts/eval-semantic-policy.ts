/**
 * What the live sermon detector would DO with each model's candidates — not
 * just how they rank. Runs the detector's own sentence-pass rule over the
 * candidates dumped by `calibrate-embedding-scores.mjs --dump`:
 *
 *   the first candidate that clears the word-count threshold AND the overlap
 *   validator is accepted, unless a different-verse runner-up is within the
 *   ambiguity margin (semanticVerseDetection.performSegmentedSearch).
 *
 * The reference model's raw scores go in as-is (the thresholds were tuned on
 * them); the current model's go through `calibrateScore`, exactly as
 * `searchVerseEmbeddings` applies it at runtime.
 *
 * Usage: npx vite-node scripts/eval-semantic-policy.ts -- <dump.json>
 */
import { readFileSync } from 'node:fs'
import {
    getDynamicThreshold,
    isAmbiguousMatch,
    validateSemanticMatch,
} from '../src/lib/semanticRetrievalPolicy'
import { EMBEDDING_GEMMA } from '../src/services/sermon-listener/embeddingModel'
import { calibrateScore } from '../src/services/sermon-listener/scoreCalibration'

interface Candidate { reference: string; book: string; chapter: number; text: string; score: number }
interface Row { q: string; target: string | null; set: string; model: Candidate[]; ref: Candidate[] }

const file = process.argv.filter((a) => a.endsWith('.json')).pop()
if (!file) throw new Error('usage: vite-node scripts/eval-semantic-policy.ts -- <dump.json>')
const rows: Row[] = JSON.parse(readFileSync(file, 'utf8'))

function decide(q: string, candidates: Candidate[]): Candidate | null {
    const wordCount = q.split(/\s+/).filter(Boolean).length
    const threshold = getDynamicThreshold(wordCount)
    const pick = candidates.find((m) => m.score >= threshold && validateSemanticMatch(q, m.text, wordCount))
    if (!pick || isAmbiguousMatch(pick, candidates)) return null
    return pick
}

type Tally = { n: number; right: number; wrong: number; none: number }
const tallies = new Map<string, { ref: Tally; model: Tally }>()
const blank = (): Tally => ({ n: 0, right: 0, wrong: 0, none: 0 })
const falsePositives: string[] = []

for (const row of rows) {
    const t = tallies.get(row.set) ?? { ref: blank(), model: blank() }
    tallies.set(row.set, t)
    const calibrated = row.model.map((c) => ({ ...c, score: calibrateScore(c.score, EMBEDDING_GEMMA.id) }))
    for (const [which, cands] of [['ref', row.ref], ['model', calibrated]] as const) {
        const tally = t[which]
        tally.n++
        const picked = decide(row.q, cands)
        if (!picked) tally.none++
        else if (picked.reference === row.target) tally.right++
        else {
            tally.wrong++
            if (row.set === 'negative' || row.set === 'live' || row.set === 'paraphrase') {
                falsePositives.push(`${which.padEnd(5)} ${row.set.padEnd(10)} "${row.q}" → ${picked.reference} (${picked.score.toFixed(3)})`)
            }
        }
    }
}

const pct = (x: number, n: number) => `${((x / n) * 100).toFixed(1)}%`.padStart(7)
console.log('\nset          n    | MiniLM: right  wrong   none | current: right  wrong   none')
for (const [set, { ref, model }] of tallies) {
    console.log(
        `${set.padEnd(11)} ${String(ref.n).padStart(4)}  |      ${pct(ref.right, ref.n)} ${pct(ref.wrong, ref.n)} ${pct(ref.none, ref.n)} |      ${pct(model.right, model.n)} ${pct(model.wrong, model.n)} ${pct(model.none, model.n)}`,
    )
}
console.log('\n"wrong" on the negative set is a verse projected for ordinary talk.')
if (falsePositives.length) {
    console.log('\nWrong verses accepted (negatives, and wrong picks on labeled sets):')
    for (const line of falsePositives) console.log('  ' + line)
}
