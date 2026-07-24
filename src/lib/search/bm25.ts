/**
 * Minimal Okapi BM25 over an in-memory document set.
 *
 * We index canonical verse text only (~31k docs per version), NOT the ~172k
 * clause fragments: fragments earn their keep on the dense side, and indexing
 * them lexically would both bloat the index and let fragment-heavy verses
 * multiply their own score. 31k short docs is trivial to score in a tight
 * loop, so the index is built once per version and cached by the caller.
 */

export interface Bm25Doc {
    id: string
    tokens: string[]
}

export interface Bm25Hit {
    id: string
    score: number
}

const K1 = 1.2
const B = 0.75

export class Bm25Index {
    private readonly docIds: string[] = []
    private readonly docLen: number[] = []
    private avgdl = 0
    /** term → array of [docIndex, termFreq]. */
    private readonly postings = new Map<string, Array<[number, number]>>()
    /** term → inverse document frequency. */
    private readonly idf = new Map<string, number>()
    private readonly k1: number
    private readonly b: number

    constructor(docs: Bm25Doc[], k1 = K1, b = B) {
        this.k1 = k1
        this.b = b
        const df = new Map<string, number>()
        let totalLen = 0

        docs.forEach((doc, docIndex) => {
            this.docIds.push(doc.id)
            this.docLen.push(doc.tokens.length)
            totalLen += doc.tokens.length

            const tf = new Map<string, number>()
            for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
            for (const [term, freq] of tf) {
                let post = this.postings.get(term)
                if (!post) { post = []; this.postings.set(term, post) }
                post.push([docIndex, freq])
                df.set(term, (df.get(term) ?? 0) + 1)
            }
        })

        const N = docs.length
        this.avgdl = N > 0 ? totalLen / N : 0
        for (const [term, docFreq] of df) {
            // Standard BM25 idf with +1 so common terms stay non-negative.
            this.idf.set(term, Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5)))
        }
    }

    get size(): number {
        return this.docIds.length
    }

    /** Score the query tokens against every doc that contains ≥1 term. */
    search(queryTokens: string[], topK: number): Bm25Hit[] {
        if (this.docIds.length === 0 || queryTokens.length === 0) return []

        // Unique query terms — a repeated query term shouldn't multiply weight.
        const terms = [...new Set(queryTokens)]
        const scores = new Map<number, number>()

        for (const term of terms) {
            const idf = this.idf.get(term)
            const post = this.postings.get(term)
            if (idf === undefined || !post) continue
            for (const [docIndex, freq] of post) {
                const dl = this.docLen[docIndex]
                const denom = freq + this.k1 * (1 - this.b + this.b * (dl / (this.avgdl || 1)))
                const contribution = idf * ((freq * (this.k1 + 1)) / (denom || 1))
                scores.set(docIndex, (scores.get(docIndex) ?? 0) + contribution)
            }
        }

        return [...scores.entries()]
            .map(([docIndex, score]) => ({ id: this.docIds[docIndex], score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
    }
}
