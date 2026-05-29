import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { SermonListenerSettings } from '../SermonListenerSettings'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            settings: {
                sermonListener: {
                    autoLookup: true,
                    autoDisplay: false,
                    captureSource: 'microphone',
                    selectedMicrophoneId: '',
                    language: 'en-US',
                },
            },
            setAppSettings: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../../services/sermon-listener/nativeAudioCapture', () => ({
    useNativeAudioCapture: vi.fn(() => ({
        systemAudioSupported: false,
    })),
}))

vi.mock('../../../hooks/useAudioDevices', () => ({
    useAudioDevices: vi.fn(() => ({
        devices: [],
        isLoading: false,
        refresh: vi.fn(),
        resolvedDeviceId: '',
    })),
    saveSelectedDeviceLabel: vi.fn(),
}))

describe('SermonListenerSettings', () => {
    it('renders without crashing', () => {
        render(<SermonListenerSettings />)
    })
})
