import { useEffect, useCallback, useState } from 'react'
import { useEmitter } from './useEmitter'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { appWideActions, type Slide, type Countdown } from '../types'

interface ModalState {
    settings: boolean
    shortcuts: boolean
    editor: boolean
    mediaPicker: boolean
    templateBrowser: boolean
    alertModal: boolean
    countdownModal: boolean
    libraryPanel: boolean
    scheduleModal: boolean
}

interface QuickActionHandlersResult {
    modals: ModalState
    editingSlide: Slide | null
    openModal: (modal: keyof ModalState) => void
    closeModal: (modal: keyof ModalState) => void
    closeAllModals: () => void
    handleSlideEditorSave: (slide: Slide) => void
}

const initialModalState: ModalState = {
    settings: false,
    shortcuts: false,
    editor: false,
    mediaPicker: false,
    templateBrowser: false,
    alertModal: false,
    countdownModal: false,
    libraryPanel: false,
    scheduleModal: false,
}

export function useQuickActionHandlers(): QuickActionHandlersResult {
    const [modals, setModals] = useState<ModalState>(initialModalState)
    const [editingSlide, setEditingSlide] = useState<Slide | null>(null)

    const { on } = useEmitter()
    const { createTextSlide, createCountdownSlide } = useSlideCreation()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)

    const openModal = useCallback((modal: keyof ModalState) => {
        setModals((prev) => ({ ...prev, [modal]: true }))
    }, [])

    const closeModal = useCallback((modal: keyof ModalState) => {
        setModals((prev) => ({ ...prev, [modal]: false }))
        if (modal === 'editor') {
            setEditingSlide(null)
        }
    }, [])

    const closeAllModals = useCallback(() => {
        setModals(initialModalState)
        setEditingSlide(null)
    }, [])

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
            document.documentElement.classList.toggle('dark')
            // Persist preference
            const isDark = document.documentElement.classList.contains('dark')
            localStorage.setItem('theme', isDark ? 'dark' : 'light')
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
            useAppStore.getState().setActiveAlert(null)
        }))

        return () => unsubs.forEach((u) => u())
    }, [on, openModal, createTextSlide])

    return {
        modals,
        editingSlide,
        openModal,
        closeModal,
        closeAllModals,
        handleSlideEditorSave,
    }
}
