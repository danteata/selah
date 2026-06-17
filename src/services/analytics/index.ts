/**
 * Analytics service entry point.
 *
 * Canonical exports (new API):
 *   - `analytics`             — singleton instance
 *   - `AnalyticsService`      — class
 *   - `AnalyticsEventType`    — typed event names
 *   - `AnalyticsProvider`     — provider interface
 *   - `AnalyticsProviderConfig` — provider config shape
 *
 * Compatibility shims (old API, used by `src/services/index.ts`):
 *   - `initAnalytics()`        — read env vars, call `analytics.initialize(...)`
 *   - `getAnalytics()`         — return the singleton
 *   - `createAnalyticsAdapter()` — factory that returns a fresh `AnalyticsProvider`
 *   - `AnalyticsAdapter`       — alias for `AnalyticsProvider`
 *   - `AnalyticsConfig`        — alias for `AnalyticsProviderConfig`
 */

import { AnalyticsService, analytics } from './service'
import type {
    AnalyticsEvent,
    AnalyticsProvider,
    AnalyticsProviderConfig,
    AnalyticsProviderType,
    AnalyticsUserProperties,
} from './types'
import { PostHogAnalyticsProvider } from './providers/posthog'
import { AmplitudeAnalyticsProvider } from './providers/amplitude'
import { ConsoleAnalyticsProvider } from './providers/console'
import { NoOpAnalyticsProvider } from './providers/noop'

export { AnalyticsService, analytics } from './service'
export type {
    AnalyticsEvent,
    AnalyticsProvider,
    AnalyticsProviderConfig,
    AnalyticsProviderType,
    AnalyticsUserProperties,
} from './types'
export { AnalyticsEventType, AnalyticsProviderType as ProviderType } from './types'

// ---------------------------------------------------------------------------
// Compatibility shims (old API)
// ---------------------------------------------------------------------------

/** @deprecated Use {@link AnalyticsProvider}. */
export type AnalyticsAdapter = AnalyticsProvider
/** @deprecated Use {@link AnalyticsProviderConfig}. */
export type AnalyticsConfig = AnalyticsProviderConfig

/**
 * Build a fresh provider instance for the given type. Mirrors the old
 * `createAnalyticsAdapter` factory. The factory used to live in
 * `src/services/analytics/index.ts` and was lost when the module was
 * slimmed down; this is the equivalent.
 */
export function createAnalyticsAdapter(type: AnalyticsProviderType): AnalyticsProvider {
    switch (type) {
        case 'posthog':
            return new PostHogAnalyticsProvider()
        case 'amplitude':
            return new AmplitudeAnalyticsProvider()
        case 'console':
            return new ConsoleAnalyticsProvider()
        case 'none':
        default:
            return new NoOpAnalyticsProvider()
    }
}

/**
 * @deprecated Call `analytics.initialize(type, config)` instead. This shim
 * reads the legacy `VITE_ANALYTICS_*` env vars for backward compatibility
 * with `initServices()`.
 */
export async function initAnalytics(
    overrides: Partial<AnalyticsProviderConfig> = {},
): Promise<void> {
    const providerType = (import.meta.env.VITE_ANALYTICS_PROVIDER ||
        'console') as AnalyticsProviderType
    const apiKey =
        providerType === 'amplitude'
            ? import.meta.env.VITE_AMPLITUDE_KEY
            : providerType === 'posthog'
                ? import.meta.env.VITE_POSTHOG_KEY
                : ''
    await analytics.initialize(providerType, {
        apiKey: apiKey ?? '',
        enabled: import.meta.env.VITE_ANALYTICS_ENABLED !== 'false',
        environment: import.meta.env.DEV ? 'development' : 'production',
        appVersion: overrides.appVersion,
        isDesktop: overrides.isDesktop,
        options: overrides.options,
    })
}

/** @deprecated Use the `analytics` singleton directly. */
export function getAnalytics(): AnalyticsService {
    return AnalyticsService.getInstance()
}
