import { useState, useEffect, useCallback } from 'react'
import { Download, Check, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { getIndexedDB } from '../../hooks/useIndexedDB'
import type { BibleVersion, BibleVerse, Scripture, Hymn } from '../../types'

// Bible data URL from Vue app
const BIBLE_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/bible-versions'

export function BibleVersionSettings() {
    const [bibleVersionOptions, setBibleVersionOptions] = useState<BibleVersion[]>([])
    const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null)
    const [downloadProgress, setDownloadProgress] = useState(0)

    const bibleVersions = useAppStore((state) => state.bibleVersions) as BibleVersion[]
    const setBibleVersions = useAppStore((state) => state.setBibleVersions)
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)

    // Check if a bible version is downloaded in IndexedDB
    const isBibleVersionDownloaded = useCallback(async (version: string): Promise<boolean> => {
        try {
            const db = getIndexedDB()
            const count = await db.bibleAndHymns.where('id').equals(version).count()
            return count > 0
        } catch (error) {
            console.error('Error checking bible version:', error)
            return false
        }
    }, [])

    // Populate bible version options with download status
    const populateBibleVersionOptions = useCallback(async () => {
        const tempVersions = [...bibleVersions]
        for (const version of tempVersions) {
            version.isDownloaded = await isBibleVersionDownloaded(version.id)
        }
        setBibleVersionOptions(tempVersions)
    }, [bibleVersions, isBibleVersionDownloaded])

    // Download a bible version
    const downloadBibleVersion = async (versionId: string) => {
        setDownloadingVersion(versionId)
        setDownloadProgress(0)

        try {
            console.log(`Downloading Bible version: ${versionId}...`)

            // Simulate progress for better UX
            const progressInterval = setInterval(() => {
                setDownloadProgress(prev => Math.min(prev + 10, 90))
            }, 200)

            const response = await fetch(`${BIBLE_DATA_URL}/${versionId.toLowerCase()}.json`)

            if (!response.ok) {
                throw new Error(`Failed to fetch Bible data: ${response.status}`)
            }

            const bibleData = await response.json() as BibleVerse[]

            clearInterval(progressInterval)
            setDownloadProgress(100)

            // Cache in IndexedDB
            const db = getIndexedDB()
            await db.bibleAndHymns.put({
                id: versionId,
                data: bibleData as unknown as Array<Scripture | Hymn>,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })

            console.log(`Bible version ${versionId} downloaded and cached`)

            // Update the version options
            await populateBibleVersionOptions()
        } catch (error) {
            console.error('Error downloading Bible version:', error)
            alert(`Failed to download ${versionId}. Please try again.`)
        } finally {
            setDownloadingVersion(null)
            setDownloadProgress(0)
        }
    }

    useEffect(() => {
        populateBibleVersionOptions()
    }, [populateBibleVersionOptions])

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    Bible Versions
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Download Bible versions for offline use. Downloaded versions are stored locally on your device.
                </p>
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
                    Only downloaded versions are available for selection
                </p>
            </div>

            {/* Version List */}
            <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Available Versions
                </h4>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {bibleVersionOptions.map((version) => (
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

                            <div className="relative z-10">
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                    {version.id}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {version.name}
                                </div>
                                {version.isDownloaded && (
                                    <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                                        {version.copyrightContent}
                                    </div>
                                )}
                            </div>

                            <div className="relative z-10">
                                {version.isDownloaded ? (
                                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                        <Check className="w-4 h-4" />
                                        <span className="text-sm">Saved</span>
                                    </div>
                                ) : downloadingVersion === version.id ? (
                                    <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm">{downloadProgress}%</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => downloadBibleVersion(version.id)}
                                        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-primary-500 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                        Save
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
