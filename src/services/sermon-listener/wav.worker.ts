/**
 * WAV Encoding Web Worker
 *
 * Offloads audio resampling, mono mixing, and WAV encoding from the main thread.
 * Used by whisper.cpp transcription to keep the UI responsive during live sermon capture.
 */

// ---------------------------------------------------------------------------
// Audio DSP utilities (mirror of whisperCppTranscription.ts)
// ---------------------------------------------------------------------------

function getMaxAmplitude(samples: Float32Array): number {
    let max = 0
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i])
        if (abs > max) max = abs
    }
    return max
}

function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    const ratio = fromRate / toRate
    const newLength = Math.round(samples.length / ratio)
    const result = new Float32Array(newLength)

    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio
        const srcIndexFloor = Math.floor(srcIndex)
        const fraction = srcIndex - srcIndexFloor

        const y0 = samples[Math.max(0, srcIndexFloor - 1)]
        const y1 = samples[srcIndexFloor]
        const y2 = samples[Math.min(srcIndexFloor + 1, samples.length - 1)]
        const y3 = samples[Math.min(srcIndexFloor + 2, samples.length - 1)]

        const c0 = y1
        const c1 = 0.5 * (y2 - y0)
        const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
        const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)

        result[i] = ((c3 * fraction + c2) * fraction + c1) * fraction + c0
    }

    return result
}

function mixToMono(channelData: Float32Array[]): Float32Array {
    const length = channelData[0]?.length ?? 0
    const result = new Float32Array(length)
    const numChannels = channelData.length
    for (let i = 0; i < length; i++) {
        let sum = 0
        for (let ch = 0; ch < numChannels; ch++) {
            sum += channelData[ch][i]
        }
        result[i] = sum / numChannels
    }
    return result
}

function floatTo16BitPCM(view: DataView, offset: number, samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
    }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)

    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)
    floatTo16BitPCM(view, 44, samples)

    return new Blob([buffer], { type: 'audio/wav' })
}

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

interface WavRequest {
    id: number
    type: 'encodeChunk' | 'convertBlob'
    // encodeChunk fields
    samples?: Float32Array
    nativeSampleRate?: number
    targetSampleRate?: number
    needsResampling?: boolean
    channelCount?: number
    // convertBlob fields
    audioBlob?: Blob
}

interface WavSuccessResponse {
    id: number
    wavBlob: Blob
    maxAmplitude?: number
    resampledSamples?: number
    nativeSamples?: number
    duration?: number
}

interface WavErrorResponse {
    id: number
    error: string
}

type WavResponse = WavSuccessResponse | WavErrorResponse

// ---------------------------------------------------------------------------
// Blob → WAV conversion (mirror of convertToWav)
// ---------------------------------------------------------------------------

async function convertBlobToWav(audioBlob: Blob): Promise<Blob> {
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioContext = new AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    const originalSampleRate = audioBuffer.sampleRate
    const channelData: Float32Array[] = []
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        channelData.push(audioBuffer.getChannelData(ch))
    }

    const monoData = channelData.length > 1 ? mixToMono(channelData) : channelData[0]

    const targetSampleRate = 16000
    const resampledData =
        originalSampleRate !== targetSampleRate
            ? resample(monoData, originalSampleRate, targetSampleRate)
            : monoData

    await audioContext.close()
    return encodeWav(resampledData, targetSampleRate)
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WavRequest>) => {
    const { id, type } = event.data
    try {
        if (type === 'encodeChunk') {
            const {
                samples,
                nativeSampleRate,
                targetSampleRate,
                needsResampling,
                channelCount,
            } = event.data
            if (!samples) throw new Error('No samples provided')

            // Decode transferred Float32Array (it may have been transferred, so reconstruct)
            const pcm = new Float32Array(samples)

            // If multi-channel data was flattened, we'd need channelCount to demux.
            // For now we assume mono from the AudioWorklet (the worklet already mixes to mono).
            const maxAmp = getMaxAmplitude(pcm)
            const resampled = needsResampling ? resample(pcm, nativeSampleRate!, targetSampleRate!) : pcm
            const wavBlob = encodeWav(resampled, targetSampleRate!)
            const duration = resampled.length / (targetSampleRate || 16000)

            const response: WavSuccessResponse = {
                id,
                wavBlob,
                maxAmplitude: maxAmp,
                resampledSamples: resampled.length,
                nativeSamples: pcm.length,
                duration,
            }
            self.postMessage(response)
        } else if (type === 'convertBlob') {
            const { audioBlob } = event.data
            if (!audioBlob) throw new Error('No audio blob provided')
            const wavBlob = await convertBlobToWav(audioBlob)
            const response: WavSuccessResponse = { id, wavBlob }
            self.postMessage(response, [wavBlob as unknown as Transferable] as any)
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const response: WavErrorResponse = { id, error }
        self.postMessage(response)
    }
}
