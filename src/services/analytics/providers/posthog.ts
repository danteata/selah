import posthog from 'posthog-js'
import type { AnalyticsEvent, AnalyticsProvider, AnalyticsProviderConfig, AnalyticsUserProperties } from '../types'

/**
 * PostHog analytics provider.
 * Wraps `posthog-js` (already a project dependency) behind the
 * provider-agnostic {@link AnalyticsProvider} interface.
 */
export class PostHogAnalyticsProvider implements AnalyticsProvider {
    private initialized = false

    init(config: AnalyticsProviderConfig): void {
        if (this.initialized) return

        try {
            posthog.init(config.apiKey, {
                api_host: (config.options?.apiHost as string) || 'https://us.i.posthog.com',
                // In development, use a distinct ID so we don't pollute prod data
                persistence: config.environment === 'development' ? 'memory' : 'localStorage+cookie',
                capture_pageview: false, // We handle page views manually
                capture_pageleave: true,
                autocapture: false, // Disable auto-capture — we track events manually to control PII and volume
                // Respect Do Not Track
                respect_dnt: true,
                ...((config.options as Record<string, unknown>) || {}),
            })

            // Set super-properties that attach to every event
            if (config.appVersion) {
                posthog.register({ app_version: config.appVersion })
            }
            if (config.isDesktop !== undefined) {
                posthog.register({ is_desktop: config.isDesktop })
            }

            this.initialized = true
        } catch (error) {
            console.error('[Analytics] PostHog init failed:', error)
        }
    }

    track(event: AnalyticsEvent): void {
        if (!this.initialized) return
        try {
            posthog.capture(event.name, event.properties as Record<string, unknown> | undefined)
        } catch (error) {
            console.error('[Analytics] PostHog track error:', error)
        }
    }

    identify(userId: string, properties?: AnalyticsUserProperties): void {
        if (!this.initialized) return
        try {
            posthog.identify(userId, properties as Record<string, unknown> | undefined)
        } catch (error) {
            console.error('[Analytics] PostHog identify error:', error)
        }
    }

    setUserProperties(properties: AnalyticsUserProperties): void {
        if (!this.initialized) return
        try {
            posthog.setPersonProperties(properties as Record<string, unknown>)
        } catch (error) {
            console.error('[Analytics] PostHog setUserProperties error:', error)
        }
    }

    reset(): void {
        if (!this.initialized) return
        try {
            posthog.reset()
        } catch (error) {
            console.error('[Analytics] PostHog reset error:', error)
        }
    }

    page(name: string, properties?: Record<string, unknown>): void {
        if (!this.initialized) return
        try {
            posthog.capture('$pageview', { $current_url: window.location.href, page_name: name, ...properties })
        } catch (error) {
            console.error('[Analytics] PostHog page error:', error)
        }
    }

    async flush(): Promise<void> {
        if (!this.initialized) return
        try {
            // posthog-js v1 doesn't expose a public flush — call the internal transport
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ph = posthog as any
            if (typeof ph._flush === 'function') ph._flush()
        } catch (error) {
            console.error('[Analytics] PostHog flush error:', error)
        }
    }

    setEnabled(enabled: boolean): void {
        if (!this.initialized) return
        try {
            if (enabled) {
                posthog.opt_in_capturing()
            } else {
                posthog.opt_out_capturing()
            }
        } catch (error) {
            console.error('[Analytics] PostHog setEnabled error:', error)
        }
    }

    optOut(): void {
        if (!this.initialized) return
        posthog.opt_out_capturing()
    }

    optIn(): void {
        if (!this.initialized) return
        posthog.opt_in_capturing()
    }
}