/**
 * Feature Flags Service Adapter
 * 
 * Provides a unified interface for feature flags that can be swapped
 * between different providers (Posthog, ConfigCat, custom config) via configuration.
 * 
 * Usage:
 *   import { featureFlags } from '@/services/feature-flags'
 *   if (await featureFlags.isEnabled('new_editor')) { ... }
 */

// Core feature flags interface
export interface FeatureFlagAdapter {
    /** Initialize the feature flag provider */
    init(config: FeatureFlagConfig): Promise<void>

    /** Check if a feature flag is enabled */
    isEnabled(flag: string, defaultValue?: boolean): boolean | Promise<boolean>

    /** Get the variant/value of a feature flag */
    getVariant<T = string>(flag: string, defaultValue?: T): T | Promise<T>

    /** Get all feature flags for the current user */
    getAllFlags(): Record<string, unknown> | Promise<Record<string, unknown>>

    /** Reload feature flags from server */
    reload(): Promise<void>
}

export interface FeatureFlagConfig {
    apiKey?: string
    apiHost?: string
    flags?: Record<string, boolean | string>
    debug?: boolean
}

// ============================================================================
// Config-based Implementation (Static flags from config/env)
// ============================================================================
class ConfigFeatureFlagsAdapter implements FeatureFlagAdapter {
    private flags: Record<string, boolean | string> = {}
    private debug = false

    async init(config: FeatureFlagConfig): Promise<void> {
        this.flags = config.flags || {}
        this.debug = config.debug ?? false

        // Also load from env variables (VITE_FF_<FLAG_NAME>=true/false)
        if (typeof import.meta.env !== 'undefined') {
            Object.keys(import.meta.env).forEach((key) => {
                if (key.startsWith('VITE_FF_')) {
                    const flagName = key.replace('VITE_FF_', '').toLowerCase()
                    const value = import.meta.env[key]
                    this.flags[flagName] = value === 'true' || value === true
                }
            })
        }

        if (this.debug) {
            console.log('[FeatureFlags:Config] Initialized with flags:', this.flags)
        }
    }

    isEnabled(flag: string, defaultValue = false): boolean {
        const value = this.flags[flag]
        if (value === undefined) return defaultValue
        return value === true || value === 'true'
    }

    getVariant<T = string>(flag: string, defaultValue?: T): T {
        const value = this.flags[flag]
        if (value === undefined) return defaultValue as T
        return value as unknown as T
    }

    getAllFlags(): Record<string, unknown> {
        return { ...this.flags }
    }

    async reload(): Promise<void> {
        // Config-based flags don't need reloading
    }
}

// ============================================================================
// Posthog Feature Flags Implementation
// ============================================================================
class PosthogFeatureFlagsAdapter implements FeatureFlagAdapter {
    private posthog: typeof import('posthog-js').default | null = null
    private debug = false

    async init(config: FeatureFlagConfig): Promise<void> {
        this.debug = config.debug ?? false

        try {
            const posthogModule = await import('posthog-js')
            this.posthog = posthogModule.default

            // Posthog should already be initialized by analytics
            // Just ensure flags are loaded
            if (this.posthog && !this.posthog.__loaded) {
                if (config.apiKey) {
                    this.posthog.init(config.apiKey, {
                        api_host: config.apiHost || 'https://app.posthog.com',
                    })
                }
            }

            // Wait for feature flags to load
            await new Promise<void>((resolve) => {
                this.posthog?.onFeatureFlags(() => resolve())
                setTimeout(resolve, 3000) // Timeout after 3s
            })
        } catch (error) {
            console.warn('Posthog feature flags not available:', error)
        }
    }

    isEnabled(flag: string, defaultValue = false): boolean {
        if (!this.posthog) return defaultValue
        return this.posthog.isFeatureEnabled(flag, { send_event: false }) ?? defaultValue
    }

    getVariant<T = string>(flag: string, defaultValue?: T): T {
        if (!this.posthog) return defaultValue as T
        return (this.posthog.getFeatureFlag(flag) ?? defaultValue) as T
    }

    getAllFlags(): Record<string, unknown> {
        const flags = this.posthog?.featureFlags?.getFlags()
        if (!flags || Array.isArray(flags)) {
            return {}
        }
        return flags as unknown as Record<string, unknown>
    }

    async reload(): Promise<void> {
        this.posthog?.reloadFeatureFlags()
    }
}

// ============================================================================
// Noop Implementation
// ============================================================================
class NoopFeatureFlagsAdapter implements FeatureFlagAdapter {
    private debug = false

    async init(config: FeatureFlagConfig): Promise<void> {
        this.debug = config.debug ?? false
    }

    isEnabled(_flag: string, defaultValue = false): boolean {
        return defaultValue
    }

    getVariant<T = string>(_flag: string, defaultValue?: T): T {
        return defaultValue as T
    }

    getAllFlags(): Record<string, unknown> {
        return {}
    }

    async reload(): Promise<void> { }
}

// ============================================================================
// Factory & Singleton
// ============================================================================
export type FeatureFlagProvider = 'posthog' | 'config' | 'noop'

export function createFeatureFlagsAdapter(provider: FeatureFlagProvider): FeatureFlagAdapter {
    switch (provider) {
        case 'posthog':
            return new PosthogFeatureFlagsAdapter()
        case 'config':
            return new ConfigFeatureFlagsAdapter()
        case 'noop':
        default:
            return new NoopFeatureFlagsAdapter()
    }
}

let featureFlagsInstance: FeatureFlagAdapter | null = null

export function getFeatureFlags(): FeatureFlagAdapter {
    if (!featureFlagsInstance) {
        const provider = (import.meta.env.VITE_FF_PROVIDER || 'config') as FeatureFlagProvider
        featureFlagsInstance = createFeatureFlagsAdapter(provider)
    }
    return featureFlagsInstance
}

export async function initFeatureFlags(flags?: Record<string, boolean | string>): Promise<void> {
    const ff = getFeatureFlags()

    await ff.init({
        apiKey: import.meta.env.VITE_FF_API_KEY,
        apiHost: import.meta.env.VITE_FF_API_HOST,
        flags,
        debug: import.meta.env.DEV,
    })
}

// Export singleton for easy access
export const featureFlags = {
    get instance() {
        return getFeatureFlags()
    },
    isEnabled: (flag: string, defaultValue?: boolean) =>
        getFeatureFlags().isEnabled(flag, defaultValue),
    getVariant: <T = string>(flag: string, defaultValue?: T) =>
        getFeatureFlags().getVariant<T>(flag, defaultValue),
    getAllFlags: () => getFeatureFlags().getAllFlags(),
    reload: () => getFeatureFlags().reload(),
}
