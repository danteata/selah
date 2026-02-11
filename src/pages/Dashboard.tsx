import { useUser, useClerk } from '@clerk/clerk-react'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { QuickActions, PreviewContent, LiveOutput } from '../components'
import { useKeyboardShortcuts, initGlobalEmitter, useQuickActionHandlers } from '../hooks'
import { SettingsModal } from '../components/settings/SettingsModal'
import { ShortcutsModal } from '../components/modals/ShortcutsModal'
import { SlideEditor } from '../components/editor/SlideEditor'
import { MediaPicker } from '../components/media/MediaPicker'
import { TemplateBrowser } from '../components/templates/TemplateBrowser'
import { AddAlertModal } from '../components/alerts/AddAlertModal'
import { AddCountdownModal, type CountdownData } from '../components/countdown/AddCountdownModal'
import { LibraryPanel } from '../components/library/LibraryPanel'
import { ScheduleModal } from '../components/schedules/ScheduleModal'
import type { Slide } from '../types'

export default function Dashboard() {
    const { user: clerkUser } = useClerk()
    const { signOut } = useClerk()

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const undo = useAppStore((state) => state.undo)
    const redo = useAppStore((state) => state.redo)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)

    const [isDark, setIsDark] = useState(() => {
        if (typeof window === 'undefined') return false
        return document.documentElement.classList.contains('dark')
    })

    const toggleTheme = () => {
        const newIsDark = !isDark
        setIsDark(newIsDark)
        if (newIsDark) {
            document.documentElement.classList.add('dark')
            localStorage.setItem('theme', 'dark')
        } else {
            document.documentElement.classList.remove('dark')
            localStorage.setItem('theme', 'light')
        }
    }

    // Initialize global emitter
    useEffect(() => {
        initGlobalEmitter()
    }, [])

    // Initialize theme from localStorage
    useEffect(() => {
        const savedTheme = localStorage.getItem('theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [])

    // Quick action handlers manage modal state
    const {
        modals,
        editingSlide,
        closeModal,
        handleSlideEditorSave,
    } = useQuickActionHandlers()

    // Global keyboard shortcuts
    useKeyboardShortcuts([
        { key: 'z', callback: undo, options: { ctrlOrMeta: true } },
        { key: 'y', callback: redo, options: { ctrlOrMeta: true } },
    ])

    // Handle media selection
    const handleMediaSelect = (media: { id: string; url: string; name: string }) => {
        // Create a media slide from selected media
        const slide: Slide = {
            id: `slide_${Date.now()}`,
            index: 0,
            name: media.name,
            type: 'media',
            layout: 'empty',
            contents: [],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            background: media.url,
            backgroundType: 'image',
        }
        appendActiveSlide(slide)
        closeModal('mediaPicker')
    }

    // Handle template selection
    const handleTemplateSelect = (template: { id: string; name: string; background: string }) => {
        const slide: Slide = {
            id: `slide_${Date.now()}`,
            index: 0,
            name: template.name,
            type: 'text',
            layout: 'full-text',
            contents: ['Your content here'],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            background: template.background,
            backgroundType: 'gradient',
        }
        appendActiveSlide(slide)
        closeModal('templateBrowser')
    }

    // Handle countdown creation - convert CountdownData to Countdown slide
    const handleCountdownCreate = (countdownData: CountdownData) => {
        const totalSeconds = countdownData.hours * 3600 + countdownData.minutes * 60 + countdownData.seconds
        const timeString = `${String(countdownData.hours).padStart(2, '0')}:${String(countdownData.minutes).padStart(2, '0')}:${String(countdownData.seconds).padStart(2, '0')}`

        const slide: Slide = {
            id: `slide_${Date.now()}`,
            index: 0,
            name: `Countdown: ${countdownData.title}`,
            type: 'countdown',
            layout: 'countdown',
            contents: [countdownData.title, timeString],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            data: {
                id: countdownData.id,
                time: timeString,
                timeLeft: timeString,
                content: countdownData.title,
            },
        }
        appendActiveSlide(slide)
        closeModal('countdownModal')
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
            {/* Header */}
            <header className="bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-800">
                <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center gap-4">
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                                Cloud of Worship
                            </h1>
                            {activeSchedule && (
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                    {activeSchedule.name}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Theme Toggle */}
                            <button
                                onClick={toggleTheme}
                                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                            >
                                {isDark ? (
                                    <Sun className="w-5 h-5" />
                                ) : (
                                    <Moon className="w-5 h-5" />
                                )}
                            </button>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                {clerkUser?.firstName || clerkUser?.username || 'User'}
                            </span>
                            <button
                                onClick={() => signOut()}
                                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-[1800px] mx-auto p-4 sm:p-6 lg:p-8">
                <div className="flex gap-6 h-[calc(100vh-8rem)]">
                    {/* Quick Actions */}
                    <div className="flex-shrink-0">
                        <QuickActions />
                    </div>

                    {/* Preview Content */}
                    <div className="flex-1 min-w-0">
                        <PreviewContent />
                    </div>

                    {/* Live Output */}
                    <div className="flex-shrink-0">
                        <LiveOutput />
                    </div>
                </div>
            </main>

            {/* Modals */}
            {modals.settings && (
                <SettingsModal
                    isOpen={modals.settings}
                    onClose={() => closeModal('settings')}
                />
            )}

            {modals.shortcuts && (
                <ShortcutsModal
                    isOpen={modals.shortcuts}
                    onClose={() => closeModal('shortcuts')}
                />
            )}

            {modals.editor && editingSlide && (
                <SlideEditor
                    slide={editingSlide}
                    isOpen={modals.editor}
                    onClose={() => closeModal('editor')}
                    onSave={handleSlideEditorSave}
                />
            )}

            {modals.mediaPicker && (
                <MediaPicker
                    isOpen={modals.mediaPicker}
                    onClose={() => closeModal('mediaPicker')}
                    onSelect={handleMediaSelect}
                />
            )}

            {modals.templateBrowser && (
                <TemplateBrowser
                    isOpen={modals.templateBrowser}
                    onClose={() => closeModal('templateBrowser')}
                    onSelect={handleTemplateSelect}
                />
            )}

            {/* AddAlertModal handles its own alerts via store internally */}
            {modals.alertModal && (
                <AddAlertModal
                    isOpen={modals.alertModal}
                    onClose={() => closeModal('alertModal')}
                />
            )}

            {modals.countdownModal && (
                <AddCountdownModal
                    isOpen={modals.countdownModal}
                    onClose={() => closeModal('countdownModal')}
                    onAdd={handleCountdownCreate}
                />
            )}

            {/* LibraryPanel handles its own slide usage via useSlide internally */}
            {modals.libraryPanel && (
                <LibraryPanel
                    isOpen={modals.libraryPanel}
                    onClose={() => closeModal('libraryPanel')}
                />
            )}

            {/* Schedule Modal for creating new schedules */}
            {modals.scheduleModal && (
                <ScheduleModal
                    isOpen={modals.scheduleModal}
                    onClose={() => closeModal('scheduleModal')}
                />
            )}
        </div>
    )
}
