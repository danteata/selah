/**
 * The embedding model for the build/eval scripts — the Node twin of
 * `src/services/sermon-listener/embeddingModel.ts`, which documents the
 * choice. A test asserts the two agree, because a pack built with one model
 * and queried with another scores nonsense without failing.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const EMBEDDING_MODEL = {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype: 'q8',
    dimensions: 768,
    maxTokens: 512,
    prefixes: {
        query: 'task: search result | query: ',
        document: 'title: none | text: ',
        clustering: 'task: clustering | query: ',
    },
}

/** Hugging Face commit the bundled files come from — pinned so a re-upload
 *  upstream can't change what ships without a code change here. */
export const EMBEDDING_MODEL_REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66'

/** Exactly the files Transformers.js reads for this model and dtype, with the
 *  sha256 the downloader verifies. */
export const EMBEDDING_MODEL_FILES = [
    { path: 'config.json', size: 1765, sha256: '6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b' },
    { path: 'tokenizer.json', size: 20323312, sha256: '4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47' },
    { path: 'tokenizer_config.json', size: 1156830, sha256: '3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a' },
    { path: 'onnx/model_quantized.onnx', size: 567874, sha256: '172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8' },
    { path: 'onnx/model_quantized.onnx_data', size: 308890624, sha256: '705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0' },
]

/**
 * EmbeddingGemma is distributed under the Gemma Terms of Use, which require
 * this notice to travel with any copy we redistribute (Terms §3.1). The
 * downloader writes it beside the bundled weights.
 */
export const GEMMA_NOTICE = `Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms

This directory contains EmbeddingGemma 300M (Google DeepMind), converted to ONNX by
onnx-community: https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
Use of the model is also subject to the Gemma Prohibited Use Policy:
https://ai.google.dev/gemma/prohibited_use_policy
`

/**
 * Load the model with Transformers.js in Node. Uses the bundled copy under
 * `src-tauri/assets/embedding-models/` when the desktop prebuild has fetched
 * it, else the Hugging Face Hub.
 *
 * Returns `embed(texts, kind)` → number[][] of L2-normalised vectors.
 */
export async function loadEmbedder(repoRoot, { log = console.log } = {}) {
    const { AutoModel, AutoTokenizer, env } = await import('@huggingface/transformers')
    const localDir = join(repoRoot, 'src-tauri', 'assets', 'embedding-models')
    if (existsSync(join(localDir, EMBEDDING_MODEL.id, 'onnx', 'model_quantized.onnx'))) {
        env.allowLocalModels = true
        env.localModelPath = localDir
        env.allowRemoteModels = false
        log(`  using local model dir: ${localDir}`)
    } else {
        log('  using remote model (Hugging Face Hub)')
    }
    const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL.id)
    const model = await AutoModel.from_pretrained(EMBEDDING_MODEL.id, { dtype: EMBEDDING_MODEL.dtype })

    async function embed(texts, kind) {
        const prefix = EMBEDDING_MODEL.prefixes[kind]
        if (prefix === undefined) throw new Error(`unknown embedding kind: ${kind}`)
        const inputs = await tokenizer(texts.map((t) => prefix + t), {
            padding: true,
            truncation: true,
            max_length: EMBEDDING_MODEL.maxTokens,
        })
        const { sentence_embedding } = await model(inputs)
        return sentence_embedding.tolist()
    }
    return { embed, dimensions: EMBEDDING_MODEL.dimensions }
}
