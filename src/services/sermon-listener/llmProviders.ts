/**
 * Catalog of common OpenAI-compatible LLM providers for the AI verse-extraction
 * / summarization settings. Picking a provider presets its base URL so ordinary
 * users only enter an API key and choose a model. "Custom" exposes the base URL
 * for any other OpenAI-compatible endpoint.
 *
 * All entries expose an OpenAI-style `/chat/completions` endpoint (that's what
 * `llmClient` speaks). Anthropic, Gemini and Z.AI are reached via their
 * official OpenAI-compatibility endpoints (Anthropic also needs the
 * browser-access header, added in llmClient).
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
        id: 'anthropic',
        label: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        requiresKey: true,
        models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest'],
        hint: 'Claude via Anthropic’s OpenAI-compatible endpoint. Key at console.anthropic.com.',
    },
    {
        id: 'gemini',
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        requiresKey: true,
        models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
        hint: 'Get a key at aistudio.google.com. gemini-2.0-flash is fast and cheap.',
    },
    {
        id: 'zai',
        label: 'Z.AI (GLM)',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        requiresKey: true,
        models: ['glm-4.6', 'glm-4.5-air', 'glm-4-flash'],
        hint: 'Zhipu GLM models via Z.AI. Key at z.ai.',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter (many models, one key)',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresKey: true,
        models: [
            'openai/gpt-4o-mini',
            'anthropic/claude-3.5-haiku',
            'google/gemini-flash-1.5',
            'meta-llama/llama-3.1-70b-instruct',
        ],
        hint: 'Aggregator — access many providers with a single key. openrouter.ai/keys',
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
