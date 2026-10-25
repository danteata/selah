import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaContent } from '../MediaContent'
import type { Slide } from '../../../types'

const clip = { id: 'v1', type: 'media', backgroundType: 'video', name: 'IMG_2453.MOV', slideStyle: {} } as unknown as Slide

/** The video's sound loads, but it has no picture this computer can decode. */
function soundWithoutPicture() {
    const video = document.querySelector('video')!
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 0 })
    Object.defineProperty(video, 'duration', { configurable: true, value: 42 })
    fireEvent.loadedMetadata(video)
}

describe('MediaContent with a video whose picture this computer can\'t decode', () => {
    it("tells the operator, where the timer ran over a black screen", () => {
        render(<MediaContent slide={clip} src="http://asset.localhost/clip.MOV" muted />)
        soundWithoutPicture()
        expect(screen.getByText(/can't play this video's format/)).toBeInTheDocument()
        // The video stays: its sound still plays.
        expect(document.querySelector('video')).not.toBeNull()
    })

    it('leaves the projector playing the sound, with no message to the room', () => {
        render(<MediaContent slide={clip} src="http://asset.localhost/clip.MOV" />)
        soundWithoutPicture()
        expect(screen.queryByText(/can't play/)).toBeNull()
        expect(document.querySelector('video')).not.toBeNull()
    })
})
