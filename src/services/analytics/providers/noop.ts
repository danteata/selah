import type { AnalyticsEvent, AnalyticsProvider, AnalyticsProviderConfig, AnalyticsUserProperties } from '../types'

/**
 * No-op analytics provider — silently discards all events.
 * Used when analytics is disabled via configuration.
 */
export class NoOpAnalyticsProvider implements AnalyticsProvider {
    init(_config: AnalyticsProviderConfig): void { /* no-op */ }
    track(_event: AnalyticsEvent): void { /* no-op */ }
    identify(_userId: string, _properties?: AnalyticsUserProperties): void { /* no-op */ }
    setUserProperties(_properties: AnalyticsUserProperties): void { /* no-op */ }
    reset(): void { /* no-op */ }
    page(_name: string, _properties?: Record<string, unknown>): void { /* no-op */ }
    setEnabled(_enabled: boolean): void { /* no-op */ }
}