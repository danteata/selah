import { useState, useEffect, useCallback } from 'react'
import { Download, Check, Loader2, Cloud, CloudOff, Database, HardDrive } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useScripture, type BibleVersionStatus } from '../../hooks/useScripture'
import type { BibleVersion } from '../../types'

export function BibleVersionSettings() {
    const [bibleVersionOptions, setBibleVersionOptions] = useState<BibleVersion[]>([])
    const [versionStatuses, setVersionStatuses] = useState<Record<string, BibleVersionStatus>>({})
    const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null)
    const [downloadProgress, setDownloadProgress] = useState(0)

    const bibleVersions = useAppStore((state) => state.bibleVersions) as BibleVersion[]
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)

    const { downloadBibleVersion, isVersionDownloaded, getVersionStatus } = useScripture()

    // Check status of all versions
    const checkAllVersionStatuses = useCallback(async () => {
        const statuses: Record<string, BibleVersionStatus> = {}

        for (const version of bibleVersions) {
            try {
                const status = await getVersionStatus(version.id)
                statuses[version.id] = status
            } catch (error) {
                console.error(`Error checking status for ${version.id}:`, error)
                statuses[version.id] = {
                    id: version.id,
                    downloaded: false,
                    source: null,
                    availableOnConvex: false,
                    availableOnCdn: false,
                }
            }
        }

        setVersionStatuses(statuses)

        // Update bibleVersionOptions with download status
        const updatedVersions = bibleVersions.map(v => ({
            ...v,
            isDownloaded: statuses[v.id]?.downloaded || false,
        }))
        setBibleVersionOptions(updatedVersions)
    }, [bibleVersions, getVersionStatus])

    // Handle download
    const handleDownload = async (versionId: string) => {
        setDownloadingVersion(versionId)
        setDownloadProgress(0)

        try {
            // Simulate progress for better UX
            const progressInterval = setInterval(() => {
                setDownloadProgress(prev => Math.min(prev + 10, 90))
            }, 200)

            const result = await downloadBibleVersion(versionId)

            clearInterval(progressInterval)
            setDownloadProgress(100)

            if (result) {
                // Refresh statuses
                await checkAllVersionStatuses()
            } else {
                alert(`Failed to download ${versionId}. Please try again.`)
            }
        } catch (error) {
            console.error('Error downloading Bible version:', error)
            alert(`Failed to download ${versionId}. Please try again.`)
        } finally {
            setDownloadingVersion(null)
            setDownloadProgress(0)
        }
    }

    useEffect(() => {
        checkAllVersionStatuses()
    }, [checkAllVersionStatuses])

    // Get status icon and label
    const getStatusDisplay = (versionId: string) => {
        const status = versionStatuses[versionId]
        if (!status) return { icon: null, label: 'Checking...', color: 'text-gray-400' }

        if (status.downloaded) {
            return {
                icon: <HardDrive className="w-4 h-4" />,
                label: 'Cached locally',
                color: 'text-green-600 dark:text-green-400',
            }
        }

        if (status.availableOnConvex) {
            return {
                icon: <Database className="w-4 h-4" />,
                label: 'Available on Convex',
                color: 'text-blue-600 dark:text-blue-400',
            }
        }

        if (status.availableOnCdn) {
            return {
                icon: <Cloud className="w-4 h-4" />,
                label: 'Available on CDN',
                color: 'text-yellow-600 dark:text-yellow-400',
            }
        }

        return {
            icon: <CloudOff className="w-4 h-4" />,
            label: 'Unavailable',
            color: 'text-red-600 dark:text-red-400',
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    Bible Versions
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Download Bible versions for offline use. Data is fetched from Convex (primary) or CDN (fallback) and cached locally.
                </p>
            </div>

            {/* Data Source Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-green-600" />
                    <span>Cached locally</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-600" />
                    <span>Convex (primary)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Cloud className="w-3.5 h-3.5 text-yellow-600" />
                    <span>CDN (fallback)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <CloudOff className="w-3.5 h-3.5 text-red-600" />
                    <span>Unavailable</span>
                </div>
            </div>

            {/* Default Version Selector */}
            <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Default Bible Version
                </label>
                <select
                    value={defaultBibleVersion || 'KJV'}
                    onChange={(e) => setDefaultBibleVersion(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                >
                    {bibleVersionOptions
                        .filter(v => v.isDownloaded)
                        .map((version) => (
                            <option key={version.id} value={version.id}>
                                {version.name} ({version.id})
                            </option>
                        ))}
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Only cached versions are available for selection
                </p>
            </div>

            {/* Version List */}
            <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Available Versions
                </h4>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {bibleVersionOptions.map((version) => {
                        const status = getStatusDisplay(version.id)
                        const versionStatus = versionStatuses[version.id]

                        return (
                            <div
                                key={version.id}
                                className="relative flex items-center justify-between py-4"
                            >
                                {/* Progress bar overlay */}
                                {downloadingVersion === version.id && (
                                    <div
                                        className="absolute inset-0 bg-primary-100 dark:bg-primary-900/30 transition-all duration-300"
                                        style={{ width: `${downloadProgress}%` }}
                                    />
                                )}

                                <div className="relative z-10 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {version.id}
                                        </span>
                                        {/* Status badge */}
                                        <span className={`flex items-center gap-1 text-xs ${status.color}`}>
                                            {status.icon}
                                            <span>{status.label}</span>
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {version.name}
                                    </div>
                                    {version.isDownloaded && (
                                        <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            {version.copyrightContent}
                                        </div>
                                    )}
                                    {version.isPublicDomain && (
                                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                                            Public Domain
                                        </div>
                                    )}
                                </div>

                                <div className="relative z-10">
                                    {version.isDownloaded ? (
                                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                            <Check className="w-4 h-4" />
                                            <span className="text-sm">Cached</span>
                                        </div>
                                    ) : downloadingVersion === version.id ? (
                                        <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span className="text-sm">{downloadProgress}%</span>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => handleDownload(version.id)}
                                            disabled={!versionStatus?.availableOnConvex && !versionStatus?.availableOnCdn}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-primary-500 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Download className="w-4 h-4" />
                                            Cache
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Info */}
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                    How Bible data is fetched:
                </h4>
                <ol className="text-xs text-blue-700 dark:text-blue-300 list-decimal list-inside space-y-1">
                    <li>First, check local IndexedDB cache</li>
                    <li>If not cached, fetch from Convex database</li>
                    <li>If Convex unavailable, fallback to CDN</li>
                    <li>Cache downloaded data for offline use</li>
                </ol>
            </div>
        </div>
    )
}
