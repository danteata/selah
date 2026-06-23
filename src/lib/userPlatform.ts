/**
 * Detects the visitor's OS and CPU architecture from the browser so the
 * downloads page can highlight the right installer.
 *
 * The browser does not expose the real architecture on most platforms
 * (e.g. Apple Silicon Safari reports `MacIntel`), so we use UA heuristics
 * to fill the gaps. The result is best-effort, not authoritative — users
 * can always pick a different platform from the list below the fold.
 */

export type UserOS = 'macos' | 'windows' | 'linux' | 'unknown'
export type UserArch = 'arm64' | 'x64' | 'unknown'

export interface UserPlatform {
    os: UserOS
    arch: UserArch
    /** A short user-facing label, e.g. "macOS · Apple Silicon". */
    label: string
}

interface NavigatorWithUAData extends Navigator {
    userAgentData?: {
        platform: string
        getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
    }
}

export function detectPlatform(): UserPlatform {
    if (typeof navigator === 'undefined') {
        return { os: 'unknown', arch: 'unknown', label: 'Your computer' }
    }

    const ua = navigator.userAgent || ''
    const navAny = navigator as NavigatorWithUAData
    const uaPlatform = navAny.userAgentData?.platform ?? ''

    const lowerPlatform = (uaPlatform || ua).toLowerCase()
    let os: UserOS = 'unknown'
    if (lowerPlatform.includes('mac') || lowerPlatform.includes('darwin')) os = 'macos'
    else if (lowerPlatform.includes('win')) os = 'windows'
    else if (lowerPlatform.includes('linux') || lowerPlatform.includes('ubuntu') || lowerPlatform.includes('fedora')) os = 'linux'

    // Arch heuristics
    let arch: UserArch = 'unknown'
    const platform = (navAny.platform || '').toLowerCase()
    const uaArch = lowerPlatform

    if (platform.includes('arm') || uaArch.includes('aarch64') || uaArch.includes('arm64')) {
        arch = 'arm64'
    } else if (platform.includes('linux arm') || uaArch.includes('aarch64')) {
        arch = 'arm64'
    } else if (platform.includes('win64') || platform.includes('wow64') || uaArch.includes('x86_64') || uaArch.includes('x64')) {
        arch = 'x64'
    } else if (os === 'macos') {
        // Modern Safari on Apple Silicon still reports MacIntel — anything
        // running macOS 11+ in 2024 is overwhelmingly Apple Silicon, but
        // we don't pretend to know. The download button always offers
        // both arches for macOS so users can pick.
        arch = 'unknown'
    } else if (os === 'windows') {
        arch = 'x64'
    } else if (os === 'linux') {
        arch = 'x64'
    }

    const label = formatLabel(os, arch)
    return { os, arch, label }
}

function formatLabel(os: UserOS, arch: UserArch): string {
    if (os === 'unknown') return 'Your computer'
    const osName = os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux'
    if (arch === 'arm64') {
        if (os === 'macos') return 'macOS · Apple Silicon'
        if (os === 'windows') return 'Windows · ARM64'
        return 'Linux · ARM64'
    }
    if (arch === 'x64') {
        if (os === 'macos') return 'macOS · Intel'
        if (os === 'windows') return 'Windows · 64-bit'
        return 'Linux · 64-bit'
    }
    return osName
}
