/**
 * Catalog of common OpenAI-compatible LLM providers for the AI verse-extraction
 * / summarization settings. Picking a provider presets its base URL so ordinary
 * users only enter an API key and choose a model. "Custom" exposes the base URL
 * for any other OpenAI-compatible endpoint.
 *
 * All entries must expose an OpenAI-style `/chat/completions` endpoint (that's
 * what `llmClient` speaks). Anthropic's native API is not OpenAI-compatible, so
 * Claude models are offered via OpenRouter rather than a direct Anthropic entry.
 */

export interface LlmProvider {
    id: string
    label: string
    /** Base URL up to `/v1` (empty for the custom provider). */
    baseUrl: string
    /** Whether an API key is needed (local servers don't). */
    requiresKey: boolean
    /** Suggested model ids (the user can still type any model). */
    models: string[]
    /** True for the user-defined custom endpoint. */
    isCustom?: boolean
    /** Short hint shown under the picker. */
    hint?: string
}

export const LLM_PROVIDERS: readonly LlmProvider[] = [
    {
        id: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        requiresKey: true,
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
        hint: 'Get a key at platform.openai.com. gpt-4o-mini is cheap and fast.',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter (Claude, Gemini, Llama…)',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresKey: true,
        models: [
            'anthropic/claude-3.5-haiku',
            'anthropic/claude-3.5-sonnet',
            'openai/gpt-4o-mini',
            'google/gemini-flash-1.5',
            'meta-llama/llama-3.1-70b-instruct',
        ],
        hint: 'One key, many models — including Anthropic Claude. openrouter.ai/keys',
    },
    {
        id: 'groq',
        label: 'Groq (very fast)',
        baseUrl: 'https://api.groq.com/openai/v1',
        requiresKey: true,
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
        hint: 'Extremely fast inference. console.groq.com/keys',
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        requiresKey: true,
        models: ['deepseek-chat'],
    },
    {
        id: 'mistral',
        label: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        requiresKey: true,
        models: ['mistral-small-latest', 'mistral-large-latest'],
    },
    {
        id: 'together',
        label: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        requiresKey: true,
        models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    },
    {
        id: 'xai',
        label: 'xAI (Grok)',
        baseUrl: 'https://api.x.ai/v1',
        requiresKey: true,
        models: ['grok-2-latest'],
    },
    {
        id: 'ollama',
        label: 'Ollama (local)',
        baseUrl: 'http://localhost:11434/v1',
        requiresKey: false,
        models: ['llama3.1', 'qwen2.5', 'mistral'],
        hint: 'Runs locally & offline. Start Ollama, then pull a model (e.g. `ollama pull llama3.1`).',
    },
    {
        id: 'lmstudio',
        label: 'LM Studio (local)',
        baseUrl: 'http://localhost:1234/v1',
        requiresKey: false,
        models: [],
        hint: 'Runs locally & offline. Enable the local server in LM Studio, then enter the loaded model id.',
    },
    {
        id: 'custom',
        label: 'Custom (OpenAI-compatible)',
        baseUrl: '',
        requiresKey: false,
        isCustom: true,
        models: [],
        hint: 'Any OpenAI-compatible endpoint — enter its base URL (…/v1).',
    },
]

export const DEFAULT_LLM_PROVIDER_ID = 'openai'

export function getLlmProvider(id?: string | null): LlmProvider | undefined {
    return LLM_PROVIDERS.find((p) => p.id === id)
}
