/**
 * Phonetic matching for sung lyrics against a garbled transcript.
 *
 * Lyric transcription is not speech transcription. Published state of the art
 * for automatic lyrics transcription is ~25% WER *on source-separated vocals*
 * with a very large offline model; a small streaming model running on a full
 * band mix does far worse. Observed against a real service:
 *
 *   "Clothed in Majesty"        -> "Cloth and majesty"
 *   "The splendour of a King"   -> "The splendor of a key"
 *   "Let all the earth rejoice" -> "Your futures all the earth rebs herself"
 *
 * Those are not word errors in any useful sense — matched as *words* they share
 * almost nothing — but they are near-identical as *sounds*. Comparing what the
 * words sound like rather than how they are spelled recovers most of them.
 *
 * The code below is a deliberately small Metaphone-style reduction rather than
 * a full Double Metaphone. It keeps a consonant skeleton and, crucially,
 * neutralizes voicing pairs (d/t, b/p, g/k, v/f, z/s) — the standard trick in
 * phonetic fuzzy matching, and exactly the distinction a singer holding a note
 * over a drum kit is least likely to preserve.
 *
 * IMPORTANT — where this is safe to use. Loosening similarity raises recall and
 * lowers precision, and a precision failure here puts the wrong lyrics on a
 * screen in front of a congregation. It is safe where a prior already
 * constrains the candidates to a handful of lines (the position tracker, which
 * knows roughly where in the song we are, and the set-list-scoped identifier,
 * where the operator has declared the candidate songs). It is NOT safe as a
 * blanket loosening of whole-library identification — see songIdentification.ts
 * for how a single filler line beat a real one on the strict scorer alone.
 */

/** Vowels are dropped after the first character, as in Metaphone. */
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * Reduce a word to a consonant skeleton approximating how it sounds.
 *
 * Voicing is deliberately collapsed (d->T, b->P, g->K, v->F, z->S) so that
 * pairs a listener could confuse are spelled the same here.
 */
export function phoneticCode(word: string): string {
    const w = word.toLowerCase().replace(/[^a-z]/g, '')
    if (!w) return ''

    let out = ''
    let i = 0
    // Keep a leading vowel: it is the one vowel that reliably survives, and
    // dropping it merges words that never sound alike ("all"/"la").
    if (VOWELS.has(w[0])) {
        out += w[0].toUpperCase()
        i = 1
    }

    while (i < w.length) {
        const c = w[i]
        const next = w[i + 1] ?? ''
        const pair = c + next

        // Skip a repeated letter — doubling is orthographic, not audible.
        if (c === w[i - 1]) {
            i++
            continue
        }
        if (VOWELS.has(c)) {
            i++
            continue
        }

        switch (pair) {
            case 'th':
                out += '0'
                i += 2
                continue
            case 'ch':
            case 'sh':
                out += 'X'
                i += 2
                continue
            case 'ph':
                out += 'F'
                i += 2
                continue
            case 'gh':
                // Silent in "night"/"through"; F in "laugh". Silence is the
                // commoner case and the safer default.
                i += 2
                continue
            case 'ck':
                out += 'K'
                i += 2
                continue
            case 'dg':
                out += 'J'
                i += 2
                continue
            case 'wh':
                out += 'W'
                i += 2
                continue
        }

        switch (c) {
            case 'c':
                out += 'eiy'.includes(next) ? 'S' : 'K'
                break
            case 'q':
                out += 'K'
                break
            case 'x':
                out += 'KS'
                break
            case 'g':
                out += 'K' // voicing pair with k
                break
            case 'd':
                out += 'T' // voicing pair with t
                break
            case 'b':
                out += 'P' // voicing pair with p
                break
            case 'v':
                out += 'F' // voicing pair with f
                break
            case 'z':
                out += 'S' // voicing pair with s
                break
            case 'y':
            case 'h':
                // Only audible as a consonant before a vowel ("yes", "hide");
                // otherwise it is colouring a vowel we already dropped.
                if (VOWELS.has(next)) out += c.toUpperCase()
                break
            default:
                out += c.toUpperCase()
        }
        i++
    }

    // Collapse runs the substitutions above may have created (e.g. "ks" + "s").
    return out.replace(/(.)\1+/g, '$1')
}

/** Levenshtein distance, iterative with a single row. */
function editDistance(a: string, b: string): number {
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
        }
        prev = cur
    }
    return prev[b.length]
}

/** Similarity of two phonetic codes in [0, 1]. */
export function codeSimilarity(a: string, b: string): number {
    if (!a && !b) return 1
    if (!a || !b) return 0
    const longest = Math.max(a.length, b.length)
    return 1 - editDistance(a, b) / longest
}

/**
 * Two tokens are treated as the same word below this code similarity only if
 * they are close enough that a listener could plausibly confuse them. Set by
 * measurement against real mis-transcriptions rather than taste: lower admits
 * "great"/"crazy" (KRT/KRS, 0.67), which is precisely the confusion that put
 * the wrong song on the projector.
 */
export const TOKEN_MATCH_FLOOR = 0.75

function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
}

/**
 * How much of `line` is audible in `query`, in [0, 1].
 *
 * Coverage of the *line* rather than symmetric overlap, because the query is a
 * rolling transcript window that routinely carries words from before and after
 * the line — penalizing those would score a perfectly-sung line down for the
 * sin of being surrounded by other singing.
 *
 * Each line token takes the best phonetic match available among the query's
 * tokens, and contributes that similarity (not a binary hit), so a near-miss
 * counts for nearly as much as an exact one and a wild miss counts for little.
 */
export function phoneticCoverage(query: string, line: string): number {
    const q = words(query)
    const l = words(line)
    if (q.length === 0 || l.length === 0) return 0

    const qCodes = q.map(phoneticCode).filter(Boolean)
    const lCodes = l.map(phoneticCode).filter(Boolean)
    if (qCodes.length === 0 || lCodes.length === 0) return 0

    let total = 0
    for (const lc of lCodes) {
        let best = 0
        for (const qc of qCodes) {
            const s = codeSimilarity(lc, qc)
            if (s > best) best = s
            if (best === 1) break
        }
        total += best >= TOKEN_MATCH_FLOOR ? best : 0
    }
    return total / lCodes.length
}

/**
 * Phonetic similarity between a transcript window and a candidate lyric line.
 *
 * Word-boundary errors ("Clothed in" -> "Cloth and") survive token-wise
 * matching poorly, so this also compares the two phonetic skeletons as
 * character trigrams, which ignore where the spaces landed, and takes whichever
 * view is kinder to the line.
 */
export function phoneticSimilarity(query: string, line: string): number {
    const coverage = phoneticCoverage(query, line)

    const qSkeleton = words(query).map(phoneticCode).join('')
    const lSkeleton = words(line).map(phoneticCode).join('')
    const trigram = trigramCoverage(qSkeleton, lSkeleton)

    return Math.max(coverage, trigram)
}

/** Fraction of `line`'s character trigrams present in `query`. */
function trigramCoverage(query: string, line: string): number {
    if (line.length < 3 || query.length < 3) return 0
    const qGrams = new Set<string>()
    for (let i = 0; i + 3 <= query.length; i++) qGrams.add(query.slice(i, i + 3))
    const lGrams = new Set<string>()
    for (let i = 0; i + 3 <= line.length; i++) lGrams.add(line.slice(i, i + 3))
    if (lGrams.size === 0) return 0
    let present = 0
    for (const g of lGrams) if (qGrams.has(g)) present++
    return present / lGrams.size
}
