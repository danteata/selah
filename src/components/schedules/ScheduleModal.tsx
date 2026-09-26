import { useState } from 'react'
import { X, Calendar, Plus, CalendarDays } from 'lucide-react'
import { useSchedules } from '../../hooks/useSchedules'
import { Modal } from '../modals/Modal'

interface ScheduleModalProps {
    isOpen: boolean
    onClose: () => void
}

export function ScheduleModal({ isOpen, onClose }: ScheduleModalProps) {
    const [scheduleName, setScheduleName] = useState('')
    const { createSchedule } = useSchedules()

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const nameToUse = scheduleName.trim() || generateDefaultName()
        createSchedule(nameToUse)
        setScheduleName('')
        onClose()
    }

    // Generate default name based on current date
    const generateDefaultName = () => {
        const date = new Date()
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: '2-digit'
        }
        return `Schedule ${date.toLocaleDateString('en-GB', options)}`
    }

    const useDefaultName = () => {
        setScheduleName(generateDefaultName())
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            labelledBy="schedule-modal-title"
            className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <div className="p-2 bg-[var(--accent-teal)]/10 rounded-lg">
                    <Calendar className="w-5 h-5 text-[var(--accent-teal)]" />
                </div>
                <h3 id="schedule-modal-title" className="font-semibold text-[var(--text-primary)]">
                    Create New Schedule
                </h3>
                <button
                    aria-label="Close"
                    onClick={onClose}
                    className="ml-auto p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
                {/* Schedule Name Input */}
                <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                        Schedule Name
                    </label>
                    <input
                        type="text"
                        value={scheduleName}
                        onChange={(e) => setScheduleName(e.target.value)}
                        placeholder="Enter your schedule name"
                        className="w-full px-3 py-2 border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--accent-teal)] focus:border-transparent"
                        autoFocus
                    />
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Leave field blank to create schedule with name "{generateDefaultName()}"
                    </p>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={useDefaultName}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg hover:text-[var(--text-primary)] transition-colors"
                    >
                        <CalendarDays className="w-4 h-4" />
                        Use Date
                    </button>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Create Schedule
                    </button>
                </div>
            </form>
        </Modal>
    )
}