export interface GetUserMediaOptions {
    deviceId?: string
    constraints?: MediaTrackConstraints
}

export async function getMicrophoneStream(options: GetUserMediaOptions = {}): Promise<MediaStream> {
    const { deviceId, constraints = {} } = options

    const audioConstraints: MediaTrackConstraints | boolean = deviceId
        ? {
            ...constraints,
            deviceId: { exact: deviceId },
        }
        : {
            ...constraints,
        }

    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
}

export function buildAudioConstraints(opts: {
    deviceId?: string
    channelCount?: number
    noiseSuppression?: boolean
    echoCancellation?: boolean
    autoGainControl?: boolean
    sampleRate?: number
}): MediaTrackConstraints | boolean {
    const { deviceId, channelCount, noiseSuppression, echoCancellation, autoGainControl, sampleRate } = opts

    const constraints: MediaTrackConstraints = {}
    if (channelCount !== undefined) constraints.channelCount = channelCount
    if (noiseSuppression !== undefined) constraints.noiseSuppression = noiseSuppression
    if (echoCancellation !== undefined) constraints.echoCancellation = echoCancellation
    if (autoGainControl !== undefined) constraints.autoGainControl = autoGainControl
    if (sampleRate !== undefined) constraints.sampleRate = sampleRate

    if (deviceId) {
        constraints.deviceId = { exact: deviceId }
        return constraints
    }

    return Object.keys(constraints).length > 0 ? constraints : true
}