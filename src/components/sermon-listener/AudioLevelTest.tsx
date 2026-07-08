import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

/**
 * Self-contained microphone signal test. Opens its own getUserMedia stream +
 * AnalyserNode, shows a live level meter, and tears everything down when
 * stopped or unmounted. Works on web and in the Tauri desktop webview.
 *
 * Extracted from the onboarding wizard so the same check is available from
 * Settings. It tests the *microphone* input (the OS speaker output used by
 * "System Audio" capture can't be read via getUserMedia).
 */
export function AudioLevelTest({ deviceId }: { deviceId?: string }) {
    const [testing, setTesting] = useState(false)
    const [level, setLevel] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const levelRef = useRef(0)

    useEffect(() => {
        if (!testing) return

        let cancelled = false
        let raf = 0
        let ctx: AudioContext | null = null
        let stream: MediaStream | null = null
        let analyser: AnalyserNode | null = null

        ;(async () => {
            try {
                const constraints: MediaTrackConstraints | boolean = deviceId
                    ? { deviceId: { exact: deviceId }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true } }
                    : true
                stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop())
                    return
                }
                ctx = new AudioContext()
                const source = ctx.createMediaStreamSource(stream)
                analyser = ctx.createAnalyser()
                analyser.fftSize = 256
                source.connect(analyser)
                const data = new Uint8Array(analyser.frequencyBinCount)

                const loop = () => {
                    if (cancelled || !analyser) return
                    analyser.getByteFrequencyData(data)
                    const avg = data.reduce((a, b) => a + b, 0) / data.length / 255
                    const scaled = Math.min(avg * 1.6, 1)
                    // Smooth a little so the bars don't strobe.
                    levelRef.current = levelRef.current * 0.6 + scaled * 0.4
                    setLevel(levelRef.current)
                    raf = requestAnimationFrame(loop)
                }
                loop()
            } catch {
                if (!cancelled) {
                    setError('Microphone unavailable or permission denied.')
                    setTesting(false)
                }
            }
        })()

        return () => {
            cancelled = true
            cancelAnimationFrame(raf)
            analyser?.disconnect()
            ctx?.close().catch(() => {})
            stream?.getTracks().forEach((t) => t.stop())
            levelRef.current = 0
            setLevel(0)
        }
    }, [testing, deviceId])

    const active = testing && !error
    const detected = level > 0.03

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <button
                    onClick={() => {
                        setError(null)
                        setTesting((t) => !t)
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        testing
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-[var(--accent-teal)] hover:brightness-110 text-white'
                    }`}
                >
                    {testing ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    {testing ? 'Stop test' : 'Test microphone'}
                </button>

                {/* Level bars */}
                <div className={`flex items-end gap-[2px] h-6 flex-1 ${active ? 'opacity-100' : 'opacity-30'} transition-opacity`}>
                    {[4, 7, 5, 9, 6, 8, 5, 7, 6, 8, 5, 4].map((weight, i) => {
                        const minH = 3
                        const maxH = 22
                        const h = minH + Math.min(level * weight * 0.7, 1) * (maxH - minH)
                        return (
                            <div
                                key={i}
                                className={`w-[3px] rounded-full transition-[height] duration-75 ${
                                    active && detected
                                        ? 'bg-gradient-to-t from-emerald-600 via-emerald-400 to-cyan-300'
                                        : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                                style={{ height: `${h}px` }}
                            />
                        )
                    })}
                </div>
            </div>

            {error ? (
                <p className="text-[11px] text-red-500">{error}</p>
            ) : testing ? (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {detected ? 'Signal detected — speak to see it move.' : 'Listening… say something into the mic.'}
                </p>
            ) : (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Check your microphone is picking up sound before going live.
                </p>
            )}
        </div>
    )
}
