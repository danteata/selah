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
        models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
        hint: 'Get a key at platform.openai.com. gpt-5.4-mini is cheap and fast.',
    },
    {
        id: 'anthropic',
        label: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        requiresKey: true,
        models: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        hint: "Claude via Anthropic's OpenAI-compatible endpoint. Key at console.anthropic.com.",
    },
    {
        id: 'gemini',
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        requiresKey: true,
        models: [
            'gemini-3.5-flash',
            'gemini-3.1-pro',
            'gemini-3.1-flash',
            'gemini-3.1-flash-lite',
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
        ],
        hint: 'Get a key at aistudio.google.com. gemini-2.5-flash is fast and capable.',
    },
    {
        id: 'zai',
        label: 'Z.AI (GLM)',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        requiresKey: true,
        models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5', 'glm-4.7', 'glm-4.6'],
        hint: 'Zhipu GLM models via Z.AI. Key at z.ai.',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter (many models, one key)',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresKey: true,
        models: [
            'anthropic/claude-sonnet-4.6',
            'openai/gpt-5.4-mini',
            'google/gemini-2.5-flash',
            'meta-llama/llama-4-maverick',
        ],
        hint: 'Aggregator — access many providers with a single key. openrouter.ai/keys',
    },
    {
        id: 'groq',
        label: 'Groq (very fast)',
        baseUrl: 'https://api.groq.com/openai/v1',
        requiresKey: true,
        models: ['llama-4-maverick-17b-128e-instruct', 'llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
        hint: 'Extremely fast inference. console.groq.com/keys',
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        requiresKey: true,
        models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    },
    {
        id: 'mistral',
        label: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        requiresKey: true,
        models: ['mistral-large-3-25-12', 'mistral-medium-3-5-26-04', 'mistral-small-2503', 'mistral-small-2501', 'codestral-25-08'],
    },
    {
        id: 'together',
        label: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        requiresKey: true,
        models: [
            'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
            'Qwen/Qwen3.7-Plus',
            'Qwen/Qwen3.6-Plus',
            'Qwen/Qwen3.5-397B-A17B',
            'deepseek-ai/DeepSeek-V4-Pro',
            'openai/gpt-oss-120b',
        ],
    },
    {
        id: 'xai',
        label: 'xAI (Grok)',
        baseUrl: 'https://api.x.ai/v1',
        requiresKey: true,
        models: ['grok-4.20', 'grok-4.20-reasoning', 'grok-3-latest', 'grok-3-mini-latest'],
        hint: 'Get a key at console.x.ai.',
    },
    {
        id: 'ollama',
        label: 'Ollama (local)',
        baseUrl: 'http://localhost:11434/v1',
        requiresKey: false,
        models: ['llama4', 'llama3.3', 'qwen3.6', 'qwen3', 'gemma4', 'gemma3', 'mistral-small3.2', 'deepseek-v4-flash'],
        hint: 'Runs locally & offline. Start Ollama, then pull a model (e.g. `ollama pull llama4`).',
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
