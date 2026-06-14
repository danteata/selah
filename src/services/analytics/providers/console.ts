import type { AnalyticsEvent, AnalyticsProvider, AnalyticsProviderConfig, AnalyticsUserProperties } from '../types'

/**
 * Console analytics provider — logs everything to the browser console.
 * Useful during development and as a fallback when no real provider is configured.
 */
export class ConsoleAnalyticsProvider implements AnalyticsProvider {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    init(_config: AnalyticsProviderConfig): void {
        console.log('%c[Analytics] Console provider initialized', 'color: #888; font-style: italic')
    }

    track(event: AnalyticsEvent): void {
        console.log(`%c📊 ${event.name}`, 'color: #0ea5e9; font-weight: bold', event.properties ?? '')
    }

    identify(userId: string, properties?: AnalyticsUserProperties): void {
        console.log('%c[Analytics] identify', 'color: #0ea5e9', userId, properties ?? '')
    }

    setUserProperties(properties: AnalyticsUserProperties): void {
        console.log('%c[Analytics] setUserProperties', 'color: #0ea5e9', properties)
    }

    reset(): void {
        console.log('%c[Analytics] reset', 'color: #0ea5e9')
    }

    page(name: string, properties?: Record<string, unknown>): void {
        console.log(`%c📄 page: ${name}`, 'color: #0ea5e9', properties ?? '')
    }

    setEnabled(enabled: boolean): void {
        console.log(`%c[Analytics] setEnabled: ${enabled}`, 'color: #0ea5e9')
    }
}