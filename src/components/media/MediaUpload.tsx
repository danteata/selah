import { useState, useCallback } from 'react'
import { Upload, X, Image, Film, Music, FileText, Check, AlertCircle, Loader2 } from 'lucide-react'
import { openFileDialog } from '../../utils/fileDialog'

export interface UploadedFile {
    id: string
    file: File
    name: string
    type: 'image' | 'video' | 'audio' | 'document'
    size: number
    url: string
    progress: number
    status: 'pending' | 'uploading' | 'complete' | 'error'
    error?: string
}

interface MediaUploadProps {
    onUpload: (files: UploadedFile[]) => void
    onCancel?: () => void
    accept?: string
    multiple?: boolean
    maxSize?: number // in MB
    maxFiles?: number
    className?: string
}

export function MediaUpload({
    onUpload,
    onCancel,
    accept = 'image/*,video/*,audio/*',
    multiple = true,
    maxSize = 50,
    maxFiles = 10,
    className = '',
}: MediaUploadProps) {
    const [files, setFiles] = useState<UploadedFile[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [isUploading, setIsUploading] = useState(false)

    const getFileType = (file: File): UploadedFile['type'] => {
        if (file.type.startsWith('image/')) return 'image'
        if (file.type.startsWith('video/')) return 'video'
        if (file.type.startsWith('audio/')) return 'audio'
        return 'document'
    }

    const getFileIcon = (type: UploadedFile['type']) => {
        switch (type) {
            case 'image': return Image
            case 'video': return Film
            case 'audio': return Music
            default: return FileText
        }
    }

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    }

    const processFiles = useCallback((fileList: FileList | File[]) => {
        const newFiles: UploadedFile[] = []
        const existingCount = files.length

        Array.from(fileList).forEach((file, index) => {
            if (existingCount + index >= maxFiles) return

            // Check file size
            if (file.size > maxSize * 1024 * 1024) {
                newFiles.push({
                    id: `file_${Date.now()}_${index}`,
                    file,
                    name: file.name,
                    type: getFileType(file),
                    size: file.size,
                    url: '',
                    progress: 0,
                    status: 'error',
                    error: `File exceeds ${maxSize}MB limit`,
                })
                return
            }

            newFiles.push({
                id: `file_${Date.now()}_${index}`,
                file,
                name: file.name,
                type: getFileType(file),
                size: file.size,
                url: URL.createObjectURL(file),
                progress: 0,
                status: 'pending',
            })
        })

        setFiles((prev) => [...prev, ...newFiles])
    }, [files.length, maxFiles, maxSize])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        processFiles(e.dataTransfer.files)
    }

    const handleFileClick = async () => {
        try {
            const selectedFiles = await openFileDialog({
                multiple,
                accept,
            });
            if (selectedFiles) {
                processFiles(selectedFiles);
            }
        } catch (error) {
            console.error('Error selecting files:', error);
        }
    }

    const removeFile = (id: string) => {
        setFiles((prev) => {
            const file = prev.find((f) => f.id === id)
            if (file?.url) URL.revokeObjectURL(file.url)
            return prev.filter((f) => f.id !== id)
        })
    }

    const handleUpload = async () => {
        setIsUploading(true)

        // Simulate upload progress for each file
        const updatedFiles = await Promise.all(
            files.map(async (file) => {
                if (file.status === 'error') return file

                // Simulate upload with progress
                for (let progress = 0; progress <= 100; progress += 20) {
                    await new Promise((resolve) => setTimeout(resolve, 100))
                    setFiles((prev) =>
                        prev.map((f) =>
                            f.id === file.id ? { ...f, progress, status: 'uploading' as const } : f
                        )
                    )
                }

                return { ...file, progress: 100, status: 'complete' as const }
            })
        )

        setFiles(updatedFiles)
        setIsUploading(false)
        onUpload(updatedFiles.filter((f) => f.status === 'complete'))
    }

    const validFiles = files.filter((f) => f.status !== 'error')
    const hasErrors = files.some((f) => f.status === 'error')

    return (
        <div className={`space-y-4 ${className}`}>
            {/* Drop Zone */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleFileClick}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-300 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-600'
                    }`}
            >
                <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-primary-500' : 'text-gray-400'
                    }`} />
                <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                    {isDragging ? 'Drop files here' : 'Drag & drop files here'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    or click to browse
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                    Max {maxSize}MB per file • {maxFiles} files max
                </p>
            </div>

            {/* File List */}
            {files.length > 0 && (
                <div className="space-y-2">
                    {files.map((file) => {
                        const Icon = getFileIcon(file.type)
                        return (
                            <div
                                key={file.id}
                                className={`flex items-center gap-3 p-3 rounded-lg border ${file.status === 'error'
                                    ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                                    }`}
                            >
                                {/* Thumbnail or Icon */}
                                {file.type === 'image' && file.url ? (
                                    <img
                                        src={file.url}
                                        alt={file.name}
                                        className="w-12 h-12 object-cover rounded"
                                    />
                                ) : (
                                    <div className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded">
                                        <Icon className="w-6 h-6 text-gray-500" />
                                    </div>
                                )}

                                {/* File Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                        {file.name}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {formatSize(file.size)}
                                    </p>
                                    {file.status === 'uploading' && (
                                        <div className="mt-1 w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary-500 transition-all"
                                                style={{ width: `${file.progress}%` }}
                                            />
                                        </div>
                                    )}
                                    {file.error && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            {file.error}
                                        </p>
                                    )}
                                </div>

                                {/* Status / Remove */}
                                <div className="flex-shrink-0">
                                    {file.status === 'complete' ? (
                                        <Check className="w-5 h-5 text-green-500" />
                                    ) : file.status === 'error' ? (
                                        <AlertCircle className="w-5 h-5 text-red-500" />
                                    ) : file.status === 'uploading' ? (
                                        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                                    ) : (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                removeFile(file.id)
                                            }}
                                            className="p-1 text-gray-400 hover:text-red-500 rounded"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Actions */}
            {files.length > 0 && (
                <div className="flex justify-end gap-3">
                    {onCancel && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        onClick={handleUpload}
                        disabled={isUploading || validFiles.length === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Upload className="w-4 h-4" />
                                Upload {validFiles.length} file{validFiles.length !== 1 ? 's' : ''}
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    )
}
