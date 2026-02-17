import { useState, useEffect, useCallback } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { bibleVersionObjects } from '../../types'
import { useUserRole } from '../../hooks/useUserRole'
import type { BibleVerse } from '../../types'

const BIBLE_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/bible-versions'

interface VersionUploadStatus {
    id: string
    name: string
    status: 'pending' | 'downloading' | 'uploading' | 'completed' | 'error'
    error?: string
    verseCount?: number
    fileSize?: number
}

interface BibleVersionUploaderProps {
    onClose?: () => void
}

export function BibleVersionUploader({ onClose }: BibleVersionUploaderProps) {
    const convex = useConvex()
    const generateUploadUrl = useMutation(api.bibleVersions.generateUploadUrl)
    const saveBibleVersion = useMutation(api.bibleVersions.saveBibleVersion)
    const { isSuperadmin, isLoading: roleLoading } = useUserRole()

    const [versions, setVersions] = useState<VersionUploadStatus[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const [currentUploading, setCurrentUploading] = useState<string | null>(null)
    const [uploadedBy, setUploadedBy] = useState('admin')

    // Redirect non-superadmins
    if (!roleLoading && !isSuperadmin) {
        return (
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
                <div className="text-center py-12">
                    <div className="text-red-500 text-6xl mb-4">🚫</div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                        Access Denied
                    </h2>
                    <p className="text-gray-600">
                        Only superadmins can upload Bible versions to Convex.
                    </p>
                </div>
            </div>
        )
    }

    // Initialize versions list
    useEffect(() => {
        const initializeVersions = async () => {
            const versionStatuses: VersionUploadStatus[] = await Promise.all(
                bibleVersionObjects.map(async (version) => {
                    // Check if already in Convex
                    const exists = await convex.query(api.bibleVersions.hasBibleVersion, { id: version.id })
                    return {
                        id: version.id,
                        name: version.name,
                        status: exists ? 'completed' : 'pending',
                        verseCount: exists ? undefined : undefined,
                    }
                })
            )
            setVersions(versionStatuses)
        }

        initializeVersions()
    }, [convex])

    // Download Bible data from CDN
    const downloadFromCdn = useCallback(async (versionId: string): Promise<{ data: BibleVerse[], blob: Blob } | null> => {
        try {
            const response = await fetch(`${BIBLE_DATA_URL}/${versionId.toLowerCase()}.json`)
            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status}`)
            }
            const data = await response.json() as BibleVerse[]
            // Also create a blob for file upload
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
            return { data, blob }
        } catch (error) {
            console.error(`Error downloading ${versionId}:`, error)
            return null
        }
    }, [])

    // Upload a single version to Convex using file storage
    const uploadVersion = useCallback(async (versionId: string) => {
        const versionInfo = bibleVersionObjects.find(v => v.id === versionId)
        if (!versionInfo) return

        setCurrentUploading(versionId)
        setVersions(prev => prev.map(v =>
            v.id === versionId ? { ...v, status: 'downloading' as const } : v
        ))

        // Download from CDN
        const result = await downloadFromCdn(versionId)
        if (!result) {
            setVersions(prev => prev.map(v =>
                v.id === versionId ? { ...v, status: 'error' as const, error: 'Failed to download from CDN' } : v
            ))
            setCurrentUploading(null)
            return
        }

        const { data, blob } = result

        setVersions(prev => prev.map(v =>
            v.id === versionId ? {
                ...v,
                status: 'uploading' as const,
                verseCount: data.length,
                fileSize: blob.size,
            } : v
        ))

        try {
            // Step 1: Get upload URL from Convex
            const uploadUrl = await generateUploadUrl()

            // Step 2: Upload the file to Convex storage
            const uploadResponse = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: blob,
            })

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`)
            }

            // Get the storage ID from the response
            const { storageId } = await uploadResponse.json()

            // Step 3: Save metadata to database
            await saveBibleVersion({
                id: versionId,
                name: versionInfo.name,
                verseCount: data.length,
                copyrightContent: versionInfo.copyrightContent || '',
                isPublicDomain: versionInfo.isPublicDomain || false,
                uploadedBy,
                fileId: storageId,
                fileSize: blob.size,
            })

            setVersions(prev => prev.map(v =>
                v.id === versionId ? { ...v, status: 'completed' as const } : v
            ))
        } catch (error) {
            console.error(`Error uploading ${versionId}:`, error)
            setVersions(prev => prev.map(v =>
                v.id === versionId ? { ...v, status: 'error' as const, error: String(error) } : v
            ))
        }

        setCurrentUploading(null)
    }, [downloadFromCdn, generateUploadUrl, saveBibleVersion, uploadedBy])

    // Upload all pending versions
    const uploadAllPending = useCallback(async () => {
        setIsUploading(true)

        const pendingVersions = versions.filter(v => v.status === 'pending')
        for (const version of pendingVersions) {
            await uploadVersion(version.id)
        }

        setIsUploading(false)
    }, [versions, uploadVersion])

    // Get counts
    const pendingCount = versions.filter(v => v.status === 'pending').length
    const completedCount = versions.filter(v => v.status === 'completed').length
    const errorCount = versions.filter(v => v.status === 'error').length

    // Format file size
    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    return (
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                    Bible Version Admin - Upload to Convex Storage
                </h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">{completedCount}</div>
                    <div className="text-sm text-gray-500">Uploaded</div>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
                    <div className="text-sm text-gray-500">Pending</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                    <div className="text-sm text-gray-500">Errors</div>
                </div>
            </div>

            {/* Uploaded By Field */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Uploaded By
                </label>
                <input
                    type="text"
                    value={uploadedBy}
                    onChange={(e) => setUploadedBy(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Admin name or email"
                />
            </div>

            {/* Upload All Button */}
            {pendingCount > 0 && (
                <div className="mb-6">
                    <button
                        onClick={uploadAllPending}
                        disabled={isUploading}
                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isUploading ? 'Uploading...' : `Upload All Pending (${pendingCount})`}
                    </button>
                </div>
            )}

            {/* Version List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
                {versions.map((version) => (
                    <div
                        key={version.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${version.status === 'completed' ? 'bg-green-50 border-green-200' :
                            version.status === 'error' ? 'bg-red-50 border-red-200' :
                                version.status === 'downloading' || version.status === 'uploading' ? 'bg-blue-50 border-blue-200' :
                                    'bg-gray-50 border-gray-200'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            {/* Status Icon */}
                            {version.status === 'completed' && (
                                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                            {version.status === 'error' && (
                                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                            {(version.status === 'downloading' || version.status === 'uploading') && (
                                <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                            {version.status === 'pending' && (
                                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            )}

                            <div>
                                <div className="font-medium text-gray-900">{version.name}</div>
                                <div className="text-sm text-gray-500">
                                    {version.id}
                                    {version.verseCount && ` • ${version.verseCount.toLocaleString()} verses`}
                                    {version.fileSize && ` • ${formatFileSize(version.fileSize)}`}
                                </div>
                                {version.error && (
                                    <div className="text-sm text-red-600">{version.error}</div>
                                )}
                            </div>
                        </div>

                        {/* Action Button */}
                        {version.status === 'pending' && (
                            <button
                                onClick={() => uploadVersion(version.id)}
                                disabled={isUploading}
                                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                            >
                                Upload
                            </button>
                        )}
                        {version.status === 'error' && (
                            <button
                                onClick={() => uploadVersion(version.id)}
                                disabled={isUploading}
                                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
                            >
                                Retry
                            </button>
                        )}
                        {(version.status === 'downloading' || version.status === 'uploading') && (
                            <span className="text-sm text-blue-600 capitalize">{version.status}...</span>
                        )}
                        {version.status === 'completed' && (
                            <span className="text-sm text-green-600">✓ Uploaded</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Info */}
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">How it works:</h3>
                <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                    <li>Bible data is downloaded from the CDN</li>
                    <li>Data is uploaded to Convex File Storage (single file per version)</li>
                    <li>Metadata is stored in the database for quick lookups</li>
                    <li>App caches Bible data locally in IndexedDB for offline use</li>
                </ol>
                <p className="text-xs text-blue-600 mt-2">
                    💡 This hybrid approach minimizes costs: 1 file upload per version vs thousands of database writes
                </p>
            </div>
        </div>
    )
}
