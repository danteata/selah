import { useState, useEffect, useCallback, useRef } from 'react'
import { isDesktop } from '../platform'
import { listAudioDevices, type AudioDeviceInfo, isTauriAvailable } from '../services/sermon-listener/nativeAudioCapture'

export interface AudioInputDevice {
    id: string
    label: string
    isDefault: boolean
    /** Native device name for Tauri audio capture (different from browser deviceId) */
    nativeName?: string
}

const DEVICE_LABEL_STORAGE_KEY = 'sermon-listener:selected-mic-label'

/**
 * Save the selected device by label (not deviceId, which is ephemeral).
 * Browser deviceIds reset on origin change; labels persist.
 */
export function saveSelectedDeviceLabel(label: string | null): void {
    if (typeof window === 'undefined') return
    try {
        if (label) {
            localStorage.setItem(DEVICE_LABEL_STORAGE_KEY, label)
        } else {
            localStorage.removeItem(DEVICE_LABEL_STORAGE_KEY)
        }
    } catch {
        // localStorage unavailable — non-critical
    }
}

/**
 * Resolve a previously saved device label to a current deviceId.
 * Returns the deviceId if found, or null to fall back to system default.
 */
export function resolveSavedDevice(devices: AudioInputDevice[]): string | null {
    if (typeof window === 'undefined') return null
    try {
        const savedLabel = localStorage.getItem(DEVICE_LABEL_STORAGE_KEY)
        if (!savedLabel) return null

        // Try exact match first, then substring match
        const exactMatch = devices.find(d => d.label === savedLabel)
        if (exactMatch) return exactMatch.id

        const partialMatch = devices.find(d =>
            d.label.includes(savedLabel) || savedLabel.includes(d.label)
        )
        if (partialMatch) return partialMatch.id

        // No match found — device was unplugged or renamed
        console.warn(`[useAudioDevices] Saved device "${savedLabel}" not found, falling back to default`)
        return null
    } catch {
        return null
    }
}

export function useAudioDevices() {
    const [devices, setDevices] = useState<AudioInputDevice[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [resolvedDeviceId, setResolvedDeviceId] = useState<string | null>(null)

    const enumerateBrowserDevices = useCallback(async (): Promise<AudioInputDevice[]> => {
        if (!navigator.mediaDevices?.enumerateDevices) return []

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach(t => t.stop())

            const allDevices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = allDevices.filter(d => d.kind === 'audioinput')

            return audioInputs.map(d => ({
                id: d.deviceId,
                label: d.label || `Microphone (${d.deviceId.slice(0, 8)})`,
                isDefault: d.deviceId === 'default',
            }))
        } catch {
            return []
        }
    }, [])

    const enumerateNativeDevices = useCallback(async (): Promise<AudioDeviceInfo[]> => {
        if (!isTauriAvailable()) return []

        try {
            return await listAudioDevices()
        } catch {
            return []
        }
    }, [])

    const refresh = useCallback(async () => {
        setIsLoading(true)
        setError(null)

        try {
            let browserDevices: AudioInputDevice[] = []

            if (isDesktop()) {
                const native = await enumerateNativeDevices()
                browserDevices = await enumerateBrowserDevices()

                if (native.length > 0 && browserDevices.length > 0) {
                    // Merge: use browser deviceId (for getUserMedia) but prefer native labels.
                    // Match by label substring since native names are often longer.
                    const nativeInputs = native.filter(d => d.device_type === 'Input')
                    browserDevices = browserDevices.map(bd => {
                        const nativeMatch = nativeInputs.find(nd =>
                            bd.label.includes(nd.name) || nd.name.includes(bd.label)
                        )
                        if (nativeMatch) {
                            return {
                                ...bd,
                                label: nativeMatch.name,
                                nativeName: nativeMatch.name,
                                isDefault: nativeMatch.is_default,
                            }
                        }
                        return bd
                    })
                }
                // If browser enumeration failed but native succeeded, use native names as IDs
                // (these only work for Tauri audio capture, not getUserMedia)
                if (browserDevices.length === 0 && native.length > 0) {
                    browserDevices = native
                        .filter(d => d.device_type === 'Input')
                        .map(d => ({
                            id: d.name,
                            label: d.name,
                            isDefault: d.is_default,
                            nativeName: d.name,
                        }))
                }
            } else {
                browserDevices = await enumerateBrowserDevices()
            }

            setDevices(browserDevices)

            // Resolve saved device label to current deviceId
            const resolved = resolveSavedDevice(browserDevices)
            setResolvedDeviceId(resolved)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to enumerate devices')
            setDevices([])
        } finally {
            setIsLoading(false)
        }
    }, [enumerateBrowserDevices, enumerateNativeDevices])

    useEffect(() => {
        refresh()
    }, [refresh])

    useEffect(() => {
        if (!navigator.mediaDevices) return
        const handler = () => refresh()
        navigator.mediaDevices.addEventListener('devicechange', handler)
        return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
    }, [refresh])

    return { devices, isLoading, error, refresh, resolvedDeviceId }
}