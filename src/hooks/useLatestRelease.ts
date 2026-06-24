/**
 * useLatestRelease — fetches the latest published GitHub release for Selah
 * and normalises its assets into the platform/arch buckets the downloads
 * page expects.
 *
 * Why GitHub Releases:
 *  - The `tauri-action` in `.github/workflows/build-desktop.yml` already
 *    uploads the bundles there on every tag push.
 *  - `latest.json.template` already points the in-app updater at GitHub
 *    release URLs, so this is the single source of truth.
 *  - Free, zero-config, unlimited bandwidth.
 *
 * To swap the source (e.g. to Cloudflare R2) later, replace `fetchRelease`
 * with a fetcher for your storage backend. The shape of the returned
 * `NormalisedRelease` is intentionally backend-agnostic.
 */

import { useEffect, useState } from 'react'
import type { GitHubRelease, GitHubReleaseAsset } from '../types/github'
import type { UserArch, UserOS } from '../lib/userPlatform'

export const SELAH_REPO = {
    owner: 'danteata',
    repo: 'selah',
} as const

// The repo is private, so we can't hit api.github.com from the browser (404 to
// anonymous requests, and asset downloads need auth). Instead we go through the
// Convex HTTP proxy (convex/http.ts), which runs server-side with a token and
// rewrites asset URLs to flow through itself. Convex HTTP actions are served on
// the `.site` domain (vs `.convex.cloud` for the data API).
const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL ?? '').replace(/\.convex\.cloud$/, '.convex.site')
const RELEASES_ENDPOINT = `${CONVEX_SITE_URL}/releases/latest`

export interface AssetRef {
    /** Display label, e.g. "Apple Silicon", "Intel", "x64", "ARM64". */
    label: string
    /** Browser-facing download URL. */
    url: string
    /** File name, e.g. "Selah.app.tar.gz". */
    fileName: string
    /** Bytes. */
    size: number
    /** Comma-separated formats for the UI, e.g. "AppImage, .tar.gz". */
    format: string
}

export interface PlatformBucket {
    /** Operating system this bucket is for. */
    os: UserOS
    /** Bucket of installer variants for this OS (multiple archs, etc.). */
    variants: AssetRef[]
}

export interface NormalisedRelease {
    tag: string
    version: string
    name: string
    publishedAt: string | null
    htmlUrl: string
    body: string | null
    buckets: PlatformBucket[]
    /** Flat list of all .sig signature files for display. */
    signatures: AssetRef[]
}

interface UseLatestReleaseState {
    status: 'idle' | 'loading' | 'ready' | 'error'
    release: NormalisedRelease | null
    error: string | null
}

async function fetchLatestRelease(): Promise<NormalisedRelease> {
    const res = await fetch(RELEASES_ENDPOINT)
    if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
            throw new Error(
                "GitHub is rate-limiting us. Try refreshing in a minute, or grab the latest version straight from the releases page."
            )
        }
        if (res.status === 404) {
            throw new Error(
                "No releases have been published yet. Check back soon, or grab a build from the actions tab if you're a maintainer."
            )
        }
        throw new Error(`Couldn't load the latest release (HTTP ${res.status}).`)
    }
    const json = (await res.json()) as GitHubRelease
    return normalise(json)
}

/**
 * Map a GitHub asset into the right OS / arch bucket. Tauri-action
 * produces a stable set of filenames; the regexes here cover the
 * names declared in `latest.json.template` plus the loose variants
 * the action can produce (`Selah_aarch64.app.tar.gz`, `Selah_x64.msi.zip`,
 * etc.).
 */
function classify(asset: GitHubReleaseAsset): {
    os: UserOS
    arch: UserArch
    format: string
    label: string
} | null {
    const name = asset.name.toLowerCase()
    // Skip updater signatures and the updater manifest — those aren't
    // direct download links. We surface `.sig` separately for power users.
    if (name.endsWith('.sig')) return null
    if (name === 'latest.json') return null
    if (name === 'releases.html' || name.endsWith('.txt')) return null

    // macOS — covers both the updater artifact (.app.tar.gz) and the
    // raw .dmg if a maintainer adds it later.
    if (name.endsWith('.app.tar.gz') || name.endsWith('.dmg') || name.includes('.app')) {
        const isArm =
            name.includes('aarch64') ||
            name.includes('arm64') ||
            name.includes('apple_silicon') ||
            name.includes('apple-silicon')
        return {
            os: 'macos',
            arch: isArm ? 'arm64' : 'x64',
            format: name.endsWith('.dmg') ? 'DMG' : 'app.tar.gz',
            label: isArm ? 'Apple Silicon' : 'Intel',
        }
    }

    // Windows — tauri-action produces `Selah_<ver>_x64-setup.nsis.zip`
    // and the same for `arm64`. The bundle may also include a raw
    // `.msi.zip` if the maintainer enabled MSI bundling.
    if (
        name.endsWith('.nsis.zip') ||
        name.endsWith('.msi.zip') ||
        name.endsWith('.exe') ||
        name.endsWith('.msi')
    ) {
        const isArm = name.includes('arm64') || name.includes('aarch64')
        const format = name.includes('nsis')
            ? 'NSIS installer'
            : name.includes('msi')
              ? 'MSI'
              : 'Installer'
        return {
            os: 'windows',
            arch: isArm ? 'arm64' : 'x64',
            format,
            label: isArm ? 'ARM64' : 'x64',
        }
    }

    // Linux — `.AppImage.tar.gz` (updater artifact) or raw `.AppImage` /
    // `.deb` / `.rpm` if a maintainer adds them.
    if (
        name.endsWith('.appimage.tar.gz') ||
        name.endsWith('.appimage') ||
        name.endsWith('.deb') ||
        name.endsWith('.rpm')
    ) {
        const isArm = name.includes('aarch64') || name.includes('arm64')
        const format = name.endsWith('.deb')
            ? 'Debian package'
            : name.endsWith('.rpm')
              ? 'RPM package'
              : 'AppImage'
        return {
            os: 'linux',
            arch: isArm ? 'arm64' : 'x64',
            format,
            label: isArm ? 'ARM64' : 'x64',
        }
    }

    return null
}

function normalise(release: GitHubRelease): NormalisedRelease {
    const buckets: Record<UserOS, Map<UserArch, AssetRef>> = {
        macos: new Map(),
        windows: new Map(),
        linux: new Map(),
        unknown: new Map(),
    }
    const signatures: AssetRef[] = []

    for (const asset of release.assets) {
        if (asset.name.endsWith('.sig')) {
            signatures.push({
                label: asset.name,
                url: asset.browser_download_url,
                fileName: asset.name,
                size: asset.size,
                format: 'signature',
            })
            continue
        }
        const meta = classify(asset)
        if (!meta) continue
        const bucket = buckets[meta.os]
        // Prefer raw installer bundles (.dmg, .msi, .AppImage, .deb, .rpm,
        // .exe) over the Tauri updater artifacts (.app.tar.gz, .nsis.zip,
        // .msi.zip, .AppImage.tar.gz). The updater artifacts still ship in
        // the release — they're consumed by the in-app updater via
        // `latest.json` — but the landing page should default to the
        // familiar drag-to-Applications format users expect.
        const isUpdaterBundleFile = (fileName: string): boolean =>
            fileName.endsWith('.tar.gz') ||
            fileName.endsWith('.nsis.zip') ||
            fileName.endsWith('.msi.zip')
        const existing = bucket.get(meta.arch)
        if (existing) {
            const newIsUpdater = isUpdaterBundleFile(asset.name)
            const existingIsUpdater = isUpdaterBundleFile(existing.fileName)
            if (!newIsUpdater && existingIsUpdater) {
                bucket.set(meta.arch, toAssetRef(asset, meta))
            }
        } else {
            bucket.set(meta.arch, toAssetRef(asset, meta))
        }
    }

    const platformBuckets: PlatformBucket[] = (['macos', 'windows', 'linux'] as UserOS[]).map((os) => {
        const map = buckets[os]
        const variants: AssetRef[] = []
        // Order: arm64 first, then x64 (so Apple Silicon users see the
        // right one on top), then any extras.
        if (map.has('arm64')) variants.push(map.get('arm64')!)
        if (map.has('x64')) variants.push(map.get('x64')!)
        return { os, variants }
    })

    return {
        tag: release.tag_name,
        version: release.tag_name.replace(/^v/i, ''),
        name: release.name ?? release.tag_name,
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        body: release.body,
        buckets: platformBuckets,
        signatures,
    }
}

function toAssetRef(
    asset: GitHubReleaseAsset,
    meta: { format: string; label: string }
): AssetRef {
    return {
        label: meta.label,
        url: asset.browser_download_url,
        fileName: asset.name,
        size: asset.size,
        format: meta.format,
    }
}

export function useLatestRelease(): UseLatestReleaseState {
    // Start as 'loading' so the effect doesn't have to call setState
    // synchronously to transition out of an idle state. See the
    // `react-hooks/set-state-in-effect` lint rule.
    const [state, setState] = useState<UseLatestReleaseState>({
        status: 'loading',
        release: null,
        error: null,
    })

    useEffect(() => {
        let cancelled = false
        fetchLatestRelease()
            .then((release) => {
                if (cancelled) return
                setState({ status: 'ready', release, error: null })
            })
            .catch((err: unknown) => {
                if (cancelled) return
                const message = err instanceof Error ? err.message : 'Unknown error.'
                setState({ status: 'error', release: null, error: message })
            })
        return () => {
            cancelled = true
        }
    }, [])

    return state
}

/** Pure helper exposed for tests. */
export const _internal = { classify, normalise, fetchLatestRelease }
