import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { extractBands, bandsForSampleRate, audioFeatures, ZERO_FEATURES } from '../audioFeatures'

describe('extractBands', () => {
    it('returns zeros for an empty array', () => {
        expect(extractBands(new Uint8Array(0))).toEqual(ZERO_FEATURES)
    })

    it('detects bass energy concentrated in the low bins', () => {
        const arr = new Uint8Array(100)
        for (let i = 0; i < 15; i++) arr[i] = 255 // fill the bass band (0..15%)
        const f = extractBands(arr)
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.treble).toBe(0)
        expect(f.mid).toBe(0)
    })

    it('detects treble energy concentrated in the high bins', () => {
        const arr = new Uint8Array(100)
        for (let i = 60; i < 100; i++) arr[i] = 255 // top 40% loud
        const f = extractBands(arr)
        expect(f.treble).toBeGreaterThan(0.9)
        expect(f.bass).toBe(0)
    })

    it('produces a full-scale rms for a saturated spectrum', () => {
        const arr = new Uint8Array(64).fill(255)
        const f = extractBands(arr)
        expect(f.rms).toBeCloseTo(1, 5)
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.mid).toBeCloseTo(1, 5)
        expect(f.treble).toBeCloseTo(1, 5)
    })

    it('clamps all bands to 0..1', () => {
        const arr = new Uint8Array(50).fill(128)
        const f = extractBands(arr)
        for (const v of Object.values(f)) {
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1)
        }
    })

    it('honours custom band boundaries', () => {
        const arr = new Uint8Array(100)
        for (let i = 0; i < 50; i++) arr[i] = 255
        // With bassEnd at 50%, all the energy is bass.
        const f = extractBands(arr, { bassEnd: 0.5, midEnd: 0.75 })
        expect(f.bass).toBeCloseTo(1, 5)
        expect(f.treble).toBe(0)
    })
})

describe('audioFeatureBus', () => {
    beforeEach(() => audioFeatures.reset())

    it('is stale after reset', () => {
        expect(audioFeatures.isStale()).toBe(true)
        expect(audioFeatures.current).toEqual(ZERO_FEATURES)
    })

    it('publishes the latest features and clears staleness', () => {
        const arr = new Uint8Array(64).fill(200)
        audioFeatures.publish(arr)
        expect(audioFeatures.current.rms).toBeGreaterThan(0)
        expect(audioFeatures.isStale()).toBe(false)
    })

    it('resets back to zero', () => {
        audioFeatures.publish(new Uint8Array(64).fill(255))
        audioFeatures.reset()
        expect(audioFeatures.current).toEqual(ZERO_FEATURES)
    })
})

describe('bandsForSampleRate', () => {
    it('places the bass edge at a real bass frequency, not a fraction of the bins', () => {
        // The whole point: at 48kHz the old fraction-based 0.15 boundary called
        // everything under 3.6kHz "bass". 160Hz of a 24kHz Nyquist is ~0.0067.
        const b = bandsForSampleRate(48000)
        expect(b.bassEnd).toBeCloseTo(160 / 24000, 5)
        expect(b.midEnd).toBeCloseTo(2000 / 24000, 5)
        expect(b.trebleEnd).toBeCloseTo(9000 / 24000, 5)
    })

    it('keeps edges ordered and clamped when the sample rate is low', () => {
        // 16kHz capture: Nyquist 8kHz, below the 9kHz treble edge, so it clamps.
        const b = bandsForSampleRate(16000)
        expect(b.bassStart!).toBeLessThan(b.bassEnd)
        expect(b.bassEnd).toBeLessThan(b.midEnd)
        expect(b.midEnd).toBeLessThan(b.trebleEnd!)
        expect(b.trebleEnd!).toBeLessThanOrEqual(1)
    })

    it('separates a low tone from a high one', () => {
        const bands = bandsForSampleRate(48000)
        const n = 512 // 512 bins over 0..24kHz => ~46.9Hz per bin
        const lowTone = new Uint8Array(n)
        lowTone[2] = 255 // ~94Hz — a kick fundamental
        const low = extractBands(lowTone, bands)
        expect(low.bass).toBeGreaterThan(0)
        expect(low.mid).toBe(0)

        const highTone = new Uint8Array(n)
        highTone[100] = 255 // ~4.7kHz — cymbal range
        const high = extractBands(highTone, bands)
        expect(high.treble).toBeGreaterThan(0)
        expect(high.bass).toBe(0)
    })
})

describe('beat detection', () => {
    let t = 0
    let spy: ReturnType<typeof vi.spyOn>

    /** Publish a frame of the given bass level at the current fake clock. */
    const frame = (bass: number, advanceMs = 16) => {
        t += advanceMs
        audioFeatures.publishFeatures({ rms: bass, bass, mid: 0, treble: 0 })
    }

    beforeEach(() => {
        t = 1000
        spy = vi.spyOn(performance, 'now').mockImplementation(() => t)
        audioFeatures.reset()
        audioFeatures.setPipelineLatency(0)
    })
    afterEach(() => {
        spy.mockRestore()
        audioFeatures.reset()
    })

    it('does not fire a beat on the first frame', () => {
        // The envelopes are seeded from the first sample, so even a loud opening
        // frame has nothing to look like a transient against.
        frame(0.9)
        expect(audioFeatures.beatCount).toBe(0)
        expect(audioFeatures.beatPulse).toBe(0)
    })

    it('fires on a transient above the running baseline', () => {
        for (let i = 0; i < 20; i++) frame(0.1)
        expect(audioFeatures.beatCount).toBe(0)
        frame(0.8)
        expect(audioFeatures.beatCount).toBe(1)
        expect(audioFeatures.beatPulse).toBeGreaterThan(0.8)
    })

    it('does not fire on a sustained loud passage', () => {
        // A step up to a new loud plateau is one onset, not a run of them. The
        // flux gate is what stops it: once the level holds, the fast envelope
        // reaches it and no frame brings new energy, even though the slow
        // baseline is still catching up and every frame still looks loud
        // relative to it.
        for (let i = 0; i < 10; i++) frame(0.1)
        frame(0.8)
        const afterOnset = audioFeatures.beatCount
        for (let i = 0; i < 40; i++) frame(0.8)
        expect(audioFeatures.beatCount).toBe(afterOnset)
    })

    it('respects the refractory period', () => {
        for (let i = 0; i < 20; i++) frame(0.05)
        frame(0.9)
        expect(audioFeatures.beatCount).toBe(1)
        // A second spike 100ms later (< the 200ms refractory) is the same hit.
        frame(0.05)
        frame(0.9, 84)
        expect(audioFeatures.beatCount).toBe(1)
    })

    it('adapts at the same rate regardless of the publish frame rate', () => {
        // The regression this guards: a per-frame smoothing coefficient made the
        // desktop feed (~30fps) adapt half as fast as the web one (~60fps), so
        // the two platforms disagreed about what counted as a beat.
        const run = (stepMs: number) => {
            audioFeatures.reset()
            t = 1000
            for (let elapsed = 0; elapsed < 600; elapsed += stepMs) frame(0.1, stepMs)
            frame(0.8, stepMs)
            return audioFeatures.beatCount
        }
        expect(run(16)).toBe(1)
        expect(run(33)).toBe(1)
    })

    it('ignores a silent keep-alive frame instead of zeroing the signal', () => {
        for (let i = 0; i < 20; i++) frame(0.4)
        const before = { ...audioFeatures.current }
        const beatsBefore = audioFeatures.beatCount

        t += 16
        audioFeatures.publishFeatures({ rms: 0, bass: 0, mid: 0, treble: 0 }, { silent: true })
        // Liveness refreshed (the capture watchdog must not see this as death)...
        expect(audioFeatures.isStale()).toBe(false)
        // ...but the features are held, not zeroed.
        expect(audioFeatures.current).toEqual(before)

        // And crucially the next real frame must not read as a huge transient
        // against a collapsed baseline.
        frame(0.4)
        expect(audioFeatures.beatCount).toBe(beatsBefore)
    })

    it('locks a steady tempo and reports it as BPM', () => {
        for (let i = 0; i < 20; i++) frame(0.05)
        // 500ms apart => 120 BPM. Needs 4 beats for 3 intervals.
        for (let i = 0; i < 5; i++) {
            frame(0.9)
            for (let j = 0; j < 30; j++) frame(0.05, 16)
        }
        expect(audioFeatures.bpm).toBeGreaterThan(100)
        expect(audioFeatures.bpm).toBeLessThan(140)
    })

    it('anticipates the next beat once the tempo is locked', () => {
        for (let i = 0; i < 20; i++) frame(0.05)
        for (let i = 0; i < 5; i++) {
            frame(0.9)
            for (let j = 0; j < 30; j++) frame(0.05, 16)
        }
        const tempoMs = 60000 / audioFeatures.bpm
        const lastBeatAt = t - 30 * 16

        // Just before the next predicted beat the pulse is near zero...
        t = lastBeatAt + tempoMs - 40
        const before = audioFeatures.beatPulse
        // ...and it has fired by the predicted time, without any new audio
        // arriving to detect it. This is what cancels pipeline latency.
        t = lastBeatAt + tempoMs
        expect(audioFeatures.beatPulse).toBeGreaterThan(before)
        expect(audioFeatures.beatPulse).toBeGreaterThan(0.9)
    })

    it('stops anticipating after a beat goes missing', () => {
        for (let i = 0; i < 20; i++) frame(0.05)
        for (let i = 0; i < 5; i++) {
            frame(0.9)
            for (let j = 0; j < 30; j++) frame(0.05, 16)
        }
        const lastBeatAt = t - 30 * 16
        const tempoMs = 60000 / audioFeatures.bpm
        // Three beats past the last real detection — the song has ended, so the
        // visual must not keep pulsing on its own.
        t = lastBeatAt + tempoMs * 3
        expect(audioFeatures.beatPulse).toBeLessThan(0.01)
    })

    it('shifts the pulse earlier by the reported pipeline latency', () => {
        audioFeatures.setPipelineLatency(60)
        for (let i = 0; i < 20; i++) frame(0.05)
        frame(0.9)
        // The beat is treated as having happened 60ms ago (when the room heard
        // it), so the pulse is already partway through its decay on arrival
        // rather than starting from a full 1.0 sixty milliseconds late.
        expect(audioFeatures.beatPulse).toBeLessThan(0.7)
        expect(audioFeatures.beatPulse).toBeGreaterThan(0.3)
    })
})
