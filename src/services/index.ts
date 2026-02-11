/**
 * Services Module
 * 
 * Centralized exports for all service adapters.
 * Configure providers via environment variables:
 * 
 *   VITE_ANALYTICS_PROVIDER = 'posthog' | 'amplitude' | 'noop'
 *   VITE_FF_PROVIDER = 'posthog' | 'config' | 'noop'
 *   VITE_PAYMENT_PROVIDER = 'paystack' | 'noop'
 */

// Analytics
export {
    analytics,
    initAnalytics,
    getAnalytics,
    createAnalyticsAdapter,
    type AnalyticsAdapter,
    type AnalyticsConfig,
    type AnalyticsProvider,
} from './analytics'

// Feature Flags
export {
    featureFlags,
    initFeatureFlags,
    getFeatureFlags,
    createFeatureFlagsAdapter,
    type FeatureFlagAdapter,
    type FeatureFlagConfig,
    type FeatureFlagProvider,
} from './feature-flags'

// Payments
export {
    payments,
    initPayments,
    getPayments,
    createPaymentAdapter,
    type PaymentAdapter,
    type PaymentConfig,
    type PaymentProvider,
    type TransactionOptions,
    type TransactionResult,
    type VerificationResult,
    type SubscriptionOptions,
    type SubscriptionResult,
    type SubscriptionDetails,
    type Plan,
} from './payments'

/**
 * Initialize all services
 * Call this once at app startup
 */
export async function initServices(): Promise<void> {
    const { initAnalytics } = await import('./analytics')
    const { initFeatureFlags } = await import('./feature-flags')
    const { initPayments } = await import('./payments')

    await Promise.all([
        initAnalytics(),
        initFeatureFlags(),
        initPayments(),
    ])
}
