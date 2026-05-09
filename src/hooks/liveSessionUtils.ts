export function canClientPushLiveSlide(params: {
    isConnected: boolean
    isOffline: boolean
    isOperator: boolean
    isOpenMode: boolean
}) {
    if (!params.isConnected || params.isOffline) return false
    return params.isOperator || params.isOpenMode
}

interface SessionLike {
    _id: string
    scheduleId: string
}

export function selectDiscoveredSession<T extends SessionLike>(params: {
    activeSessionId?: string | null
    activeScheduleId?: string | null
    sessionsByChurch?: T[] | null
}): T | null {
    const { activeSessionId, activeScheduleId, sessionsByChurch } = params
    if (activeSessionId) return null
    if (!sessionsByChurch || sessionsByChurch.length === 0) return null

    if (activeScheduleId) {
        const bySchedule = sessionsByChurch.find((s) => s.scheduleId === activeScheduleId)
        if (bySchedule) return bySchedule
    }

    if (sessionsByChurch.length === 1) {
        return sessionsByChurch[0]
    }

    return null
}
