#!/usr/bin/env node
/**
 * Compare embedding packs as the UNIVERSAL semantic index.
 *
 * Whichever pack `semanticPack.ts` resolves answers "search by meaning" for
 * every Bible version the user reads. So the question isn't "which translation
 * is best" — it's "which pack's verse text retrieves the right reference from
 * a query someone actually types or says". Those queries are modern English
 * and rarely quote any translation verbatim.
 *
 * This runs the real MiniLM model (not the token-overlap stub the CI eval
 * uses), so it's opt-in and takes a minute:
 *
 *   node scripts/eval-semantic-pack.mjs
 *   node scripts/eval-semantic-pack.mjs --packs WEB,KJV --k 5
 *
 * Reports Recall@1, Recall@5 and MRR per pack over a paraphrase query set.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const { values: args } = parseArgs({
    options: {
        packs: { type: 'string', default: 'WEB,KJV' },
        k: { type: 'string', default: '5' },
        model: { type: 'string', default: 'Xenova/all-MiniLM-L6-v2' },
        verbose: { type: 'boolean', default: false },
    },
})

const K = parseInt(args.k, 10) || 5

/**
 * Paraphrase queries: how people actually search. Deliberately NOT verbatim
 * from any translation — verbatim KJV would just measure "is this the KJV
 * pack", which tells us nothing about the universal-index question. Sources
 * are the phrasings that show up in sermon transcripts and half-remembered
 * searches.
 */
const QUERIES = [
    { q: 'god loved the world so much he gave his only son', target: 'John 3:16' },
    { q: 'the lord takes care of me like a shepherd, I have everything I need', target: 'Psalms 23:1' },
    { q: 'even walking through the darkest valley I am not afraid', target: 'Psalms 23:4' },
    { q: 'everything works out for good for people who love god', target: 'Romans 8:28' },
    { q: 'I can do anything because christ gives me strength', target: 'Philippians 4:13' },
    { q: 'trust god completely instead of relying on your own thinking', target: 'Proverbs 3:5' },
    { q: 'saved by grace through faith, not something you earned', target: 'Ephesians 2:8' },
    { q: 'come to me if you are tired and I will give you rest', target: 'Matthew 11:28' },
    { q: 'those who hope in the lord get new strength and fly like eagles', target: 'Isaiah 40:31' },
    { q: 'in the beginning god made the sky and the earth', target: 'Genesis 1:1' },
    { q: 'I am standing at the door knocking', target: 'Revelation 3:20' },
    { q: 'god has plans to give you a future and hope', target: 'Jeremiah 29:11' },
    { q: 'love is patient and kind, it does not envy', target: '1 Corinthians 13:4' },
    { q: 'do not worry about tomorrow', target: 'Matthew 6:34' },
    { q: 'ask and you will receive, knock and the door opens', target: 'Matthew 7:7' },
    { q: 'everyone has sinned and falls short of gods glory', target: 'Romans 3:23' },
    { q: 'the payment for sin is death but gods gift is eternal life', target: 'Romans 6:23' },
    { q: 'if we admit our sins he forgives us and cleans us up', target: '1 John 1:9' },
    { q: 'your word is a lamp for my feet lighting my path', target: 'Psalms 119:105' },
    { q: 'be strong and brave, do not be afraid, god goes with you', target: 'Joshua 1:9' },
    { q: 'god is our safe place and strength, always there in trouble', target: 'Psalms 46:1' },
    { q: 'let your light shine so people see your good works', target: 'Matthew 5:16' },
    { q: 'no condemnation for those who belong to christ', target: 'Romans 8:1' },
    { q: 'if anyone is in christ they are a new creation, the old is gone', target: '2 Corinthians 5:17' },
    { q: 'the fruit of the spirit is love joy peace patience', target: 'Galatians 5:22' },
    { q: 'do not be anxious, pray about everything with thanksgiving', target: 'Philippians 4:6' },
    { q: 'god disciplines the ones he loves', target: 'Hebrews 12:6' },
    { q: 'faith is being sure of what we hope for', target: 'Hebrews 11:1' },
    { q: 'consider it joy when you face different kinds of trials', target: 'James 1:2' },
    { q: 'cast all your worries on him because he cares for you', target: '1 Peter 5:7' },
    { q: 'jesus said I am the way the truth and the life', target: 'John 14:6' },
    { q: 'the truth will set you free', target: 'John 8:32' },
    { q: 'greater love has no one than to lay down his life for friends', target: 'John 15:13' },
    { q: 'we love because he first loved us', target: '1 John 4:19' },
    { q: 'train up a child in the way he should go', target: 'Proverbs 22:6' },
    { q: 'a soft answer turns away anger', target: 'Proverbs 15:1' },
    { q: 'seek first the kingdom of god and everything else gets added', target: 'Matthew 6:33' },
    { q: 'where two or three gather together I am there with them', target: 'Matthew 18:20' },
    { q: 'go and make disciples of all nations', target: 'Matthew 28:19' },
    { q: 'the joy of the lord is my strength', target: 'Nehemiah 8:10' },
]

function loadPack(version) {
    const dir = join(REPO_ROOT, 'public/embedding-packs', version)
    const manifestPath = join(dir, 'manifest.json')
    if (!existsSync(manifestPath)) return null

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'))
    const raw = readFileSync(join(dir, 'embeddings.i8'))
    const i8 = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const scale = manifest.scale ?? 127

    // Dequantize once into a flat Float32Array — same as the runtime loader.
    const packed = new Float32Array(i8.length)
    for (let i = 0; i < i8.length; i++) packed[i] = i8[i] / scale

    return { version, dim: manifest.dim, count: manifest.count, metadata, packed }
}

/** Rank of `target` in the pack's top-K for this query embedding, or Infinity. */
function rankOf(pack, query, target, k) {
    const { dim, count, packed, metadata } = pack
    // Top-k by dot product (vectors are L2-normalised, so dot == cosine).
    const topScores = new Float64Array(k).fill(-Infinity)
    const topIdx = new Int32Array(k).fill(-1)

    for (let row = 0; row < count; row++) {
        const off = row * dim
        let dot = 0
        for (let d = 0; d < dim; d++) dot += packed[off + d] * query[d]
        if (dot <= topScores[k - 1]) continue
        // Insertion into the small top-k buffer.
        let pos = k - 1
        while (pos > 0 && topScores[pos - 1] < dot) {
            topScores[pos] = topScores[pos - 1]
            topIdx[pos] = topIdx[pos - 1]
            pos--
        }
        topScores[pos] = dot
        topIdx[pos] = row
    }

    for (let i = 0; i < k; i++) {
        if (topIdx[i] >= 0 && metadata[topIdx[i]].reference === target) return i + 1
    }
    return Infinity
}

async function main() {
    const versions = args.packs.split(',').map((s) => s.trim()).filter(Boolean)
    const packs = []
    for (const v of versions) {
        const pack = loadPack(v)
        if (!pack) {
            console.warn(`[eval] no pack at public/embedding-packs/${v} — skipping`)
            continue
        }
        console.log(`[eval] loaded ${v}: ${pack.count} verses × ${pack.dim} dims`)
        packs.push(pack)
    }
    if (packs.length === 0) {
        console.error('[eval] no packs to compare')
        process.exit(1)
    }

    const { pipeline, env } = await import('@xenova/transformers')
    const localDir = join(REPO_ROOT, 'src-tauri', 'assets', 'embedding-models')
    if (existsSync(join(localDir, args.model))) {
        env.allowLocalModels = true
        env.localModelPath = localDir
        env.allowRemoteModels = false
    }
    const embedder = await pipeline('feature-extraction', args.model, { quantized: true })
    console.log(`[eval] model ready — ${QUERIES.length} paraphrase queries, k=${K}\n`)

    const results = new Map(packs.map((p) => [p.version, { hit1: 0, hitK: 0, rr: 0 }]))

    for (const { q, target } of QUERIES) {
        const tensor = await embedder(q, { pooling: 'mean', normalize: true })
        const query = tensor.data

        const line = []
        for (const pack of packs) {
            const rank = rankOf(pack, query, target, K)
            const agg = results.get(pack.version)
            if (rank === 1) agg.hit1++
            if (rank <= K) agg.hitK++
            if (rank !== Infinity) agg.rr += 1 / rank
            line.push(`${pack.version}:${rank === Infinity ? '-' : rank}`)
        }
        if (args.verbose) console.log(`  ${line.join('  ')}  ${target}  "${q}"`)
    }

    const n = QUERIES.length
    console.log('\n  pack   Recall@1   Recall@%d   MRR', K)
    console.log('  ' + '-'.repeat(38))
    for (const pack of packs) {
        const { hit1, hitK, rr } = results.get(pack.version)
        console.log(
            `  ${pack.version.padEnd(6)} ${((hit1 / n) * 100).toFixed(1).padStart(7)}%  ${((hitK / n) * 100).toFixed(1).padStart(8)}%  ${(rr / n).toFixed(3).padStart(6)}`,
        )
    }
    console.log('')
}

main().catch((err) => {
    console.error('[eval] failed:', err)
    process.exit(1)
})
