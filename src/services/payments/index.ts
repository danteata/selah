/**
 * Payment Service Adapter
 * 
 * Provides a unified interface for payment processing that can be swapped
 * between different providers (Paystack, Stripe, Flutterwave) via configuration.
 * 
 * Usage:
 *   import { payments } from '@/services/payments'
 *   const result = await payments.initializeTransaction({ email, amount, plan })
 */

// Core payment interface
export interface PaymentAdapter {
    /** Initialize the payment provider */
    init(config: PaymentConfig): Promise<void>

    /** Initialize a new payment transaction */
    initializeTransaction(options: TransactionOptions): Promise<TransactionResult>

    /** Verify a payment by reference */
    verifyTransaction(reference: string): Promise<VerificationResult>

    /** Create a subscription */
    createSubscription(options: SubscriptionOptions): Promise<SubscriptionResult>

    /** Cancel a subscription */
    cancelSubscription(subscriptionCode: string): Promise<void>

    /** Get subscription status */
    getSubscription(subscriptionCode: string): Promise<SubscriptionDetails | null>

    /** List available plans */
    listPlans(): Promise<Plan[]>
}

export interface PaymentConfig {
    publicKey: string
    secretKey?: string
    baseUrl?: string
    currency?: string
    debug?: boolean
}

export interface TransactionOptions {
    email: string
    amount: number // In smallest currency unit (kobo, cents)
    currency?: string
    reference?: string
    callbackUrl?: string
    metadata?: Record<string, unknown>
    plan?: string // Plan code for subscriptions
}

export interface TransactionResult {
    success: boolean
    reference: string
    authorizationUrl?: string
    accessCode?: string
    error?: string
}

export interface VerificationResult {
    success: boolean
    reference: string
    status: 'success' | 'failed' | 'pending' | 'abandoned'
    amount: number
    currency: string
    paidAt?: string
    channel?: string
    customerEmail?: string
    metadata?: Record<string, unknown>
}

export interface SubscriptionOptions {
    email: string
    planCode: string
    startDate?: string
    authorizationCode?: string
}

export interface SubscriptionResult {
    success: boolean
    subscriptionCode: string
    emailToken?: string
    status: 'active' | 'non-renewing' | 'attention' | 'cancelled'
    error?: string
}

export interface SubscriptionDetails {
    subscriptionCode: string
    status: 'active' | 'non-renewing' | 'attention' | 'cancelled'
    plan: Plan
    nextPaymentDate: string
    createdAt: string
}

export interface Plan {
    id: string
    code: string
    name: string
    description?: string
    amount: number
    currency: string
    interval: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually'
    features?: string[]
}

// ============================================================================
// Paystack Implementation
//
// DEPRECATED for client use. This adapter talks to the Paystack REST API with
// the secret key and is only safe to run server-side. In Selah the privileged
// operations live in Convex (convex/paystack.ts + convex/http.ts); the client
// uses the `api.paystack.*` Convex functions via LicenseProvider instead. The
// adapter is kept for reference / potential Node-side reuse.
// ============================================================================
class PaystackAdapter implements PaymentAdapter {
    private config: PaymentConfig | null = null
    private baseUrl = 'https://api.paystack.co'

    async init(config: PaymentConfig): Promise<void> {
        this.config = config
        if (config.baseUrl) {
            this.baseUrl = config.baseUrl
        }
    }

    private async request<T>(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        body?: Record<string, unknown>
    ): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
                'Authorization': `Bearer ${this.config?.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        })

        const data = await response.json()

        if (!response.ok) {
            throw new Error(data.message || 'Paystack API error')
        }

        return data
    }

    async initializeTransaction(options: TransactionOptions): Promise<TransactionResult> {
        try {
            const response = await this.request<{
                status: boolean
                data: {
                    authorization_url: string
                    access_code: string
                    reference: string
                }
            }>('/transaction/initialize', 'POST', {
                email: options.email,
                amount: options.amount,
                currency: options.currency || this.config?.currency || 'NGN',
                reference: options.reference,
                callback_url: options.callbackUrl,
                metadata: options.metadata,
                plan: options.plan,
            })

            return {
                success: response.status,
                reference: response.data.reference,
                authorizationUrl: response.data.authorization_url,
                accessCode: response.data.access_code,
            }
        } catch (error) {
            return {
                success: false,
                reference: options.reference || '',
                error: error instanceof Error ? error.message : 'Transaction failed',
            }
        }
    }

    async verifyTransaction(reference: string): Promise<VerificationResult> {
        try {
            const response = await this.request<{
                status: boolean
                data: {
                    status: string
                    reference: string
                    amount: number
                    currency: string
                    paid_at: string
                    channel: string
                    customer: { email: string }
                    metadata: Record<string, unknown>
                }
            }>(`/transaction/verify/${reference}`)

            return {
                success: response.status,
                reference: response.data.reference,
                status: response.data.status as VerificationResult['status'],
                amount: response.data.amount,
                currency: response.data.currency,
                paidAt: response.data.paid_at,
                channel: response.data.channel,
                customerEmail: response.data.customer?.email,
                metadata: response.data.metadata,
            }
        } catch (error) {
            return {
                success: false,
                reference,
                status: 'failed',
                amount: 0,
                currency: this.config?.currency || 'NGN',
            }
        }
    }

    async createSubscription(options: SubscriptionOptions): Promise<SubscriptionResult> {
        try {
            const response = await this.request<{
                status: boolean
                data: {
                    subscription_code: string
                    email_token: string
                    status: string
                }
            }>('/subscription', 'POST', {
                customer: options.email,
                plan: options.planCode,
                start_date: options.startDate,
                authorization: options.authorizationCode,
            })

            return {
                success: response.status,
                subscriptionCode: response.data.subscription_code,
                emailToken: response.data.email_token,
                status: response.data.status as SubscriptionResult['status'],
            }
        } catch (error) {
            return {
                success: false,
                subscriptionCode: '',
                status: 'cancelled',
                error: error instanceof Error ? error.message : 'Subscription failed',
            }
        }
    }

    async cancelSubscription(subscriptionCode: string): Promise<void> {
        await this.request(`/subscription/disable`, 'POST', {
            code: subscriptionCode,
            token: '', // Email token required - should be stored from createSubscription
        })
    }

    async getSubscription(subscriptionCode: string): Promise<SubscriptionDetails | null> {
        try {
            const response = await this.request<{
                status: boolean
                data: {
                    subscription_code: string
                    status: string
                    plan: {
                        id: number
                        plan_code: string
                        name: string
                        description: string
                        amount: number
                        currency: string
                        interval: string
                    }
                    next_payment_date: string
                    createdAt: string
                }
            }>(`/subscription/${subscriptionCode}`)

            return {
                subscriptionCode: response.data.subscription_code,
                status: response.data.status as SubscriptionDetails['status'],
                plan: {
                    id: String(response.data.plan.id),
                    code: response.data.plan.plan_code,
                    name: response.data.plan.name,
                    description: response.data.plan.description,
                    amount: response.data.plan.amount,
                    currency: response.data.plan.currency,
                    interval: response.data.plan.interval as Plan['interval'],
                },
                nextPaymentDate: response.data.next_payment_date,
                createdAt: response.data.createdAt,
            }
        } catch {
            return null
        }
    }

    async listPlans(): Promise<Plan[]> {
        try {
            const response = await this.request<{
                status: boolean
                data: Array<{
                    id: number
                    plan_code: string
                    name: string
                    description: string
                    amount: number
                    currency: string
                    interval: string
                }>
            }>('/plan')

            return response.data.map((plan) => ({
                id: String(plan.id),
                code: plan.plan_code,
                name: plan.name,
                description: plan.description,
                amount: plan.amount,
                currency: plan.currency,
                interval: plan.interval as Plan['interval'],
            }))
        } catch {
            return []
        }
    }
}

// ============================================================================
// Noop Implementation (for development/testing)
// ============================================================================
class NoopPaymentAdapter implements PaymentAdapter {
    private debug = false
    private mockPlans: Plan[] = [
        {
            id: 'plan_1',
            code: 'PLN_free',
            name: 'Free',
            description: 'Basic features',
            amount: 0,
            currency: 'NGN',
            interval: 'monthly',
            features: ['Up to 50 slides', 'Basic templates'],
        },
        {
            id: 'plan_2',
            code: 'PLN_pro',
            name: 'Pro',
            description: 'All features',
            amount: 500000, // 5000 NGN in kobo
            currency: 'NGN',
            interval: 'monthly',
            features: ['Unlimited slides', 'All templates', 'Cloud sync', 'Priority support'],
        },
    ]

    async init(config: PaymentConfig): Promise<void> {
        this.debug = config.debug ?? false
        if (this.debug) {
            console.log('[Payment:Noop] Initialized')
        }
    }

    async initializeTransaction(options: TransactionOptions): Promise<TransactionResult> {
        const reference = options.reference || `ref_${Date.now()}`
        if (this.debug) {
            console.log('[Payment:Noop] Initialize transaction:', options)
        }
        return {
            success: true,
            reference,
            authorizationUrl: `https://example.com/pay/${reference}`,
            accessCode: `access_${reference}`,
        }
    }

    async verifyTransaction(reference: string): Promise<VerificationResult> {
        if (this.debug) {
            console.log('[Payment:Noop] Verify transaction:', reference)
        }
        return {
            success: true,
            reference,
            status: 'success',
            amount: 500000,
            currency: 'NGN',
            paidAt: new Date().toISOString(),
            channel: 'card',
        }
    }

    async createSubscription(options: SubscriptionOptions): Promise<SubscriptionResult> {
        if (this.debug) {
            console.log('[Payment:Noop] Create subscription:', options)
        }
        return {
            success: true,
            subscriptionCode: `sub_${Date.now()}`,
            status: 'active',
        }
    }

    async cancelSubscription(subscriptionCode: string): Promise<void> {
        if (this.debug) {
            console.log('[Payment:Noop] Cancel subscription:', subscriptionCode)
        }
    }

    async getSubscription(subscriptionCode: string): Promise<SubscriptionDetails | null> {
        if (this.debug) {
            console.log('[Payment:Noop] Get subscription:', subscriptionCode)
        }
        return {
            subscriptionCode,
            status: 'active',
            plan: this.mockPlans[1],
            nextPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
        }
    }

    async listPlans(): Promise<Plan[]> {
        return this.mockPlans
    }
}

// ============================================================================
// Factory & Singleton
// ============================================================================
export type PaymentProvider = 'paystack' | 'noop'

export function createPaymentAdapter(provider: PaymentProvider): PaymentAdapter {
    switch (provider) {
        case 'paystack':
            return new PaystackAdapter()
        case 'noop':
        default:
            return new NoopPaymentAdapter()
    }
}

let paymentInstance: PaymentAdapter | null = null

export function getPayments(): PaymentAdapter {
    if (!paymentInstance) {
        const provider = (import.meta.env.VITE_PAYMENT_PROVIDER || 'noop') as PaymentProvider
        paymentInstance = createPaymentAdapter(provider)
    }
    return paymentInstance
}

export async function initPayments(): Promise<void> {
    const payments = getPayments()

    // SECURITY: the Paystack *secret* key must never reach the client — it would
    // ship inside the desktop bundle / web JS. All privileged Paystack calls
    // (transaction init, subscription management, webhooks) now run server-side
    // in convex/paystack.ts and convex/http.ts. The client only ever holds the
    // publishable key. Entitlements come from LicenseProvider, not from here.
    await payments.init({
        publicKey: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '',
        currency: import.meta.env.VITE_PAYMENT_CURRENCY || 'GHS',
        debug: import.meta.env.DEV,
    })
}

// Export singleton for easy access
export const payments = {
    get instance() {
        return getPayments()
    },
    initializeTransaction: (options: TransactionOptions) =>
        getPayments().initializeTransaction(options),
    verifyTransaction: (reference: string) =>
        getPayments().verifyTransaction(reference),
    createSubscription: (options: SubscriptionOptions) =>
        getPayments().createSubscription(options),
    cancelSubscription: (subscriptionCode: string) =>
        getPayments().cancelSubscription(subscriptionCode),
    getSubscription: (subscriptionCode: string) =>
        getPayments().getSubscription(subscriptionCode),
    listPlans: () => getPayments().listPlans(),
}
