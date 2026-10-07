/**
 * Embedding Web Worker
 *
 * Runs ONNX inference off the main thread so the UI stays responsive
 * while generating verse embeddings.
 *
 * Transformers.js is loaded from a CDN at runtime.
 *
 * A static `import * as transformers from '@xenova/transformers'` was tried
 * and REVERTED: it makes Vite pre-bundle onnxruntime-web's UMD build, which
 * dies inside a module worker with
 *   `Cannot read properties of undefined (reading 'registerBackend')`
 * taking the whole embedding worker — and therefore all semantic detection —
 * down with it. `vite build` succeeds, so this only shows up when the app
 * actually runs; verify any future attempt against a running app, not a build.
 *
 * Bundling is still worth doing (it removes a network round-trip before the
 * first embedding, works offline, and is a prerequisite for the cross-origin
 * isolation that multi-threaded ONNX needs). It has to be done together with
 * self-hosting the ORT wasm binaries and a Vite config that keeps ORT out of
 * the UMD path — not as a one-line import swap.
 *
 * The first message sent to the worker may be a `{ setup }` payload from
 * `localEmbeddings.ts` that tells the worker to use a locally-bundled model
 * (via Tauri's `asset://` protocol) instead of the HuggingFace Hub. On web
 * we keep the CDN/Hub fallback so the experience is identical.
 */

import { EMBEDDING_MODEL, withTaskPrefix, type EmbeddingKind } from './embeddingModel'

// Transformers.js 4: the first line with EmbeddingGemma (gemma3_text). The
// `transformers.min.js` build is self-contained — no bare `onnxruntime-web`
// import to resolve — which is what makes a runtime CDN import work at all.
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
let loadPromise: Promise<void> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transformersModule: any = null
let localModelPath: string | null = null

async function loadTransformers() {
  if (transformersModule) return transformersModule
  const moduleUrl = `${TRANSFORMERS_CDN}/dist/transformers.min.js`
  transformersModule = await import(/* @vite-ignore */ moduleUrl)
  return transformersModule
}

/**
 * Point ORT-WASM at every core we're allowed to use.
 *
 * Embedding is the whole cost of the semantic path — sentence pass and
 * sliding-window fallback both — and EmbeddingGemma is far heavier than the
 * MiniLM it replaced, so threads matter more than they did. Threads require
 * SharedArrayBuffer, which the browser only exposes when the document is
 * cross-origin isolated (COOP: same-origin + COEP: require-corp). Where that
 * is absent the check below leaves the single-threaded default in place, so
 * this is safe to run unconditionally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function configureWasmBackend(transformers: any): void {
  const wasm = transformers.env?.backends?.onnx?.wasm
  if (!wasm) return

  const isolated = typeof self !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined

  if (isolated && cores && cores > 1) {
    // Leave a core for the UI thread and the similarity worker.
    wasm.numThreads = Math.max(1, Math.min(4, cores - 1))
  } else {
    wasm.numThreads = 1
  }
  wasm.simd = true
}

/**
 * WebGPU when the webview offers it, else WASM. On WebGPU a live batch of
 * sentences embeds about 4x faster (133 ms vs 576 ms for four, measured), and
 * the vectors are identical to WASM's, so the choice never changes a result.
 * WebView2 ships WebGPU on most hardware; WKWebView has it from macOS 26, so
 * older Macs and GPUs without an adapter take the WASM path. A WebGPU device
 * that exists but fails to start a session also falls back rather than
 * leaving the detector without a model.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadModel(transformers: any) {
  const options = { dtype: EMBEDDING_MODEL.dtype }
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu
  if (hasWebGpu) {
    try {
      const gpuModel = await transformers.AutoModel.from_pretrained(EMBEDDING_MODEL.id, { ...options, device: 'webgpu' })
      console.info('[EmbeddingWorker] embedding model ready on WebGPU')
      return gpuModel
    } catch (err) {
      console.warn('[EmbeddingWorker] WebGPU unavailable, using WASM:', err instanceof Error ? err.message : err)
    }
  }
  const wasmModel = await transformers.AutoModel.from_pretrained(EMBEDDING_MODEL.id, { ...options, device: 'wasm' })
  console.info('[EmbeddingWorker] embedding model ready on WASM')
  return wasmModel
}

async function loadEmbedder(): Promise<void> {
  if (model) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const transformers = await loadTransformers()
    configureWasmBackend(transformers)
    if (localModelPath) {
      // Desktop: read the 8-bit ONNX (and its external weights file) plus the
      // tokenizer from the bundled Tauri resource via the asset protocol. No
      // network round-trip for the model at any point.
      transformers.env.allowLocalModels = true
      transformers.env.localModelPath = localModelPath
      transformers.env.allowRemoteModels = false
      transformers.env.useBrowserCache = false
    } else {
      // Web / dev fallback: fetch from the Hugging Face Hub and cache the
      // weights in the browser's storage.
      transformers.env.allowLocalModels = false
      transformers.env.allowRemoteModels = true
      transformers.env.useBrowserCache = true
    }
    tokenizer = await transformers.AutoTokenizer.from_pretrained(EMBEDDING_MODEL.id)
    model = await loadModel(transformers)
  })()

  try {
    await loadPromise
  } finally {
    loadPromise = null
  }
}

/**
 * Embed one batch. EmbeddingGemma's ONNX graph does the pooling and the
 * projection itself and returns `sentence_embedding`, already L2-normalised —
 * so this is not the `pooling: 'mean'` pipeline MiniLM used, which would skip
 * the projection layers and produce the wrong vectors without any error.
 */
async function embedBatch(texts: string[], kind: EmbeddingKind): Promise<{ vectors: number[][]; dim: number }> {
  const inputs = await tokenizer(texts.map((t) => withTaskPrefix(t, kind)), {
    padding: true,
    truncation: true,
    max_length: EMBEDDING_MODEL.maxTokens,
  })
  const { sentence_embedding } = await model(inputs)
  const tensor = sentence_embedding as { data: Float32Array; dims: number[] }
  const dim = tensor.dims[tensor.dims.length - 1]
  const vectors: number[][] = []
  for (let j = 0; j < texts.length; j++) {
    vectors.push(Array.from(tensor.data.subarray(j * dim, (j + 1) * dim)))
  }
  return { vectors, dim }
}

interface WorkerSetupRequest {
  id: number
  setup: { localModelPath?: string | null }
}

interface WorkerEmbedRequest {
  id: number
  texts: string[]
  kind: EmbeddingKind
}

type WorkerRequest = WorkerSetupRequest | WorkerEmbedRequest

function isSetupRequest(req: WorkerRequest): req is WorkerSetupRequest {
  return 'setup' in req
}

interface WorkerSuccessResponse {
  id: number
  embeddings: number[][]
  dimensions: number
}

interface WorkerErrorResponse {
  id: number
  error: string
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  const { id } = req

  try {
    if (isSetupRequest(req)) {
      // Configure once; resolves immediately so the main thread can proceed
      // to the next embedBatch call which will trigger the actual load.
      if (req.setup.localModelPath) {
        localModelPath = req.setup.localModelPath
      }
      self.postMessage({ id, embeddings: [], dimensions: 0 })
      return
    }

    const texts = req.texts
    await loadEmbedder()

    // Small batches: padding makes a batch as slow as its longest member, and
    // a long batch blocks the next live query behind it.
    const INFERENCE_BATCH = 16
    const embeddings: number[][] = []
    let dimensions = 0

    for (let i = 0; i < texts.length; i += INFERENCE_BATCH) {
      const { vectors, dim } = await embedBatch(texts.slice(i, i + INFERENCE_BATCH), req.kind)
      embeddings.push(...vectors)
      dimensions = dim

      // Yield back to the event loop every batch so the worker doesn't
      // starve other messages (e.g. heartbeat / abort).
      if (texts.length > 100) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }

    const response: WorkerSuccessResponse = { id, embeddings, dimensions }
    self.postMessage(response)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const response: WorkerErrorResponse = { id, error }
    self.postMessage(response)
  }
}
