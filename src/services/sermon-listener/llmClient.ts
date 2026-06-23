/**
 * Provider-agnostic, OpenAI-compatible chat client.
 *
 * Works with OpenAI, Groq, OpenRouter, or any self-hosted server that exposes a
 * `/chat/completions` endpoint (LM Studio, Ollama's OpenAI shim, vLLM, etc.).
 * The whole thing is OPTIONAL: if the user hasn't configured a base URL + key +
 * model, `isLlmConfigured()` is false and callers skip the LLM entirely, so the
 * app keeps working fully offline with its local detection.
 */

export interface LlmConfig {
    /** Base URL up to (but not including) `/chat/completions`, e.g. https://api.openai.com/v1 */
    baseUrl: string
    /** API key sent as `Authorization: Bearer`. May be a placeholder for local servers. */
    apiKey: string
    /** Model id, e.g. "gpt-4o-mini", "llama-3.1-8b-instruct". */
    model: string
    /** Whether the user has turned the LLM augmentation on. */
    enabled?: boolean
}

/**
 * True only when there's enough config to make a request AND the user enabled
 * it. Note: some local servers accept an empty key, so apiKey is allowed to be
 * a placeholder but base URL + model are required.
 */
export function isLlmConfigured(c?: Partial<LlmConfig> | null): c is LlmConfig {
    return !!(c && c.enabled && c.baseUrl && c.baseUrl.trim() && c.model && c.model.trim())
}

function endpointFor(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function hostOf(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return ''
    }
}

export interface LlmChatOptions {
    /** Sampling temperature. Defaults to 0 for deterministic extraction. */
    temperature?: number
    /** Abort signal so an in-flight request can be cancelled when listening stops. */
    signal?: AbortSignal
    /** Request timeout in ms (default 20s). */
    timeoutMs?: number
}

/**
 * Send a system+user prompt and parse the assistant's reply as JSON.
 *
 * Requests `response_format: json_object` (honored by OpenAI/compatible servers;
 * ignored harmlessly by others) and then defensively extracts the first JSON
 * object from the text in case a model wraps it in prose or a ```json fence.
 *
 * @throws on network error, non-2xx response, or unparseable output.
 */
export async function llmChatJson<T = unknown>(
    config: LlmConfig,
    systemPrompt: string,
    userContent: string,
    options: LlmChatOptions = {},
): Promise<T> {
    const { temperature = 0, signal, timeoutMs = 20000 } = options

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    // Forward an external abort to our controller.
    if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
    }
    // Anthropic's OpenAI-compatible endpoint blocks browser-origin requests
    // unless this header is present.
    if (/(^|\.)api\.anthropic\.com$/i.test(hostOf(config.baseUrl))) {
        headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }

    try {
        const response = await fetch(endpointFor(config.baseUrl), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: config.model,
                temperature,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                ],
            }),
            signal: controller.signal,
        })

        if (!response.ok) {
            const body = await response.text().catch(() => '')
            throw new Error(`LLM request failed: ${response.status} ${body.slice(0, 200)}`)
        }

        const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>
        }
        const content = data.choices?.[0]?.message?.content
        if (!content) throw new Error('LLM response had no content')

        return parseJsonLoose<T>(content)
    } finally {
        clearTimeout(timeout)
    }
}

/** Model-ish ids we never want to offer for chat extraction (embeddings, audio, etc.). */
const NON_CHAT_MODEL = /embed|whisper|tts|audio|dall|image|moderation|rerank|vision-only|search|distil|babbage|ada(-|$)|davinci-002/i

/**
 * Fetch the provider's available model ids via the OpenAI-compatible
 * `GET /models` endpoint, filtered to plausible chat models. Returns `[]` on any
 * failure (no key, unsupported endpoint, CORS, 401/403) so callers fall back to
 * the curated catalog list.
 */
export async function listModels(
    config: Pick<LlmConfig, 'baseUrl' | 'apiKey'>,
    signal?: AbortSignal,
): Promise<string[]> {
    if (!config.baseUrl) return []
    // No key → skip the request entirely. Most providers 401 on an empty Bearer
    // token, and the curated catalog already covers the common cases.
    if (!config.apiKey || !config.apiKey.trim()) return []
    const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
    }
    if (/(^|\.)api\.anthropic\.com$/i.test(hostOf(config.baseUrl))) {
        headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }
    try {
        const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
            headers,
            signal: signal ?? AbortSignal.timeout(8000),
        })
        if (!res.ok) return []
        const data = (await res.json()) as { data?: unknown[]; models?: unknown[] }
        const raw = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
        const ids = raw
            .map((m) => (typeof m === 'string' ? m : (m as { id?: string; name?: string }).id ?? (m as { name?: string }).name))
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
            // Gemini returns "models/gemini-..." — strip the prefix.
            .map((id) => id.replace(/^models\//, ''))
            .filter((id) => !NON_CHAT_MODEL.test(id))
        return Array.from(new Set(ids)).sort()
    } catch {
        return []
    }
}

/**
 * Parse JSON from a model reply, tolerating ```json fences and surrounding prose
 * by falling back to the first balanced `{...}` block.
 */
export function parseJsonLoose<T>(text: string): T {
    const trimmed = text.trim()
    try {
        return JSON.parse(trimmed) as T
    } catch {
        // Strip a code fence if present.
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
        if (fence) {
            try {
                return JSON.parse(fence[1].trim()) as T
            } catch {
                /* fall through */
            }
        }
        // Last resort: first { ... last }.
        const start = trimmed.indexOf('{')
        const end = trimmed.lastIndexOf('}')
        if (start !== -1 && end > start) {
            return JSON.parse(trimmed.slice(start, end + 1)) as T
        }
        throw new Error('Could not parse JSON from LLM response')
    }
}
