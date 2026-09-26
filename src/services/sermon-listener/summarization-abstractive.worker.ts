/**
 * Abstractive Summarization Worker
 *
 * Loads Xenova/distilbart-cnn-6-6 via @xenova/transformers in a Web Worker
 * to generate paraphrased summaries off the main thread.
 *
 * Model downloads on first use (~330MB) and caches in the browser.
 * Falls back to a smaller model if the primary one fails.
 */

const SUMMARIZATION_MODEL = 'Xenova/distilbart-cnn-6-6'
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1'

/** The slice of the CDN-loaded `@xenova/transformers` module this worker uses. */
interface TransformersModule {
    env: {
        allowLocalModels: boolean
        localModelPath: string
        allowRemoteModels: boolean
        useBrowserCache: boolean
    }
    pipeline: (task: 'summarization', model: string, options: { dtype: string }) => Promise<SummarizationPipeline>
}

interface SummarizationOutput {
    summary_text?: string
}

type SummarizationPipeline = (
    text: string,
    options: { max_length: number; min_length: number; do_sample: boolean },
) => Promise<SummarizationOutput | SummarizationOutput[]>

let transformersModule: TransformersModule | null = null
let summarizer: SummarizationPipeline | null = null
let loadingPromise: Promise<SummarizationPipeline> | null = null

async function loadTransformers(): Promise<TransformersModule> {
    if (transformersModule) return transformersModule
    const moduleUrl = `${TRANSFORMERS_CDN}/dist/transformers.min.js`
    const loaded: TransformersModule = await import(/* @vite-ignore */ moduleUrl)
    transformersModule = loaded
    return loaded
}

async function loadSummarizer(): Promise<SummarizationPipeline> {
    if (summarizer) return summarizer
    if (loadingPromise) return loadingPromise

    loadingPromise = (async () => {
        const transformers = await loadTransformers()

        // Check for local model in Tauri assets
        // Use self instead of window — window is undefined in Web Worker context
        const isDesktop = typeof globalThis !== 'undefined' && !!(globalThis as { __TAURI__?: unknown }).__TAURI__
        const localModelPath = isDesktop
            ? ['/assets/embedding-models/Xenova/distilbart-cnn-6-6']
            : null

        if (localModelPath) {
            try {
                transformers.env.allowLocalModels = true
                transformers.env.localModelPath = localModelPath[0]
                transformers.env.allowRemoteModels = false
                transformers.env.useBrowserCache = false
                const localSummarizer = await transformers.pipeline('summarization', SUMMARIZATION_MODEL, {
                    dtype: 'q8',
                })
                summarizer = localSummarizer
                return localSummarizer
            } catch {
                // Local model not available, fall through to remote
            }
        }

        // Fetch from HuggingFace Hub
        transformers.env.allowLocalModels = false
        transformers.env.allowRemoteModels = true
        transformers.env.useBrowserCache = true

        const remoteSummarizer = await transformers.pipeline('summarization', SUMMARIZATION_MODEL, {
            dtype: 'q8',
        })
        summarizer = remoteSummarizer
        return remoteSummarizer
    })()

    try {
        return await loadingPromise
    } catch (err) {
        loadingPromise = null
        throw err
    }
}

export interface SummarizeWorkerMessage {
    type: 'summarize'
    text: string
    maxLength?: number
    minLength?: number
    id: number
}

export interface SummarizeWorkerResult {
    type: 'result' | 'error' | 'progress'
    summary?: string
    error?: string
    progress?: number
    id: number
}

self.onmessage = async (event: MessageEvent<SummarizeWorkerMessage>) => {
    const { type, text, maxLength, minLength, id } = event.data

    if (type !== 'summarize') return

    try {
        self.postMessage({ type: 'progress' as const, progress: 0.1, id })

        const pipe = await loadSummarizer()

        self.postMessage({ type: 'progress' as const, progress: 0.5, id })

        // Limit input text length to avoid memory issues
        const inputText = text.length > 4000 ? text.slice(0, 4000) : text

        const result = await pipe(inputText, {
            max_length: maxLength ?? 150,
            min_length: minLength ?? 30,
            do_sample: false,
        })

        const summary = Array.isArray(result) ? result[0]?.summary_text : result?.summary_text

        self.postMessage({
            type: 'result' as const,
            summary: summary?.trim() ?? '',
            id,
        })
    } catch (err: unknown) {
        self.postMessage({
            type: 'error' as const,
            error: (err as { message?: string } | null | undefined)?.message ?? String(err),
            id,
        })
    }
}