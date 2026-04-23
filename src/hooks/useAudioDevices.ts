import { useState, useEffect, useCallback } from 'react'
import { isDesktop } from '../platform'
import { listAudioDevices, type AudioDeviceInfo, isTauriAvailable } from '../services/sermon-listener/nativeAudioCapture'

export interface AudioInputDevice {
    id: string
    label: string
    isDefault: boolean
}

export function useAudioDevices() {
    const [devices, setDevices] = useState<AudioInputDevice[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

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

    const enumerateNativeDevices = useCallback(async (): Promise<AudioInputDevice[]> => {
        if (!isTauriAvailable()) return []

        try {
            const nativeDevices = await listAudioDevices()
            return nativeDevices
                .filter(d => d.device_type === 'Input')
                .map(d => ({
                    id: d.name,
                    label: d.name,
                    isDefault: d.is_default,
                }))
        } catch {
            return []
        }
    }, [])

    const refresh = useCallback(async () => {
        setIsLoading(true)
        setError(null)

        try {
            let deviceList: AudioInputDevice[]

            if (isDesktop()) {
                const native = await enumerateNativeDevices()
                const browser = await enumerateBrowserDevices()
                deviceList = native.length > 0 ? native : browser
            } else {
                deviceList = await enumerateBrowserDevices()
            }

            setDevices(deviceList)
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

    return { devices, isLoading, error, refresh }
}