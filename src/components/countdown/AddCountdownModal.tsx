import { useState } from 'react'
import { X, Clock, Plus } from 'lucide-react'
import { BackgroundPicker, type BackgroundSelection } from '../utils/BackgroundPicker'
import type { Slide } from '../../types'
import { Modal } from '../modals/Modal'

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
    localFilePath?: string
    localMediaId?: string
}

const DEFAULT_BG: BackgroundSelection = {
    label: 'Midnight',
    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
    backgroundType: 'gradient',
}

interface CountdownForm {
    hours: number
    minutes: number
    seconds: number
    title: string
    background: BackgroundSelection
}

const NEW_COUNTDOWN: CountdownForm = { hours: 0, minutes: 5, seconds: 0, title: '', background: DEFAULT_BG }

/** The form for a slide being edited, or a fresh one. */
function formFromSlide(slide: Slide | null | undefined): CountdownForm {
    if (!slide || slide.type !== 'countdown') return NEW_COUNTDOWN
    // contents[1] is "HH:MM:SS" or "MM:SS"; contents[0] is the title as HTML.
    const parts = (slide.contents?.[1] || '00:05:00').split(':').map(Number)
    const [hours, minutes, seconds] =
        parts.length === 3 ? parts : parts.length === 2 ? [0, ...parts] : [0, 5, 0]
    return {
        hours: hours || 0,
        minutes: minutes || 0,
        seconds: seconds || 0,
        title: (slide.contents?.[0] || '').replace(/<[^>]*>/g, '').trim(),
        background: slide.background
            ? {
                background: slide.background,
                backgroundType: slide.backgroundType || 'gradient',
                backgroundStorageId: slide.backgroundStorageId,
                localFilePath: slide.localFilePath,
                localMediaId: slide.localMediaId,
            }
            : DEFAULT_BG,
    }
}

export function AddCountdownModal({ isOpen = true, onClose, onAdd, editingSlide, isInline = false }: AddCountdownModalProps) {
    const [form, setForm] = useState(() => formFromSlide(editingSlide))
    const { hours, minutes, seconds, title, background: selectedBg } = form
    const update = (patch: Partial<CountdownForm>) => setForm((prev) => ({ ...prev, ...patch }))
    const setHours = (h: number) => update({ hours: h })
    const setMinutes = (m: number) => update({ minutes: m })
    const setSeconds = (sec: number) => update({ seconds: sec })
    const setTitle = (t: string) => update({ title: t })
    const setSelectedBg = (bg: BackgroundSelection) => update({ background: bg })

    // Refill the form when another slide is opened for editing, or the modal
    // reopens (adjusted during render, so it never shows the old values).
    const [formFor, setFormFor] = useState({ editingSlide, isOpen, isInline })
    if (formFor.editingSlide !== editingSlide || formFor.isOpen !== isOpen || formFor.isInline !== isInline) {
        setFormFor({ editingSlide, isOpen, isInline })
        setForm(formFromSlide(editingSlide))
    }

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
            localFilePath: selectedBg.localFilePath,
            localMediaId: selectedBg.localMediaId,
        })

        if (!isInline) {
            setForm(NEW_COUNTDOWN)
            onClose?.()
        }
    }

    const applyPreset = (preset: { h: number; m: number; s: number }) => {
        update({ hours: preset.h, minutes: preset.m, seconds: preset.s })
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
                    <h3 id="countdown-modal-title" className="font-semibold text-gray-900 dark:text-white">
                        {editingSlide ? 'Edit Countdown' : 'Add Countdown'}
                    </h3>
                    <button
                        aria-label="Close"
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
                        <div className="flex gap-2 sm:gap-4 justify-center">
                            <div className="text-center flex-1 min-w-0 max-w-20">
                                <input
                                    type="number"
                                    value={hours}
                                    onChange={(e) => setHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="23"
                                    className="w-full px-1 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hours</p>
                            </div>
                            <span className="text-3xl font-bold text-gray-400 self-center pb-5">:</span>
                            <div className="text-center flex-1 min-w-0 max-w-20">
                                <input
                                    type="number"
                                    value={minutes}
                                    onChange={(e) => setMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="59"
                                    className="w-full px-1 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minutes</p>
                            </div>
                            <span className="text-3xl font-bold text-gray-400 self-center pb-5">:</span>
                            <div className="text-center flex-1 min-w-0 max-w-20">
                                <input
                                    type="number"
                                    value={seconds}
                                    onChange={(e) => setSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                                    min="0"
                                    max="59"
                                    className="w-full px-1 py-4 text-center text-3xl font-bold border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
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
        <Modal
            isOpen={isOpen}
            onClose={() => onClose?.()}
            labelledBy="countdown-modal-title"
            className="w-full max-w-md"
        >
            {content}
        </Modal>
    )
}
