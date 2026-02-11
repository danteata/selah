/**
 * Analytics Service Adapter
 * 
 * Provides a unified interface for analytics tracking that can be swapped
 * between different providers (Posthog, Amplitude, etc.) via configuration.
 * 
 * Usage:
 *   import { analytics } from '@/services/analytics'
 *   analytics.track('slide_created', { type: 'bible' })
 */

// Core analytics interface - implement this for each provider
export interface AnalyticsAdapter {
    /** Initialize the analytics provider */
    init(config: AnalyticsConfig): Promise<void>

    /** Track a custom event */
    track(event: string, properties?: Record<string, unknown>): void

    /** Identify a user */
    identify(userId: string, traits?: Record<string, unknown>): void

    /** Track a page view */
    page(name: string, properties?: Record<string, unknown>): void

    /** Reset/logout the current user */
    reset(): void

    /** Get the current distinct/user ID */
    getDistinctId(): string | null
}

export interface AnalyticsConfig {
    apiKey: string
    apiHost?: string
    debug?: boolean
    autocapture?: boolean
}

// ============================================================================
// Posthog Implementation
// ============================================================================
class PosthogAdapter implements AnalyticsAdapter {
    private posthog: typeof import('posthog-js').default | null = null

    async init(config: AnalyticsConfig): Promise<void> {
        try {
            const posthogModule = await import('posthog-js')
            this.posthog = posthogModule.default

            this.posthog.init(config.apiKey, {
                api_host: config.apiHost || 'https://app.posthog.com',
                autocapture: config.autocapture ?? true,
                capture_pageview: false, // We'll handle this manually
                debug: config.debug,
            })
        } catch (error) {
            console.warn('Posthog not available:', error)
        }
    }

    track(event: string, properties?: Record<string, unknown>): void {
        this.posthog?.capture(event, properties)
    }

    identify(userId: string, traits?: Record<string, unknown>): void {
        this.posthog?.identify(userId, traits)
    }

    page(name: string, properties?: Record<string, unknown>): void {
        this.posthog?.capture('$pageview', { page_name: name, ...properties })
    }

    reset(): void {
        this.posthog?.reset()
    }

    getDistinctId(): string | null {
        return this.posthog?.get_distinct_id() || null
    }
}

// ============================================================================
// Amplitude Implementation
// ============================================================================
class AmplitudeAdapter implements AnalyticsAdapter {
    private amplitude: typeof import('@amplitude/analytics-browser') | null = null

    async init(config: AnalyticsConfig): Promise<void> {
        try {
            this.amplitude = await import('@amplitude/analytics-browser')

            this.amplitude.init(config.apiKey, undefined, {
                serverUrl: config.apiHost,
                logLevel: config.debug ? 1 : 0, // 1 = verbose
                autocapture: config.autocapture ? {
                    elementInteractions: true,
                    pageViews: false
                } : false,
            })
        } catch (error) {
            console.warn('Amplitude not available:', error)
        }
    }

    track(event: string, properties?: Record<string, unknown>): void {
        this.amplitude?.track(event, properties)
    }

    identify(userId: string, traits?: Record<string, unknown>): void {
        this.amplitude?.setUserId(userId)
        if (traits) {
            const identifyEvent = new this.amplitude!.Identify()
            Object.entries(traits).forEach(([key, value]) => {
                identifyEvent.set(key, value as string | number | boolean)
            })
            this.amplitude?.identify(identifyEvent)
        }
    }

    page(name: string, properties?: Record<string, unknown>): void {
        this.amplitude?.track('Page View', { page_name: name, ...properties })
    }

    reset(): void {
        this.amplitude?.reset()
    }

    getDistinctId(): string | null {
        return this.amplitude?.getUserId() || null
    }
}

// ============================================================================
// Noop Implementation (for development/testing)
// ============================================================================
class NoopAdapter implements AnalyticsAdapter {
    private debug = false

    async init(config: AnalyticsConfig): Promise<void> {
        this.debug = config.debug ?? false
        if (this.debug) {
            console.log('[Analytics:Noop] Initialized')
        }
    }

    track(event: string, properties?: Record<string, unknown>): void {
        if (this.debug) {
            console.log('[Analytics:Noop] Track:', event, properties)
        }
    }

    identify(userId: string, traits?: Record<string, unknown>): void {
        if (this.debug) {
            console.log('[Analytics:Noop] Identify:', userId, traits)
        }
    }

    page(name: string, properties?: Record<string, unknown>): void {
        if (this.debug) {
            console.log('[Analytics:Noop] Page:', name, properties)
        }
    }

    reset(): void {
        if (this.debug) {
            console.log('[Analytics:Noop] Reset')
        }
    }

    getDistinctId(): string | null {
        return null
    }
}

// ============================================================================
// Factory & Singleton
// ============================================================================
export type AnalyticsProvider = 'posthog' | 'amplitude' | 'noop'

export function createAnalyticsAdapter(provider: AnalyticsProvider): AnalyticsAdapter {
    switch (provider) {
        case 'posthog':
            return new PosthogAdapter()
        case 'amplitude':
            return new AmplitudeAdapter()
        case 'noop':
        default:
            return new NoopAdapter()
    }
}

// Singleton instance - configured via environment
let analyticsInstance: AnalyticsAdapter | null = null

export function getAnalytics(): AnalyticsAdapter {
    if (!analyticsInstance) {
        const provider = (import.meta.env.VITE_ANALYTICS_PROVIDER || 'noop') as AnalyticsProvider
        analyticsInstance = createAnalyticsAdapter(provider)
    }
    return analyticsInstance
}

export async function initAnalytics(): Promise<void> {
    const analytics = getAnalytics()
    const apiKey = import.meta.env.VITE_ANALYTICS_API_KEY || ''
    const apiHost = import.meta.env.VITE_ANALYTICS_API_HOST

    await analytics.init({
        apiKey,
        apiHost,
        debug: import.meta.env.DEV,
        autocapture: true,
    })
}

// Export singleton for easy access
export const analytics = {
    get instance() {
        return getAnalytics()
    },
    track: (event: string, properties?: Record<string, unknown>) =>
        getAnalytics().track(event, properties),
    identify: (userId: string, traits?: Record<string, unknown>) =>
        getAnalytics().identify(userId, traits),
    page: (name: string, properties?: Record<string, unknown>) =>
        getAnalytics().page(name, properties),
    reset: () => getAnalytics().reset(),
}
