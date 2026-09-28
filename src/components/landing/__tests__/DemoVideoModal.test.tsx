import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DemoVideoModal } from '../DemoVideoModal'

describe('DemoVideoModal', () => {
    it('shows the demo, muted so it can start on its own', () => {
        render(<DemoVideoModal isOpen onClose={vi.fn()} />)
        const video = screen.getByLabelText(/Selah demo:/) as HTMLVideoElement
        expect(video.getAttribute('src')).toBe('/selah-demo.mp4')
        expect(video.muted).toBe(true)
        expect(video.hasAttribute('controls')).toBe(true)
    })

    it('renders nothing until opened, so the video only loads when asked for', () => {
        const { container } = render(<DemoVideoModal isOpen={false} onClose={vi.fn()} />)
        expect(container.querySelector('video')).toBeNull()
    })

    it('closes on Escape', () => {
        const onClose = vi.fn()
        render(<DemoVideoModal isOpen onClose={onClose} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalled()
    })
})
