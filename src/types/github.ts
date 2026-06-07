/**
 * Subset of the GitHub Releases API response that the downloads page needs.
 * Full schema: https://docs.github.com/en/rest/releases/releases
 */

export interface GitHubReleaseAuthor {
    login: string
    avatar_url: string
    html_url: string
}

export interface GitHubReleaseAsset {
    id: number
    name: string
    label: string | null
    content_type: string
    state: 'uploaded' | 'open'
    size: number
    download_count: number
    browser_download_url: string
    created_at: string
    updated_at: string
}

export interface GitHubRelease {
    id: number
    tag_name: string
    target_commitish: string
    name: string | null
    body: string | null
    draft: boolean
    prerelease: boolean
    created_at: string
    published_at: string | null
    html_url: string
    tarball_url: string | null
    zipball_url: string | null
    author: GitHubReleaseAuthor
    assets: GitHubReleaseAsset[]
}
