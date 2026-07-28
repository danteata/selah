import { useEffect, useCallback } from 'react'
import { useEmitter } from './useEmitter'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { appWideActions, type Slide, type Countdown } from '../types'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'

interface QuickActionHandlersResult {
    handleSlideEditorSave: (slide: Slide) => void
}

export function useQuickActionHandlers(): QuickActionHandlersResult {
    const { on } = useEmitter()
    const { createTextSlide, createCountdownSlide, createLowerThirdSlide } = useSlideCreation()
    const { trackEvent } = useAnalytics()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const updateActiveSlide = useAppStore((state) => state.updateActiveSlide)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const setActiveAlert = useAppStore((state) => state.setActiveAlert)

    // Modal actions from Zustand
    const openModal = useAppStore((state) => state.openModal)
    const closeModal = useAppStore((state) => state.closeModal)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const setQuickActionsPage = useAppStore((state) => state.setQuickActionsPage)
    const setDarkMode = useAppStore((state) => state.setDarkMode)

    const handleSlideEditorSave = useCallback((slide: Slide) => {
        const exists = activeSlides.find((s) => s.id === slide.id)
        if (exists) {
            updateActiveSlide(slide)
            trackEvent(AnalyticsEventType.SLIDE_EDITED, {
                slide_type: slide.type || 'unknown',
                source: 'slide_editor',
            })
        } else {
            appendActiveSlide(slide)
        }
        closeModal('editor')
    }, [activeSlides, appendActiveSlide, updateActiveSlide, closeModal, trackEvent])

    // Listen to quick action events
    useEffect(() => {
        const unsubs: Array<() => void> = []

        // Create Text Slide - open editor with new text slide
        unsubs.push(on(appWideActions.newSlide, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newSlide' })
            const newSlide = createTextSlide()
            setEditingSlide(newSlide)
            openModal('editor')
        }))

        // Open Settings Modal
        unsubs.push(on(appWideActions.openSettings, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'openSettings' })
            openModal('settings')
        }))

        // Open Shortcuts Modal
        unsubs.push(on(appWideActions.openShortcutsModal, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'openShortcutsModal' })
            openModal('shortcuts')
        }))

        // Toggle Dark Mode
        unsubs.push(on(appWideActions.toggleDarkMode, () => {
            // Read the next value off the store, not the document: the class is
            // a view of this state, and reading it back made the DOM the source
            // of truth for a decision the store owns.
            const nextIsDark = !useAppStore.getState().isDarkMode
            trackEvent(AnalyticsEventType.THEME_CHANGED, { theme: nextIsDark ? 'dark' : 'light' })
            setDarkMode(nextIsDark)
        }))

        // Open Template Browser
        unsubs.push(on(appWideActions.newTemplates, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newTemplates' })
            openModal('templateBrowser')
        }))

        // Open Media Picker
        unsubs.push(on(appWideActions.newMedia, (data) => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newMedia' })
            // Only open picker if not coming from saved items
            const slideData = data as Slide | undefined
            if (!slideData || !(slideData as { fromSaved?: boolean }).fromSaved) {
                openModal('mediaPicker')
            }
        }))

        // Open YouTube/Vimeo Video Modal — reuses `quickActionsPage` purely as
        // a "which platform" flag for the modal, distinct from its sidebar
        // sub-page meaning elsewhere.
        unsubs.push(on(appWideActions.newYouTubeVideo, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newYouTubeVideo' })
            setQuickActionsPage('youtube')
            openModal('externalVideo')
        }))
        unsubs.push(on(appWideActions.newVimeoVideo, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newVimeoVideo' })
            setQuickActionsPage('vimeo')
            openModal('externalVideo')
        }))

        // Open Alert Modal
        unsubs.push(on(appWideActions.newAlert, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newAlert' })
            openModal('alertModal')
        }))

        // Open Countdown Modal
        unsubs.push(on(appWideActions.newCountdown, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newCountdown' })
            openModal('countdownModal')
        }))

        // Open Library Panel
        unsubs.push(on(appWideActions.newLibrary, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newLibrary' })
            openModal('libraryPanel')
        }))

        // Open Schedule Modal (Create New Schedule)
        unsubs.push(on(appWideActions.openScheduleModal, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'openScheduleModal' })
            openModal('scheduleModal')
        }))

        // Open Invite Modal
        unsubs.push(on(appWideActions.openInviteModal, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'openInviteModal' })
            // For now, just show an alert - implement invite modal later
            alert('Invite functionality coming soon!')
        }))

        // Remove Alert
        unsubs.push(on(appWideActions.removeAlert, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'removeAlert' })
            setActiveAlert(null)
        }))

        // Create Lower Third Slide - open editor with new lower third slide
        unsubs.push(on(appWideActions.newLowerThird, () => {
            trackEvent(AnalyticsEventType.QUICK_ACTION_USED, { action: 'newLowerThird' })
            const newSlide = createLowerThirdSlide()
            setEditingSlide(newSlide)
            openModal('lowerThirdEditor')
        }))

        return () => unsubs.forEach((u) => u())
    }, [on, createTextSlide, createLowerThirdSlide, openModal, closeModal, setEditingSlide, setQuickActionsPage, setDarkMode, setActiveAlert, trackEvent])

    return {
        handleSlideEditorSave,
    }
}
