import { useState } from 'react'
import { X, Bell, Clock, AlertCircle, Plus } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { Alert } from '../../types'

interface AddAlertModalProps {
    isOpen: boolean
    onClose: () => void
}

export function AddAlertModal({ isOpen, onClose }: AddAlertModalProps) {
    const [content, setContent] = useState('')
    const [duration, setDuration] = useState(5)
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')

    const setAlerts = useAppStore((state) => state.setAlerts)
    const alerts = useAppStore((state) => state.alerts)

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!content.trim()) return

        const newAlert: Alert = {
            id: `alert_${Date.now()}`,
            content: content.trim(),
            duration,
            priority,
            createdAt: new Date().toISOString(),
        }

        setAlerts([...alerts, newAlert])
        setContent('')
        setDuration(5)
        setPriority('medium')
        onClose()
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
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                        <Bell className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        Create Alert
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
                    {/* Content */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Alert Message
                        </label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Enter your announcement..."
                            rows={3}
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                        />
                    </div>

                    {/* Duration */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Display Duration
                        </label>
                        <div className="flex gap-2">
                            {[3, 5, 10, 15, 30].map((d) => (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => setDuration(d)}
                                    className={`flex-1 py-2 text-sm rounded-lg transition-colors ${duration === d
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    {d}s
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Priority */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Priority
                        </label>
                        <div className="flex gap-2">
                            {[
                                { id: 'low', label: 'Low', color: 'bg-green-500' },
                                { id: 'medium', label: 'Medium', color: 'bg-yellow-500' },
                                { id: 'high', label: 'High', color: 'bg-red-500' },
                            ].map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPriority(p.id as 'low' | 'medium' | 'high')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg transition-colors ${priority === p.id
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${p.color}`} />
                                    {p.label}
                                </button>
                            ))}
                        </div>
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
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Create Alert
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
