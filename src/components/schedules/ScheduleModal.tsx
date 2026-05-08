import { useState } from 'react'
import { X, Calendar, Plus, CalendarDays } from 'lucide-react'
import { useSchedules } from '../../hooks/useSchedules'

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

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                        <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        Create New Schedule
                    </h3>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Schedule Name Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Schedule Name
                        </label>
                        <input
                            type="text"
                            value={scheduleName}
                            onChange={(e) => setScheduleName(e.target.value)}
                            placeholder="Enter your schedule name"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            autoFocus
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Leave field blank to create schedule with name "{generateDefaultName()}"
                        </p>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={useDefaultName}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
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
            </div>
        </div>
    )
}