import { useState, useEffect } from 'react'
import { Mic, Check, Volume2, ArrowRight } from 'lucide-react'
import { isDesktop } from '../../platform'
import { useAudioDevices } from '../../hooks/useAudioDevices'
import { useAppStore } from '../../store/appStore'

interface FirstRunWizardProps {
    onComplete: () => void
}

const WIZARD_COMPLETED_KEY = 'selah-sermon-listener-wizard-completed'

export function isSermonListenerWizardComplete(): boolean {
    try {
        return localStorage.getItem(WIZARD_COMPLETED_KEY) === 'true'
    } catch {
        return false
    }
}

export function SermonListenerWizard({ onComplete }: FirstRunWizardProps) {
    const [step, setStep] = useState(0)
    const [micLevel, setMicLevel] = useState(0)
    const settings = useAppStore((s) => s.settings)
    const setAppSettings = useAppStore((s) => s.setAppSettings)
    const { devices: micDevices, isLoading: isLoadingDevices, refresh: refreshDevices } = useAudioDevices()
    const [selectedMicId, setSelectedMicId] = useState(settings.sermonListener?.selectedMicrophoneId || '')

    const steps = ['Choose Input', 'Test Audio', 'Ready']

    // Test mic on the Test Audio step
    useEffect(() => {
        if (step !== 1) return

        let cancelled = false
        let analyser: AnalyserNode | null = null
        let audioContext: AudioContext | null = null
        let animationId: number
        let stream: MediaStream | null = null

        async function startMicTest() {
            try {
                const constraints = selectedMicId
                    ? { deviceId: { exact: selectedMicId }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true } }
                    : true
                stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
                audioContext = new AudioContext()
                const source = audioContext.createMediaStreamSource(stream)
                analyser = audioContext.createAnalyser()
                analyser.fftSize = 256
                source.connect(analyser)
                const dataArray = new Uint8Array(analyser.frequencyBinCount)

                function update() {
                    if (cancelled) return
                    analyser!.getByteFrequencyData(dataArray)
                    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255
                    setMicLevel(avg)
                    animationId = requestAnimationFrame(update)
                }
                update()
            } catch {
                // Mic permission denied
            }
        }
        startMicTest()

        return () => {
            cancelled = true
            cancelAnimationFrame(animationId)
            analyser?.disconnect()
            audioContext?.close()
            stream?.getTracks().forEach(t => t.stop())
        }
    }, [step, selectedMicId])

    const handleComplete = () => {
        try { localStorage.setItem(WIZARD_COMPLETED_KEY, 'true') } catch {}
        setAppSettings({
            ...settings,
            sermonListener: {
                ...settings.sermonListener,
                selectedMicrophoneId: selectedMicId || undefined,
            },
        })
        onComplete()
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6 mx-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Set Up Sermon Listener
                    </h2>
                    <span className="text-xs text-gray-500">{step + 1}/{steps.length}</span>
                </div>

                {/* Progress dots */}
                <div className="flex items-center gap-1.5 mb-6">
                    {steps.map((_, i) => (
                        <div
                            key={i}
                            className={`h-1.5 rounded-full transition-all ${
                                i <= step ? 'bg-[var(--accent-teal)] w-6' : 'bg-gray-200 dark:bg-gray-700 w-1.5'
                            }`}
                        />
                    ))}
                </div>

                {step === 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                            <Mic className="w-5 h-5 text-blue-500 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">Select your microphone</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Choose the microphone you'll use for sermon listening.
                                </p>
                            </div>
                        </div>

                        <div className="relative">
                            <select
                                value={selectedMicId}
                                onChange={(e) => setSelectedMicId(e.target.value)}
                                disabled={isLoadingDevices}
                                className="w-full p-2 pr-8 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white appearance-none text-sm"
                            >
                                <option value="">Default microphone</option>
                                {micDevices.map((device) => (
                                    <option key={device.id} value={device.id}>
                                        {device.label}{device.isDefault ? ' (Default)' : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={refreshDevices}
                                disabled={isLoadingDevices}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                title="Refresh devices"
                            >
                                <Mic className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {isDesktop() ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Selah uses built-in transcription — no internet required.
                            </p>
                        ) : (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Selah uses the browser&apos;s built-in speech recognition. For best results, use Chrome.
                            </p>
                        )}
                    </div>
                )}

                {step === 1 && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                            <Volume2 className="w-5 h-5 text-green-500" />
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">Test your microphone</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Speak to verify audio input is working.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 rounded-full transition-all duration-100"
                                    style={{ width: `${Math.min(micLevel * 300, 100)}%` }}
                                />
                            </div>
                            <span className="text-xs text-gray-500">{micLevel > 0.01 ? 'Audio OK' : 'No input'}</span>
                        </div>
                        {!selectedMicId && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
                                Using default microphone. You can change this in Settings.
                            </p>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                            <Check className="w-5 h-5 text-emerald-500" />
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">You&apos;re all set!</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Press <strong>Start</strong> to begin listening for sermon verses.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-end mt-6 gap-2">
                    <button
                        onClick={handleComplete}
                        className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        Skip
                    </button>
                    {step < steps.length - 1 ? (
                        <button
                            onClick={() => setStep(s => s + 1)}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all"
                        >
                            Next
                            <ArrowRight className="w-3 h-3" />
                        </button>
                    ) : (
                        <button
                            onClick={handleComplete}
                            className="px-4 py-1.5 text-xs font-medium bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all"
                        >
                            Start Listening
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}