import type { AnalyticsEvent, AnalyticsProvider, AnalyticsProviderConfig, AnalyticsUserProperties } from '../types'

/**
 * Amplitude analytics provider.
 *
 * Uses the `@amplitude/unified` SDK, which bundles analytics + session replay
 * behind a single `initAll()` call. The SDK is loaded lazily so the app
 * still boots if the dependency is unavailable.
 *
 * Note: `autocapture` is intentionally NOT enabled (matches the PostHog
 * provider) — we track events manually to control PII and volume.
 * Session Replay is enabled at the requested `sampleRate` (default 1.0).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let amplitude: any = null

async function ensureAmplitude() {
    if (amplitude) return amplitude
    try {
        const mod = await import('@amplitude/unified')
        amplitude = mod
        return amplitude
    } catch {
        console.warn('[Analytics] @amplitude/unified not available')
        return null
    }
}

export class AmplitudeAnalyticsProvider implements AnalyticsProvider {
    private initialized = false

    async init(config: AnalyticsProviderConfig): Promise<void> {
        if (this.initialized) return
        const amp = await ensureAmplitude()
        if (!amp) return

        const options = (config.options as Record<string, unknown>) || {}
        const sessionReplaySampleRate =
            typeof options.sessionReplaySampleRate === 'number'
                ? (options.sessionReplaySampleRate as number)
                : 1

        try {
            await amp.initAll(config.apiKey, {
                analytics: {
                    autocapture: false, // Manual tracking — control PII and volume
                    ...(options.analytics as Record<string, unknown> | undefined),
                },
                sessionReplay: {
                    sampleRate: sessionReplaySampleRate,
                    ...((options.sessionReplay as Record<string, unknown>) || {}),
                },
            })

            // Super-properties / app context attached to every event
            const superProps: Record<string, unknown> = {}
            if (config.appVersion) superProps.app_version = config.appVersion
            if (config.isDesktop !== undefined) superProps.is_desktop = config.isDesktop
            if (Object.keys(superProps).length > 0) {
                const identifyObj = new amp.Identify()
                for (const [k, v] of Object.entries(superProps)) {
                    identifyObj.set(k, v as never)
                }
                amp.identify(identifyObj)
            }

            this.initialized = true
        } catch (error) {
            console.error('[Analytics] Amplitude init failed:', error)
        }
    }

    track(event: AnalyticsEvent): void {
        if (!this.initialized || !amplitude) return
        try {
            amplitude.track(event.name, event.properties)
        } catch (error) {
            console.error('[Analytics] Amplitude track error:', error)
        }
    }

    identify(userId: string, properties?: AnalyticsUserProperties): void {
        if (!this.initialized || !amplitude) return
        try {
            const identifyObj = new amplitude.Identify()
            if (properties) {
                Object.entries(properties).forEach(([key, value]) => {
                    identifyObj.set(key, value)
                })
            }
            amplitude.setUserId(userId)
            amplitude.identify(identifyObj)
        } catch (error) {
            console.error('[Analytics] Amplitude identify error:', error)
        }
    }

    setUserProperties(properties: AnalyticsUserProperties): void {
        if (!this.initialized || !amplitude) return
        try {
            const identifyObj = new amplitude.Identify()
            Object.entries(properties).forEach(([key, value]) => {
                identifyObj.set(key, value)
            })
            amplitude.identify(identifyObj)
        } catch (error) {
            console.error('[Analytics] Amplitude setUserProperties error:', error)
        }
    }

    reset(): void {
        if (!this.initialized || !amplitude) return
        try {
            amplitude.reset()
        } catch (error) {
            console.error('[Analytics] Amplitude reset error:', error)
        }
    }

    page(name: string, properties?: Record<string, unknown>): void {
        if (!this.initialized || !amplitude) return
        try {
            amplitude.track('$pageview', { page_name: name, ...properties })
        } catch (error) {
            console.error('[Analytics] Amplitude page error:', error)
        }
    }

    async flush(): Promise<void> {
        if (!this.initialized || !amplitude) return
        try {
            await amplitude.flush?.()
        } catch (error) {
            console.error('[Analytics] Amplitude flush error:', error)
        }
    }

    setEnabled(enabled: boolean): void {
        if (!this.initialized || !amplitude) return
        try {
            amplitude.setOptOut(!enabled)
        } catch (error) {
            console.error('[Analytics] Amplitude setEnabled error:', error)
        }
    }

    optOut(): void {
        if (!this.initialized || !amplitude) return
        amplitude.setOptOut(true)
    }

    optIn(): void {
        if (!this.initialized || !amplitude) return
        amplitude.setOptOut(false)
    }
}
