/**
 * Embedding Web Worker
 *
 * Runs ONNX inference off the main thread so the UI stays responsive
 * while generating verse embeddings. Uses Transformers.js loaded from
 * the same CDN the main thread uses.
 *
 * The first message sent to the worker may be a `{ setup }` payload from
 * `localEmbeddings.ts` that tells the worker to use a locally-bundled model
 * (via Tauri's `asset://` protocol) instead of the HuggingFace Hub. On web
 * we keep the CDN/Hub fallback so the experience is identical.
 */

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1'
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null
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

async function loadEmbedder(): Promise<void> {
  if (embedder) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const transformers = await loadTransformers()
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
