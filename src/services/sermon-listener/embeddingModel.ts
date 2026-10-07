/**
 * The text-embedding model behind "search by meaning" and semantic verse
 * detection. One place, because three things have to agree on it: the worker
 * that embeds queries, the prebuilt verse pack those queries are scored
 * against, and the score calibration that keeps the detection thresholds
 * meaningful. A pack or calibration built for a different model is refused
 * rather than silently compared across embedding spaces.
 *
 * EmbeddingGemma 300M (Google), 8-bit ONNX. It replaced all-MiniLM-L6-v2:
 * on the paraphrase eval it finds the right verse first 80% of the time
 * against MiniLM's 70%, and it separates scripture from ordinary sermon talk
 * far better, which is what the false-positive guards were compensating for.
 * fp16 is not an option: its activations overflow in half precision. The
 * 4-bit files were tried and rejected: `model_q4` looks its token embeddings
 * up with `GatherBlockQuantized`, which ONNX Runtime's WASM build does not
 * implement (it loads in Node and fails in every webview), and the
 * `model_no_gather_q4` workaround ran ~5x slower than this file in WASM.
 * The 8-bit file produces the same vectors in Node, WASM and WebGPU (cosine
 * 1.000000 measured), which the pack depends on: it is built in Node and
 * queried in the webview.
 *
 * EmbeddingGemma is asymmetric: queries and documents carry different task
 * prefixes, so callers say which they are embedding (see `EmbeddingKind`).
 *
 * The build scripts read the same values from `scripts/lib/embeddingModel.mjs`;
 * a test keeps the two in step.
 */

export type EmbeddingKind = 'query' | 'document' | 'clustering'

export const EMBEDDING_MODEL = {
    /** Hugging Face repo id, and the directory name under the bundled assets. */
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    /** Transformers.js dtype: selects `onnx/model_quantized.onnx` (+ its
     *  external data). The pack must be built with this same file. */
    dtype: 'q8',
    dimensions: 768,
    /** Longest input embedded, in tokens. Sermon sentences and verses are far
     *  shorter; this only bounds the cost of a pathological input. */
    maxTokens: 512,
    prefixes: {
        query: 'task: search result | query: ',
        document: 'title: none | text: ',
        clustering: 'task: clustering | query: ',
    } satisfies Record<EmbeddingKind, string>,
} as const

export function withTaskPrefix(text: string, kind: EmbeddingKind): string {
    return EMBEDDING_MODEL.prefixes[kind] + text
}
