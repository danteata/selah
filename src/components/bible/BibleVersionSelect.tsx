import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, Settings } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { getIndexedDB } from '../../hooks/useIndexedDB'
import type { BibleVersion } from '../../types'

interface BibleVersionSelectProps {
    selectedVersion?: string
    onChange: (version: string) => void
    className?: string
}

export function BibleVersionSelect({
    selectedVersion,
    onChange,
    className = ''
}: BibleVersionSelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [downloadedVersions, setDownloadedVersions] = useState<BibleVersion[]>([])

    const bibleVersions = useAppStore((state) => state.bibleVersions) as BibleVersion[]
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const openModal = useAppStore((state) => state.openModal)

    const currentVersion = selectedVersion || defaultBibleVersion || 'KJV'

    // Check which versions are downloaded
    const checkDownloadedVersions = useCallback(async () => {
        const db = getIndexedDB()
        const downloaded: BibleVersion[] = []

        for (const version of bibleVersions) {
            const count = await db.bibleAndHymns.where('id').equals(version.id).count()
            if (count > 0) {
                downloaded.push({ ...version, isDownloaded: true })
            }
        }

        setDownloadedVersions(downloaded)
    }, [bibleVersions])

    useEffect(() => {
        checkDownloadedVersions()
    }, [checkDownloadedVersions])

    const handleSelect = (versionId: string) => {
        if (versionId === '+ More Versions') {
            openModal('settings')
            setIsOpen(false)
        } else {
            onChange(versionId)
            setIsOpen(false)
        }
    }

    return (
        <div className={`relative ${className}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 px-2 py-1 text-sm bg-primary-100 dark:bg-primary-900/30 rounded hover:bg-primary-200 dark:hover:bg-primary-900/50 transition-colors"
            >
                <span className="font-medium">{currentVersion}</span>
                <ChevronDown className="w-3 h-3" />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dropdown */}
                    <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
                        {downloadedVersions.map((version) => (
                            <button
                                key={version.id}
                                onClick={() => handleSelect(version.id)}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${currentVersion === version.id
                                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                                    : 'text-gray-700 dark:text-gray-300'
                                    }`}
                            >
                                <div className="font-medium">{version.id}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {version.name}
                                </div>
                            </button>
                        ))}

                        {/* More Versions option */}
                        <div className="border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">
                            <button
                                onClick={() => handleSelect('+ More Versions')}
                                className="w-full text-left px-3 py-2 text-sm text-primary-600 dark:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                            >
                                <Settings className="w-4 h-4" />
                                <span>More Versions</span>
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
