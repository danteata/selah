import { useState, useEffect } from 'react'
import { Calendar, Plus, ChevronDown, Trash2, Edit, Check, Loader2 } from 'lucide-react'
import { useSchedules } from '../../hooks/useSchedules'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import { useConfirmDialog } from '../modals/ConfirmDialog'
import type { Schedule } from '../../types'

export function ScheduleSelector() {
    const [isOpen, setIsOpen] = useState(false)
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [newScheduleName, setNewScheduleName] = useState('')
    const [isEditing, setIsEditing] = useState<string | null>(null)
    const [editName, setEditName] = useState('')

    const {
        schedules,
        activeSchedule,
        setActiveSchedule,
        createSchedule,
        deleteSchedule,
        updateSchedule,
        isLoading,
    } = useSchedules()
    const { trackEvent } = useAnalytics()
    const { confirm, ConfirmDialog } = useConfirmDialog()

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest('.schedule-selector')) {
                setIsOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleCreateSchedule = () => {
        if (newScheduleName.trim()) {
            createSchedule(newScheduleName.trim())
            trackEvent(AnalyticsEventType.SCHEDULE_CREATED, {
                name: newScheduleName.trim(),
            })
            setNewScheduleName('')
            setShowCreateForm(false)
            setIsOpen(false)
        }
    }

    const handleSelectSchedule = (schedule: Schedule) => {
        setActiveSchedule(schedule)
        trackEvent(AnalyticsEventType.SCHEDULE_VIEWED, {
            schedule_id: schedule._id,
            name: schedule.name,
        })
        setIsOpen(false)
    }

    const handleDeleteSchedule = async (schedule: Schedule) => {
        const confirmed = await confirm({
            title: 'Delete Schedule',
            message: `Are you sure you want to delete "${schedule.name}"? This will also delete all slides in this schedule.`,
            type: 'danger',
            confirmText: 'Delete',
        })

        if (confirmed) {
            deleteSchedule(schedule._id)
            if (activeSchedule?._id === schedule._id) {
                setActiveSchedule(null)
            }
        }
    }

    const handleStartEdit = (schedule: Schedule) => {
        setIsEditing(schedule._id)
        setEditName(schedule.name)
    }

    const handleSaveEdit = (scheduleId: string) => {
        if (editName.trim()) {
            updateSchedule(scheduleId, { name: editName.trim() })
            trackEvent(AnalyticsEventType.SCHEDULE_EDITED, {
                schedule_id: scheduleId,
                new_name: editName.trim(),
            })
        }
        setIsEditing(null)
    }

    return (
        <>
            <div className="schedule-selector relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                    <Calendar className="w-4 h-4" />
                    <span className="max-w-[150px] truncate">
                        {activeSchedule?.name || 'Select Schedule'}
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800 z-50">
                        {/* Header */}
                        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-800">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Schedules
                            </span>
                            <button
                                onClick={() => setShowCreateForm(true)}
                                className="p-1 text-primary-600 hover:text-primary-700 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20"
                                title="Create new schedule"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Create form */}
                        {showCreateForm && (
                            <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newScheduleName}
                                        onChange={(e) => setNewScheduleName(e.target.value)}
                                        placeholder="Schedule name..."
                                        className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateSchedule()
                                            if (e.key === 'Escape') setShowCreateForm(false)
                                        }}
                                    />
                                    <button
                                        onClick={handleCreateSchedule}
                                        disabled={!newScheduleName.trim()}
                                        className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Schedule list */}
                        <div className="max-h-64 overflow-y-auto">
                            {isLoading ? (
                                <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading...
                                </div>
                            ) : schedules.length === 0 ? (
                                <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                                    No schedules yet
                                </div>
                            ) : (
                                schedules.map((schedule) => (
                                    <div
                                        key={schedule._id}
                                        className={`flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${activeSchedule?._id === schedule._id
                                                ? 'bg-primary-50 dark:bg-primary-900/20'
                                                : ''
                                            }`}
                                    >
                                        {isEditing === schedule._id ? (
                                            <>
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveEdit(schedule._id)
                                                        if (e.key === 'Escape') setIsEditing(null)
                                                    }}
                                                />
                                                <button
                                                    onClick={() => handleSaveEdit(schedule._id)}
                                                    className="p-1 text-green-600 hover:text-green-700"
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleSelectSchedule(schedule)}
                                                    className="flex-1 text-left text-sm text-gray-700 dark:text-gray-300 truncate"
                                                >
                                                    {schedule.name}
                                                </button>
                                                <button
                                                    onClick={() => handleStartEdit(schedule)}
                                                    className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                                                    title="Edit"
                                                >
                                                    <Edit className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteSchedule(schedule)}
                                                    className="p-1 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
            <ConfirmDialog />
        </>
    )
}
