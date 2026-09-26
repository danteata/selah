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
 * Compatibility shims (old API):
 *   - `getAnalytics()`         — return the singleton
 *   - `AnalyticsAdapter`       — alias for `AnalyticsProvider`
 *   - `AnalyticsConfig`        — alias for `AnalyticsProviderConfig`
 */

import { AnalyticsService } from './service'
import type { AnalyticsProvider, AnalyticsProviderConfig } from './types'

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


/** @deprecated Use the `analytics` singleton directly. */
export function getAnalytics(): AnalyticsService {
    return AnalyticsService.getInstance()
}
