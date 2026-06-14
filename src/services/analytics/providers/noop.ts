import type { AnalyticsEvent, AnalyticsProvider, AnalyticsProviderConfig, AnalyticsUserProperties } from '../types'

/**
 * No-op analytics provider — silently discards all events.
 * Used when analytics is disabled via configuration.
 */
export class NoOpAnalyticsProvider implements AnalyticsProvider {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    init(_config: AnalyticsProviderConfig): void { /* no-op */ }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    track(_event: AnalyticsEvent): void { /* no-op */ }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    identify(_userId: string, _properties?: AnalyticsUserProperties): void { /* no-op */ }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setUserProperties(_properties: AnalyticsUserProperties): void { /* no-op */ }
    reset(): void { /* no-op */ }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page(_name: string, _properties?: Record<string, unknown>): void { /* no-op */ }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setEnabled(_enabled: boolean): void { /* no-op */ }
}