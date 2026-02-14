import { useEffect, useCallback } from 'react'
import { useEmitter } from './useEmitter'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { appWideActions, type Slide, type Countdown } from '../types'

interface QuickActionHandlersResult {
    handleSlideEditorSave: (slide: Slide) => void
}

export function useQuickActionHandlers(): QuickActionHandlersResult {
    const { on } = useEmitter()
    const { createTextSlide, createCountdownSlide } = useSlideCreation()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const setActiveAlert = useAppStore((state) => state.setActiveAlert)

    // Modal actions from Zustand
    const openModal = useAppStore((state) => state.openModal)
    const closeModal = useAppStore((state) => state.closeModal)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const setQuickActionsPage = useAppStore((state) => state.setQuickActionsPage)
    const setDarkMode = useAppStore((state) => state.setDarkMode)

    const handleSlideEditorSave = useCallback((slide: Slide) => {
        appendActiveSlide(slide)
        closeModal('editor')
    }, [appendActiveSlide, closeModal])

    // Listen to quick action events
    useEffect(() => {
        const unsubs: Array<() => void> = []

        // Create Text Slide - open editor with new text slide
        unsubs.push(on(appWideActions.newSlide, () => {
            const newSlide = createTextSlide()
            setEditingSlide(newSlide)
            openModal('editor')
        }))

        // Open Settings Modal
        unsubs.push(on(appWideActions.openSettings, () => {
            openModal('settings')
        }))

        // Open Shortcuts Modal
        unsubs.push(on(appWideActions.openShortcutsModal, () => {
            openModal('shortcuts')
        }))

        // Toggle Dark Mode
        unsubs.push(on(appWideActions.toggleDarkMode, () => {
            setDarkMode(!document.documentElement.classList.contains('dark'))
        }))

        // Open Template Browser
        unsubs.push(on(appWideActions.newTemplates, () => {
            openModal('templateBrowser')
        }))

        // Open Media Picker
        unsubs.push(on(appWideActions.newMedia, (data) => {
            // Only open picker if not coming from saved items
            const slideData = data as Slide | undefined
            if (!slideData || !(slideData as { fromSaved?: boolean }).fromSaved) {
                openModal('mediaPicker')
            }
        }))

        // Open Alert Modal
        unsubs.push(on(appWideActions.newAlert, () => {
            openModal('alertModal')
        }))

        // Open Countdown Modal
        unsubs.push(on(appWideActions.newCountdown, () => {
            openModal('countdownModal')
        }))

        // Open Library Panel
        unsubs.push(on(appWideActions.newLibrary, () => {
            openModal('libraryPanel')
        }))

        // Open Schedule Modal (Create New Schedule)
        unsubs.push(on(appWideActions.openScheduleModal, () => {
            openModal('scheduleModal')
        }))

        // Open Invite Modal
        unsubs.push(on(appWideActions.openInviteModal, () => {
            // For now, just show an alert - implement invite modal later
            alert('Invite functionality coming soon!')
        }))

        // Remove Alert
        unsubs.push(on(appWideActions.removeAlert, () => {
            setActiveAlert(null)
        }))

        return () => unsubs.forEach((u) => u())
    }, [on, createTextSlide, openModal, closeModal, setEditingSlide, setQuickActionsPage, setDarkMode, setActiveAlert])

    return {
        handleSlideEditorSave,
    }
}
