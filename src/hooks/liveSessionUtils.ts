export function canClientPushLiveSlide(params: {
    isConnected: boolean
    isOffline: boolean
    isOperator: boolean
    isOpenMode: boolean
}) {
    if (!params.isConnected || params.isOffline) return false
    return params.isOperator || params.isOpenMode
}
