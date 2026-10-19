import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useAppStore } from '../../../store/appStore'

/**
 * The phone's tab bar holds what's reached for mid-service. The sermon
 * listener isn't one of those on a phone (the browser stops listening at
 * every pause), so it lives under More — except while it's running here,
 * when its tab and recording light stay in sight so it can be stopped.
 */

const h = vi.hoisted(() => ({ isListening: false }))
vi.mock('../../sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: () => ({ isListening: h.isListening }),
}))

vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

const { MobileBottomNav } = await import('../MobileBottomNav')

describe('MobileBottomNav', () => {
    beforeEach(() => {
        h.isListening = false
        useAppStore.setState({ activeNavSection: null, liveSlideId: null })
    })

    it('has a Live tab, the view of what is on the screen, to come back to', () => {
        useAppStore.setState({ activeNavSection: 'bible' })
        render(<MobileBottomNav />)
        const live = screen.getByRole('button', { name: 'Live' })
        expect(live).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(live)
        expect(useAppStore.getState().activeNavSection).toBeNull()
        expect(live).toHaveAttribute('aria-pressed', 'true')
    })

    it('keeps Bible and Music on the bar, and the sermon listener and templates off it', () => {
        render(<MobileBottomNav />)
        expect(screen.getByRole('button', { name: 'Bible' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Music' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Sermon' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull()
    })

    it('keeps a running listener on the bar', () => {
        h.isListening = true
        render(<MobileBottomNav />)
        expect(screen.getByRole('button', { name: 'Sermon' })).toBeInTheDocument()
    })
})
