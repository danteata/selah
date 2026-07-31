/**
 * Telling "you're on the free plan" apart from "we couldn't check".
 *
 * Desktop entitlement comes from a signed licence file that `fetch_and_store_license`
 * pulls from the backend and caches locally; when that fetch fails the provider
 * falls back to whatever is already cached. So a machine that has never managed a
 * successful fetch — a fresh install while the backend is down — has no licence at
 * all, and looked identical to a genuine free user.
 *
 * That difference matters: it is the same account behaving differently on two
 * computers, and the one that can't verify was showing a paying operator an
 * upgrade prompt. Pro stays gated either way (entitlement can't be granted without
 * evidence), but the two cases need different words and a different button.
 */

export type EntitlementCertainty = 'verified' | 'unverified'

/**
 * `unverified` when no licence could be read at all — not while still loading, and
 * not when a licence was read that happens to say "free".
 */
export function entitlementCertainty(
    hasLicence: boolean,
    loading: boolean,
): EntitlementCertainty {
    if (loading) return 'verified'
    return hasLicence ? 'verified' : 'unverified'
}

/** Copy for the two cases, so every gate says the same thing. */
export function proGateMessage(certainty: EntitlementCertainty, feature: string): {
    title: string
    description: string
    /** True when the operator should retry rather than be sold to. */
    retryable: boolean
} {
    if (certainty === 'unverified') {
        return {
            title: "Couldn't check your licence",
            description: `${feature} needs Selah Pro, and this computer hasn't been able to reach the licence server to confirm your plan. Check your connection and try again — if you're signed in elsewhere and it works there, that machine has a cached licence and this one doesn't yet.`,
            retryable: true,
        }
    }

    return {
        title: `${feature} is a Selah Pro feature`,
        description: 'Upgrade to unlock it.',
        retryable: false,
    }
}
