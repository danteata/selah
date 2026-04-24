import { useState, useEffect, useRef } from 'react'
import { X, Clock, Plus, Play, Pause, RotateCcw } from 'lucide-react'
import { BackgroundPicker, type BackgroundSelection } from '../utils/BackgroundPicker'
import type { Slide } from '../../types'

interface AddCountdownModalProps {
    isOpen?: boolean
    onClose?: () => void
    onAdd: (countdown: CountdownData) => void
    editingSlide?: Slide | null
    isInline?: boolean
}

export interface CountdownData {
    id: string
    hours: number
    minutes: number
    seconds: number
    title: string
    background: string
    backgroundType: string
    backgroundStorageId?: string | null
}

const DEFAULT_BG: BackgroundSelection = {
    label: 'Midnight',
    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    backgroundType: 'gradient',
}

export function AddCountdownModal({ isOpen = true, onClose, onAdd, editingSlide, isInline = false }: AddCountdownModalProps) {
    const [hours, setHours] = useState(0)
    const [minutes, setMinutes] = useState(5)
    const [seconds, setSeconds] = useState(0)
    const [title, setTitle] = useState('')
    const [selectedBg, setSelectedBg] = useState<BackgroundSelection>(DEFAULT_BG)

    // Pre-populate form when editing an existing slide
    useEffect(() => {
        if (editingSlide && editingSlide.type === 'countdown') {
            // Parse time from contents[1] (format: "HH:MM:SS" or "MM:SS")
            const timeStr = editingSlide.contents?.[1] || '00:05:00'
            const parts = timeStr.split(':').map(Number)
            if (parts.length === 3) {
                setHours(parts[0] || 0)
                setMinutes(parts[1] || 0)
                setSeconds(parts[2] || 0)
            } else if (parts.length === 2) {
                setHours(0)
                setMinutes(parts[0] || 0)
                setSeconds(parts[1] || 0)
            }
            // Parse title from contents[0]
            const titleContent = editingSlide.contents?.[0] || ''
            const strippedTitle = titleContent.replace(/<[^>]*>/g, '').trim()
            setTitle(strippedTitle)
            // Set background
            if (editingSlide.background) {
                setSelectedBg({
                    background: editingSlide.background,
                    backgroundType: editingSlide.backgroundType || 'gradient',
                    backgroundStorageId: editingSlide.backgroundStorageId,
                })
            }
        } else {
            // Reset to defaults for new countdown
            setHours(0)
            setMinutes(5)
            setSeconds(0)
            setTitle('')
            setSelectedBg(DEFAULT_BG)
        }
    }, [editingSlide, isOpen, isInline])

    const presets = [
        { label: '1m', h: 0, m: 1, s: 0 },
        { label: '5m', h: 0, m: 5, s: 0 },
        { label: '10m', h: 0, m: 10, s: 0 },
        { label: '15m', h: 0, m: 15, s: 0 },
        { label: '30m', h: 0, m: 30, s: 0 },
        { label: '1h', h: 1, m: 0, s: 0 },
    ]

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        onAdd({
            id: editingSlide?.id || `countdown_${Date.now()}`,
            hours,
            minutes,
            seconds,
            title: title.trim() || 'Countdown',
            background: selectedBg.background,
            backgroundType: selectedBg.backgroundType,
            backgroundStorageId: selectedBg.backgroundStorageId ?? null,
        })

        if (!isInline) {
            // Reset form
            setHours(0)
            setMinutes(5)
            setSeconds(0)
            setTitle('')
            setSelectedBg(DEFAULT_BG)
            onClose?.()
        }
    }

    const applyPreset = (preset: { h: number; m: number; s: number }) => {
        setHours(preset.h)
        setMinutes(preset.m)
        setSeconds(preset.s)
    }

    if (!isOpen && !isInline) return null

    const pad = (n: number) => String(n).padStart(2, '0')
    const previewTime = hours > 0
        ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`

    const content = (
        <div className={`${isInline ? 'h-full bg-transparent' : 'w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-h-[90vh]'} flex flex-col overflow-hidden`}>
            {/* Header */}
            {!isInline && (
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                    <div className="p-2 bg-[var(--accent-teal)]/10 rounded-lg">
                        <Clock className="w-5 h-5 text-[var(--accent-teal)]" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        {editingSlide ? 'Edit Countdown' : 'Add Countdown'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className={`${isInline ? 'p-3' : 'p-4'} space-y-4 overflow-y-auto flex-1 custom-scrollbar`}>
                    {/* Title */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Title <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Service starts in..."
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                        />
                    </div>

                    {/* Time Inputs */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Duration
                        </label>
                        <div className="flex gap-4 justify-center">
                            <div className="text-center">
                                <input
                                    type="number"
                                    value={hours}
                                    onChange={(e) => setHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="23"
                                    className="w-20 px-3 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hours</p>
                            </div>
                            <span className="text-3xl font-bold text-gray-400 self-center pb-5">:</span>
                            <div className="text-center">
                                <input
                                    type="number"
                                    value={minutes}
                                    onChange={(e) => setMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="59"
                                    className="w-20 px-3 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minutes</p>
                            </div>
                            <span className="text-3xl font-bold text-gray-400 self-center pb-5">:</span>
                            <div className="text-center">
                                <input
                                    type="number"
                                    value={seconds}
                                    onChange={(e) => setSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="59"
                                    className="w-20 px-3 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Seconds</p>
                            </div>
                        </div>
                    </div>

                    {/* Quick Presets */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Quick Presets
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {presets.map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Background Picker */}
                    <BackgroundPicker
                        value={selectedBg}
                        onChange={setSelectedBg}
                        previewChildren={
                            <div className="text-center">
                                <div className="font-mono font-bold text-white text-2xl leading-none drop-shadow tabular-nums">
                                    {previewTime}
                                </div>
                                {title && (
                                    <div className="text-white/70 text-xs mt-1">{title}</div>
                                )}
                            </div>
                        }
                    />

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-2">
                        {!isInline && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            type="submit"
                            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg transition-all shadow-sm w-full"
                        >
                            <Plus className="w-4 h-4" />
                            {editingSlide ? 'UPDATE' : 'ADD COUNTDOWN'}
                        </button>
                    </div>
                </form>
            </div>
    )

    if (isInline) return content

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
            {content}
        </div>
    )
}

// Countdown Display Component
interface CountdownDisplayProps {
    data: CountdownData
    onComplete?: () => void
    className?: string
}

export function CountdownDisplay({ data, onComplete, className = '' }: CountdownDisplayProps) {
    const [timeLeft, setTimeLeft] = useState(
        data.hours * 3600 + data.minutes * 60 + data.seconds
    )
    const [isPaused, setIsPaused] = useState(false)
    const intervalRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        if (!isPaused && timeLeft > 0) {
            intervalRef.current = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(intervalRef.current!)
                        onComplete?.()
                        return 0
                    }
                    return prev - 1
                })
            }, 1000)
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
            }
        }
    }, [isPaused, timeLeft, onComplete])

    const hours = Math.floor(timeLeft / 3600)
    const minutes = Math.floor((timeLeft % 3600) / 60)
    const seconds = timeLeft % 60

    const formatNum = (n: number) => n.toString().padStart(2, '0')

    const reset = () => {
        setTimeLeft(data.hours * 3600 + data.minutes * 60 + data.seconds)
        setIsPaused(false)
    }

    return (
        <div className={`flex flex-col items-center ${className}`}>
            {data.title && (
                <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">{data.title}</p>
            )}
            <div className="text-6xl font-bold font-mono text-gray-900 dark:text-white">
                {hours > 0 && <span>{formatNum(hours)}:</span>}
                <span>{formatNum(minutes)}</span>
                <span>:</span>
                <span>{formatNum(seconds)}</span>
            </div>
            <div className="flex gap-2 mt-4">
                <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                    {isPaused ? (
                        <Play className="w-5 h-5" />
                    ) : (
                        <Pause className="w-5 h-5" />
                    )}
                </button>
                <button
                    onClick={reset}
                    className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                    <RotateCcw className="w-5 h-5" />
                </button>
            </div>
        </div>
    )
}
