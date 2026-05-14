/**
 * Embedding Web Worker
 *
 * Runs ONNX inference off the main thread so the UI stays responsive
 * while generating verse embeddings. Uses Transformers.js loaded from
 * the same CDN the main thread uses.
 */

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1'
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null
let loadPromise: Promise<void> | null = null

async function loadEmbedder(): Promise<void> {
  if (embedder) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const moduleUrl = `${TRANSFORMERS_CDN}/dist/transformers.min.js`
    // @ts-expect-error dynamic CDN import
    const transformers = await import(/* @vite-ignore */ moduleUrl)
    transformers.env.allowLocalModels = false
    transformers.env.useBrowserCache = true
    embedder = await transformers.pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    })
  })()

  await loadPromise
  loadPromise = null
}

interface WorkerRequest {
  id: number
  texts: string[]
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
  const { id, texts } = event.data

  try {
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
