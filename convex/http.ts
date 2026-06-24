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

const http = httpRouter()
http.route({ path: '/releases/latest', method: 'GET', handler: latestRelease })
http.route({ path: '/releases/latest', method: 'OPTIONS', handler: preflight })
http.route({ pathPrefix: '/releases/asset/', method: 'GET', handler: downloadAsset })

export default http
