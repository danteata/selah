/**
 * Abstractive Summarization Service
 *
 * Uses a Web Worker running Xenova/distilbart-cnn-6-6 to generate
 * paraphrased (abstractive) summaries directly in the browser.
 *
 * Falls back gracefully if the model fails to load or isn't available.
 * This is the client-side counterpart to the desktop sidecar's
 * /summarize-abstractive endpoint.
 */

type SummarizeCallback = (summary: string) => void
type ErrorCallback = (error: string) => void
type ProgressCallback = (progress: number) => void

let workerInstance: Worker | null = null
let nextId = 0
let loading = false
let ready = false
const pendingCallbacks = new Map<number, {
    resolve: (summary: string) => void
    reject: (error: Error) => void
}>()

function getWorker(): Worker {
    if (!workerInstance) {
        // NOTE: must be `new Worker(new URL('./…', import.meta.url), …)` inline
        // — Vite's worker plugin only detects that exact pattern. Extracting
        // the URL to a variable causes Vite to fall back to an inlined
        // data: URL with the wrong MIME type, which the browser then refuses
        // to load as a module script. See `localEmbeddings.ts` for the
        // canonical pattern.
        workerInstance = new Worker(
            new URL('./summarization-abstractive.worker.ts', import.meta.url),
            { type: 'module' }
        )
        workerInstance.onmessage = (event) => {
            const data = event.data
            const callbacks = pendingCallbacks.get(data.id)
            if (!callbacks) return

            if (data.type === 'result') {
                callbacks.resolve(data.summary ?? '')
                pendingCallbacks.delete(data.id)
            } else if (data.type === 'error') {
                callbacks.reject(new Error(data.error ?? 'Summarization failed'))
                pendingCallbacks.delete(data.id)
            }
            // 'progress' — caller can listen via onProgress if needed
        }
        workerInstance.onerror = (event) => {
            console.error('[AbstractiveSummarizer] Worker error:', event.message)
        }
    }
    return workerInstance
}

/**
 * Check if the summarizer model is loaded and ready.
 */
export function isAbstractiveSummarizerReady(): boolean {
    return ready
}

/**
 * Initialize the summarization model.
 * Downloads the model on first call (~330MB), caches in browser.
 */
export async function setupAbstractiveSummarizer(): Promise<boolean> {
    if (ready) return true
    if (loading) {
        // Wait for existing load
        while (loading) {
            await new Promise(r => setTimeout(r, 500))
        }
        return ready
    }

    loading = true
    try {
        const result = await summarizeAbstractiveInternal('test', 30, 10)
        ready = !!(result && result.length > 5)
        return ready
    } catch {
        console.warn('[AbstractiveSummarizer] Model not available — will use extractive fallback')
        ready = false
        return false
    } finally {
        loading = false
    }
}

/**
 * Generate an abstractive (paraphrased) summary.
 * Returns empty string if the model isn't available.
 */
export async function summarizeAbstractive(
    text: string,
    maxLength: number = 150,
    minLength: number = 30,
): Promise<string> {
    if (!text || text.trim().length < 50) {
        return ''
    }

    try {
        return await summarizeAbstractiveInternal(text, maxLength, minLength)
    } catch (err) {
        console.warn('[AbstractiveSummarizer] Summarization failed:', err)
        return ''
    }
}

function summarizeAbstractiveInternal(
    text: string,
    maxLength: number,
    minLength: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const id = nextId++
        pendingCallbacks.set(id, {
            resolve,
            reject: (err: Error) => reject(err),
        })

        try {
            const worker = getWorker()
            worker.postMessage({
                type: 'summarize',
                text,
                maxLength,
                minLength,
                id,
            })
        } catch (err) {
            pendingCallbacks.delete(id)
            reject(err)
        }
    })
}

/**
 * Clean up the worker.
 */
export function cleanupAbstractiveSummarizer(): void {
    if (workerInstance) {
        workerInstance.terminate()
        workerInstance = null
    }
    ready = false
    loading = false
    pendingCallbacks.clear()
}