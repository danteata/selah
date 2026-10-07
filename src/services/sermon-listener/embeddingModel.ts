/**
 * The text-embedding models behind "search by meaning" and semantic verse
 * detection, and which one this build runs.
 *
 * Three things have to agree on the model: whatever embeds the queries, the
 * prebuilt verse pack those queries are scored against, and the score
 * calibration that keeps the detection thresholds meaningful. A pack, cache or
 * calibration built for a different model is refused rather than silently
 * compared across embedding spaces.
 *
 * - Desktop: EmbeddingGemma 300M (Google), 8-bit ONNX, run natively by ONNX
 *   Runtime in the Rust backend (`src-tauri/src/embeddings.rs`). On the
 *   paraphrase eval it finds the right verse first 80% of the time against
 *   MiniLM's 70%, and it separates scripture from ordinary sermon talk far
 *   better. It ran in the webview in 0.1.26, and on macOS that grew WebKit's
 *   content process past its 8 GB limit within minutes: the page was killed
 *   and the window went black. Native, it holds a flat footprint.
 * - Web: all-MiniLM-L6-v2 through Transformers.js in a worker
 *   (`embedding.worker.ts`). Small enough to download in a browser, and no
 *   native code is available there.
 *
 * About EmbeddingGemma's files: fp16 is not an option, as its activations
 * overflow in half precision. The 8-bit file gives the same vectors under
 * Transformers.js in Node, where the desktop pack is built, as under native
 * ONNX Runtime, where desktop queries are embedded (a Rust test checks this).
 *
 * EmbeddingGemma is asymmetric: queries and documents carry different task
 * prefixes, so callers say which they are embedding (see `EmbeddingKind`).
 * MiniLM is symmetric and takes no prefix.
 *
 * The build scripts read EmbeddingGemma's values from
 * `scripts/lib/embeddingModel.mjs`; a test keeps the two in step.
 */

import { isDesktop } from '../../platform'

export type EmbeddingKind = 'query' | 'document' | 'clustering'

export interface EmbeddingModelSpec {
    /** Hugging Face repo id; also the directory name under the bundled assets. */
    readonly id: string
    /** Transformers.js dtype of the ONNX file, where the scripts load it. */
    readonly dtype?: string
    readonly dimensions: number
    /** Longest input embedded, in tokens. */
    readonly maxTokens: number
    readonly prefixes: Readonly<Record<EmbeddingKind, string>>
}

export const EMBEDDING_GEMMA = {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    /** Transformers.js dtype the build scripts load: `onnx/model_quantized.onnx`
     *  (+ its external data). The desktop app bundles and runs that same file. */
    dtype: 'q8',
    dimensions: 768,
    /** Sermon sentences and verses are far shorter; this only bounds the cost
     *  of a pathological input. */
    maxTokens: 512,
    prefixes: {
        query: 'task: search result | query: ',
        document: 'title: none | text: ',
        clustering: 'task: clustering | query: ',
    },
} as const satisfies EmbeddingModelSpec

export const MINILM = {
    id: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    maxTokens: 256,
    prefixes: { query: '', document: '', clustering: '' },
} as const satisfies EmbeddingModelSpec

/** Desktop runs EmbeddingGemma natively; the browser has only MiniLM. */
export function activeEmbeddingModel(): EmbeddingModelSpec {
    return isDesktop() ? EMBEDDING_GEMMA : MINILM
}

export function withTaskPrefix(text: string, kind: EmbeddingKind, model: EmbeddingModelSpec = activeEmbeddingModel()): string {
    return model.prefixes[kind] + text
}
