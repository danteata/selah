import { describe, it, expect } from 'vitest'
import { isCongregationSinging } from '../worshipMode'
import { DEFAULT_SONG_TRACKING, type SongTrackingState } from '../../../store/appStore'

function state(patch: Partial<SongTrackingState['status']>, autoDetect = true): SongTrackingState {
    return {
        ...DEFAULT_SONG_TRACKING,
        autoDetect,
        status: { ...DEFAULT_SONG_TRACKING.status, ...patch },
    }
}

describe('isCongregationSinging', () => {
    it('is true only while the tracker is following a song it hears sung', () => {
        expect(isCongregationSinging(state({ songId: 'a', phase: 'tracking', singing: true }))).toBe(true)
    })

    it('is false while the tracker holds its place but nothing is heard sung', () => {
        // The regression: a sermon after a song kept the tracker Tracking on a
        // few shared words, and scripture detection stayed muted.
        expect(isCongregationSinging(state({ songId: 'a', phase: 'tracking', singing: false }))).toBe(false)
    })

    it('is false once the tracker loses the song', () => {
        // Losing the song is the signal that the audio stopped matching its
        // lyrics — which is where preaching typically resumes, and where
        // scripture detection has to come back.
        expect(isCongregationSinging(state({ songId: 'a', phase: 'lost' }))).toBe(false)
    })

    it('is false while merely searching', () => {
        expect(isCongregationSinging(state({ songId: 'a', phase: 'searching' }))).toBe(false)
    })

    it('is false when a song is on screen but nothing is being tracked', () => {
        // A song slide left up while the preacher talks over it is the common
        // case, and it must not suppress scripture detection.
        expect(isCongregationSinging(state({ songId: 'a', phase: 'idle' }))).toBe(false)
    })

    it('is false with no song at all', () => {
        expect(isCongregationSinging(state({ songId: null, phase: 'tracking', singing: true }))).toBe(false)
    })

    it('is false when the operator has not enabled song auto-detect', () => {
        expect(isCongregationSinging(state({ songId: 'a', phase: 'tracking', singing: true }, false))).toBe(false)
    })
})
