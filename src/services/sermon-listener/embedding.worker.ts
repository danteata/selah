/**
 * Embedding Web Worker
 *
 * Runs ONNX inference off the main thread so the UI stays responsive
 * while generating verse embeddings.
 *
 * Transformers.js is BUNDLED, not fetched from a CDN. The CDN import it
 * replaced cost a network round-trip before the first embedding could run,
 * broke first-run embedding offline, and — because a cross-origin script is
 * not loadable under COEP — blocked the cross-origin isolation that
 * multi-threaded ONNX needs (see `configureWasmBackend`).
 *
 * The first message sent to the worker may be a `{ setup }` payload from
 * `localEmbeddings.ts` that tells the worker to use a locally-bundled model
 * (via Tauri's `asset://` protocol) instead of the HuggingFace Hub. On web
 * we keep the Hub fallback so the experience is identical.
 */

import * as transformers from '@xenova/transformers'

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null
let loadPromise: Promise<void> | null = null
let localModelPath: string | null = null

/**
 * Point ORT-WASM at every core we're allowed to use.
 *
 * The default is a single thread, and MiniLM inference is the whole cost of
 * the semantic path — sentence pass and sliding-window fallback both. Threads
 * require SharedArrayBuffer, which the browser only exposes when the document
 * is cross-origin isolated (COOP: same-origin + COEP: require-corp). We set
 * those headers for the desktop webview; where they're absent the check below
 * simply leaves the single-threaded default in place, so this is safe to run
 * unconditionally.
 */
function configureWasmBackend(): void {
  const wasm = transformers.env?.backends?.onnx?.wasm
  if (!wasm) return

  const isolated = typeof self !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined

  if (isolated && cores && cores > 1) {
    // Leave a core for the UI thread and the similarity worker; ORT gains
    // little past ~4 threads on a model this small.
    wasm.numThreads = Math.max(1, Math.min(4, cores - 1))
  } else {
    wasm.numThreads = 1
  }
  wasm.simd = true
}

async function loadEmbedder(): Promise<void> {
  if (embedder) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    configureWasmBackend()
    if (localModelPath) {
      // Desktop: read the quantized ONNX + tokenizer from the bundled Tauri
      // resource via the asset protocol. No network round-trip at any point.
      transformers.env.allowLocalModels = true
      transformers.env.localModelPath = localModelPath
      transformers.env.allowRemoteModels = false
      transformers.env.useBrowserCache = false
    } else {
      // Web / dev fallback: let transformers.js fetch from HuggingFace Hub
      // and cache the weights in the browser's storage.
      transformers.env.allowLocalModels = false
      transformers.env.allowRemoteModels = true
      transformers.env.useBrowserCache = true
    }
    embedder = await transformers.pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    })
  })()

  await loadPromise
  loadPromise = null
}

interface WorkerSetupRequest {
  id: number
  setup: { localModelPath?: string | null }
}

interface WorkerEmbedRequest {
  id: number
  texts: string[]
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

    const INFERENCE_BATCH = 32
    const embeddings: number[][] = []
    let dimensions = 0

    for (let i = 0; i < texts.length; i += INFERENCE_BATCH) {
      const batch = texts.slice(i, i + INFERENCE_BATCH)

      if (batch.length === 1) {
        const result = await embedder(batch[0], { pooling: 'mean', normalize: true })
        const tensor = result as unknown as { data: Float32Array; dims: number[] }
        embeddings.push(Array.from(tensor.data))
        dimensions = tensor.data.length
      } else {
        const results = await embedder(batch, { pooling: 'mean', normalize: true })
        const batchTensor = results as unknown as { data: Float32Array; dims: number[] }
        const dim = batchTensor.dims[batchTensor.dims.length - 1]
        dimensions = dim

        for (let j = 0; j < batch.length; j++) {
          const start = j * dim
          embeddings.push(Array.from(batchTensor.data.slice(start, start + dim)))
        }
      }

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
