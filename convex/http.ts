/**
 * HTTP proxy for GitHub Releases.
 *
 * The Selah repo is private, so the browser can't read its releases (the
 * GitHub API returns 404 to anonymous requests) and can't download its release
 * assets (those URLs require auth too). These HTTP actions run server-side with
 * a GITHUB_TOKEN and expose two public, CORS-enabled endpoints:
 *
 *   GET /releases/latest      → the latest release JSON, with each asset's
 *                               download URL rewritten to point back here.
 *   GET /releases/asset/{id}  → 302-redirects to GitHub's short-lived signed
 *                               CDN URL for that asset, so the bytes stream
 *                               directly from GitHub (never through Convex).
 *
 * Setup: `npx convex env set GITHUB_TOKEN <token>` where the token has read
 * access to the repo (classic `repo` scope, or a fine-grained PAT with
 * read-only Contents). Used by `src/hooks/useLatestRelease.ts`.
 */

import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { buildLicense, signPayload } from './licensing'

const GITHUB_OWNER = 'danteata'
const GITHUB_REPO = 'selah'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

function githubJsonHeaders(token: string): Record<string, string> {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'selah-downloads-proxy',
        'X-GitHub-Api-Version': '2022-11-28',
    }
}

const latestRelease = httpAction(async (_ctx, request) => {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
        return new Response(JSON.stringify({ error: 'GITHUB_TOKEN is not configured on this deployment.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
    }

    const res = await fetch(`${GITHUB_API}/releases/latest`, { headers: githubJsonHeaders(token) })
    if (!res.ok) {
        // Pass the status through so the client keeps its 404 ("no releases yet")
        // and 403/429 (rate-limit) messaging.
        return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
    }

    const release = (await res.json()) as { assets?: Array<{ id: number; browser_download_url: string }> }
    // Private-repo asset URLs need auth, so the browser can't use them directly.
    // Rewrite them to this proxy's asset endpoint (same origin as this request).
    const origin = new URL(request.url).origin
    if (Array.isArray(release.assets)) {
        for (const asset of release.assets) {
            asset.browser_download_url = `${origin}/releases/asset/${asset.id}`
        }
    }

    return new Response(JSON.stringify(release), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            ...CORS_HEADERS,
        },
    })
})

const downloadAsset = httpAction(async (_ctx, request) => {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
        return new Response('GITHUB_TOKEN is not configured on this deployment.', { status: 500, headers: CORS_HEADERS })
    }

    const id = new URL(request.url).pathname.split('/').pop()
    if (!id || !/^\d+$/.test(id)) {
        return new Response('Invalid asset id.', { status: 400, headers: CORS_HEADERS })
    }

    const assetUrl = `${GITHUB_API}/releases/assets/${id}`
    const headers = {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'selah-downloads-proxy',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    // `application/octet-stream` makes GitHub answer with a 302 to a short-lived
    // signed CDN URL. We just need that URL to hand to the browser — we never
    // stream the bytes through Convex.
    //
    // Prefer reading the redirect Location directly (manual). If the runtime
    // hides it (spec-compliant opaque redirect), fall back to following the
    // redirect and reading the resolved final URL — the body is left unread.
    let signedUrl: string | null = null
    const manual = await fetch(assetUrl, { headers, redirect: 'manual' })
    if (manual.status >= 300 && manual.status < 400) {
        signedUrl = manual.headers.get('location')
    } else if (manual.ok) {
        signedUrl = manual.url
    }

    if (!signedUrl) {
        const followed = await fetch(assetUrl, { headers, redirect: 'follow' })
        if (!followed.ok) {
            return new Response(await followed.text(), { status: followed.status, headers: CORS_HEADERS })
        }
        signedUrl = followed.url
    }

    return new Response(null, {
        status: 302,
        headers: { Location: signedUrl, ...CORS_HEADERS },
    })
})

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS }))

// ---------------------------------------------------------------------------
// Licensing: Paystack webhook + signed license issuance.
// ---------------------------------------------------------------------------

// /license is called by the app with an Authorization: Bearer <Clerk JWT>, so
// the preflight must advertise that header (the /releases CORS does not).
const LICENSE_CORS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const licensePreflight = httpAction(
    async () => new Response(null, { status: 204, headers: LICENSE_CORS })
)

function bytesToHex(bytes: Uint8Array): string {
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return hex
}

/** Length-checked constant-time string compare (avoids signature timing leaks). */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

type NormalizedEvent = {
    email: string
    status: 'active' | 'non-renewing' | 'attention' | 'past_due' | 'cancelled'
    plan: 'free' | 'pro'
    paystackCustomerCode?: string
    paystackSubscriptionCode?: string
    paystackPlanCode?: string
    currentPeriodEnd?: string | null
    chargedAt?: string
    /** Saved card token (charge.success only) — used for intro→normal rollover. */
    authorizationCode?: string
    /** True only for charge.success, so discounted cycles count once per charge. */
    isCharge?: boolean
}

/**
 * Map a Paystack webhook into our subscription model. Returns null for events
 * we don't act on. We deliberately keep `plan: 'pro'` through payment-retry and
 * non-renewing states so the user keeps Pro until the paid period actually ends
 * (licensing.isProActive downgrades them once `currentPeriodEnd` passes).
 */
function normalizePaystackEvent(event: {
    event?: string
    data?: Record<string, any>
}): NormalizedEvent | null {
    const type = event.event
    const data = event.data ?? {}
    const customer = data.customer ?? data.subscription?.customer ?? {}
    const email: string | undefined =
        customer.email ?? data.metadata?.email ?? data.subscription?.customer?.email
    if (!email) return null

    const subNode = data.subscription ?? data
    const base = {
        email,
        plan: 'pro' as const,
        paystackCustomerCode: customer.customer_code,
        paystackSubscriptionCode: subNode.subscription_code,
        paystackPlanCode: (data.plan ?? subNode.plan)?.plan_code,
        currentPeriodEnd: subNode.next_payment_date ?? undefined,
    }

    switch (type) {
        case 'subscription.create':
            return { ...base, status: 'active' }
        case 'charge.success':
            // Only subscription charges carry a plan; ignore one-off charges.
            if (!base.paystackPlanCode && !base.paystackSubscriptionCode) return null
            return {
                ...base,
                status: 'active',
                chargedAt: data.paid_at,
                authorizationCode: data.authorization?.authorization_code,
                isCharge: true,
            }
        case 'invoice.create':
        case 'invoice.update':
            return {
                ...base,
                status: data.status === 'success' ? 'active' : 'past_due',
                chargedAt: data.paid_at,
            }
        case 'invoice.payment_failed':
            // Paystack auto-retries; mark past_due but DON'T downgrade yet.
            return { ...base, status: 'past_due' }
        case 'subscription.not_renew':
        case 'subscription.disable':
            // Stops renewing; let the current period run out naturally.
            return { ...base, status: 'non-renewing' }
        default:
            return null
    }
}

const paystackWebhook = httpAction(async (ctx, request) => {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) return new Response('Webhook not configured', { status: 500 })

    const raw = await request.text()
    const provided = request.headers.get('x-paystack-signature') ?? ''
    const expected = bytesToHex(
        hmac(sha512, new TextEncoder().encode(secret), new TextEncoder().encode(raw))
    )
    if (!timingSafeEqual(provided, expected)) {
        return new Response('Invalid signature', { status: 401 })
    }

    let event: { event?: string; data?: Record<string, any> }
    try {
        event = JSON.parse(raw)
    } catch {
        return new Response('Bad JSON', { status: 400 })
    }

    const normalized = normalizePaystackEvent(event)
    if (normalized) {
        const result = await ctx.runMutation(internal.licensing.applyPaystackEvent, {
            ...normalized,
            eventAt: new Date().toISOString(),
        })

        // Intro discount used up → start the normal-priced subscription off the
        // saved card so billing continues seamlessly at full price.
        const rollover = result?.rollover
        if (rollover?.revertPlanCode && rollover.customerCode && rollover.authorizationCode) {
            try {
                const res = await fetch('https://api.paystack.co/subscription', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${secret}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        customer: rollover.customerCode,
                        plan: rollover.revertPlanCode,
                        authorization: rollover.authorizationCode,
                        // Begin right when the discounted period ends (omit to start now).
                        ...(rollover.startDate ? { start_date: rollover.startDate } : {}),
                    }),
                })
                const body = (await res.json()) as {
                    status: boolean
                    data?: { subscription_code: string }
                }
                if (res.ok && body.status && body.data?.subscription_code) {
                    await ctx.runMutation(internal.licensing.finalizeRollover, {
                        email: normalized.email,
                        newSubscriptionCode: body.data.subscription_code,
                        planCode: rollover.revertPlanCode,
                    })
                }
                // On failure we intentionally leave the row as-is; the user keeps
                // the (now-ended) intro row and we can retry/repair out of band.
            } catch {
                // Swallow — never fail the webhook over a rollover; Paystack would
                // just retry the whole event.
            }
        }
    }

    // Always 200 quickly so Paystack stops retrying a successfully received event.
    return new Response('ok', { status: 200 })
})

const issueLicense = httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity?.email) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...LICENSE_CORS },
        })
    }

    const email = identity.email.toLowerCase()
    const subscription = await ctx.runQuery(internal.licensing.getEffectiveSubscriptionByEmail, { email })
    const license = signPayload(
        buildLicense({
            email,
            userId: subscription?.userId ?? null,
            subscription,
            nowIso: new Date().toISOString(),
        })
    )

    return new Response(JSON.stringify(license), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            // Licenses are per-user and time-sensitive — never cache.
            'Cache-Control': 'no-store',
            ...LICENSE_CORS,
        },
    })
})

const http = httpRouter()
http.route({ path: '/releases/latest', method: 'GET', handler: latestRelease })
http.route({ path: '/releases/latest', method: 'OPTIONS', handler: preflight })
http.route({ pathPrefix: '/releases/asset/', method: 'GET', handler: downloadAsset })
http.route({ path: '/paystack/webhook', method: 'POST', handler: paystackWebhook })
http.route({ path: '/license', method: 'GET', handler: issueLicense })
http.route({ path: '/license', method: 'OPTIONS', handler: licensePreflight })

export default http
