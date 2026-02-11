import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { Church } from '../types'

export function useChurch() {
    const setActiveSchedule = useAppStore((state) => state.setActiveSchedule)
    const activeSchedule = useAppStore((state) => state.activeSchedule)

    // Set active church/schedule
    const setChurch = useCallback((church: Church | null) => {
        if (church) {
            // When setting a church, also set its default schedule if available
            setActiveSchedule({
                _id: church._id,
                name: church.name,
                authorId: '',
                editorIds: [],
                churchId: church._id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })
        } else {
            setActiveSchedule(null)
        }
    }, [setActiveSchedule])

    // Get current church from active schedule
    const getCurrentChurch = useCallback((): Church | null => {
        if (!activeSchedule) return null

        return {
            _id: activeSchedule.churchId,
            name: activeSchedule.name,
            type: 'church',
            address: '',
            pastor: '',
            users: [],
            subscriptionPlan: 'free',
        }
    }, [activeSchedule])

    return {
        setChurch,
        getCurrentChurch,
        currentChurch: getCurrentChurch(),
    }
}
