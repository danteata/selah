import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileStudioWorkspace } from '../MobileStudioWorkspace'
import type { Slide } from '../../../types'

// vi.mock factories are hoisted above imports — any state they reference must live
// inside vi.hoisted() so the closure captures the hoisted binding, not the runtime one.
const mocks = vi.hoisted(() => {
    return {
        store: {
            current: {
                activeSlides: [] as Slide[],
                liveSlideId: '',
                setLiveSlide: vi.fn(),
                liveOutputSlidesId: [] as string[],
                sharedQueueSlideIds: [] as string[],
                openModal: vi.fn(),
                workspaceMode: 'studio',
            },
        },
        session: {
            isOperator: true,
            isContributor: false,
            isConnected: false,
            isOpen: false,
            isStrict: false,
            addToQueue: vi.fn(),
            setLiveSlide: vi.fn(),
            acceptFromQueue: vi.fn(),
            removeFromQueue: vi.fn(),
            sessionScheduleId: undefined as string | undefined,
        },
    }
})

vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: any) =>
        selector ? selector(mocks.store.current) : mocks.store.current,
}))

vi.mock('../../../hooks/useLiveSession', () => ({
    useLiveSession: () => mocks.session,
}))

vi.mock('../../../hooks/useUserRole', () => ({
    useUserRole: () => ({ currentUser: { churchId: 'church-1' } }),
}))

// The collab controls have their own tests and pull in Convex/Clerk; stub
// them here so MobileStudioWorkspace tests stay focused on the layout.
vi.mock('../../live/LiveSessionControls', () => ({
    LiveSessionControls: ({ churchId }: { churchId: string }) => (
        <div data-testid="live-session-controls">{churchId}</div>
    ),
}))

vi.mock('../../live/PresenceAvatars', () => ({
    PresenceAvatars: ({ churchId }: { churchId: string }) => (
        <div data-testid="presence-avatars">{churchId}</div>
    ),
}))

const bibleSlide: Slide = {
    id: 'b1',
    index: 0,
    scheduleId: '',
    userId: '',
    churchId: '',
    name: 'Psalm 24',
    type: 'bible',
    layout: 'standard',
    contents: [
        '<p class="scripture-content"><sup>5</sup> He shall receive the blessing from the LORD.</p>',
        '<p class="scripture-label"><b>Psalm 24:5</b> · KJV</p>',
    ],
    background: '#1f2937',
    slideStyle: { font: 'Inter' },
}

function setStore(slides: Slide[], liveSlideId: string, sharedQueueSlideIds: string[] = []) {
    mocks.store.current = {
        activeSlides: slides,
        liveSlideId,
        setLiveSlide: vi.fn(),
        liveOutputSlidesId: slides.map(s => s.id),
        sharedQueueSlideIds,
        openModal: vi.fn(),
        workspaceMode: 'studio',
    }
}

type SessionOverrides = Partial<typeof mocks.session>
function setSession(overrides: SessionOverrides) {
    mocks.session = {
        // Defaults: solo (no session). Each test opts into a role/mode.
        isOperator: false,
        isContributor: false,
        isConnected: false,
        isOpen: false,
        isStrict: false,
        addToQueue: vi.fn(),
        setLiveSlide: vi.fn(),
        acceptFromQueue: vi.fn(),
        removeFromQueue: vi.fn(),
        sessionScheduleId: undefined,
        ...overrides,
    }
}

describe('MobileStudioWorkspace', () => {
    beforeEach(() => {
        // jsdom has no layout — AutoFitText reads clientWidth/scrollWidth. Returning
        // a positive width lets fit() proceed without throwing.
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get() { return 320 },
        })
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get() { return 200 },
        })
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
            configurable: true,
            get() { return 100 },
        })
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get() { return 100 },
        })
        // Reset collaboration state to solo between tests.
        setSession({})
    })

    it('renders bible verse reference label as parsed HTML, not raw markup', () => {
        setStore([bibleSlide], bibleSlide.id)

        render(<MobileStudioWorkspace />)

        // The label string from the slide is "<p class="scripture-label"><b>Psalm 24:5</b> · KJV</p>".
        // If the bug regresses, this exact string leaks into the DOM as a text node.
        expect(screen.queryByText(/^<p class="scripture-label"/)).toBeNull()

        // The label must be parsed — find a <p> carrying the scripture-label class with
        // a <b> child holding the reference text.
        const label = document.querySelector('p.scripture-label')
        expect(label).not.toBeNull()
        expect(label?.querySelector('b')?.textContent).toBe('Psalm 24:5')
        // Trailing " · KJV" should be in the same label, not floating text.
        expect(label?.textContent).toContain('KJV')
    })

    it('does not render a ref label node when the live slide has no contents[1]', () => {
        const noRefSlide: Slide = {
            ...bibleSlide,
            id: 'b2',
            contents: ['<p>plain verse text</p>'],
        }
        setStore([noRefSlide], noRefSlide.id)

        render(<MobileStudioWorkspace />)

        expect(document.querySelector('p.scripture-label')).toBeNull()
    })

    it('dispatches the quick-actions focus event when search button is tapped', () => {
        setStore([bibleSlide], bibleSlide.id)

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        render(<MobileStudioWorkspace />)
        const searchButton = screen.getByRole('button', { name: /search and add slides/i })
        fireEvent.click(searchButton)

        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'selah:focus-quick-actions' })
        )
    })

    it('surfaces the collaboration controls on mobile (regression: they were desktop-only)', () => {
        setStore([bibleSlide], bibleSlide.id)

        render(<MobileStudioWorkspace />)

        expect(screen.getByTestId('live-session-controls').textContent).toBe('church-1')
        expect(screen.getByTestId('presence-avatars').textContent).toBe('church-1')
    })

    // --- Mode-aware collaboration transport ---------------------------------

    const slideA: Slide = { ...bibleSlide, id: 's1', name: 'Slide A' }
    const slideB: Slide = { ...bibleSlide, id: 's2', name: 'Slide B', contents: ['<p>Slide B body</p>'] }
    const nextBtn = () => screen.getByRole('button', { name: /^Next$/ }) as HTMLButtonElement

    it('operator advancing goes through the Convex-backed hook so it reaches other devices', () => {
        // Regression: mobile used the local-only store setter, so operator
        // slide changes never propagated. It must call the hook's setLiveSlide.
        setSession({ isOperator: true, isConnected: true })
        setStore([slideA, slideB], 's1')

        render(<MobileStudioWorkspace />)
        fireEvent.click(nextBtn())

        expect(mocks.session.setLiveSlide).toHaveBeenCalledWith('s2')
        // The local-only store setter must NOT be used for the live push.
        expect(mocks.store.current.setLiveSlide).not.toHaveBeenCalled()
    })

    it('lets a contributor advance directly in open mode', () => {
        setSession({ isContributor: true, isConnected: true, isOpen: true })
        setStore([slideA, slideB], 's1')

        render(<MobileStudioWorkspace />)
        const btn = nextBtn()
        expect(btn.disabled).toBe(false)
        fireEvent.click(btn)

        expect(mocks.session.setLiveSlide).toHaveBeenCalledWith('s2')
    })

    it('blocks direct advance but offers Suggest for a contributor in review mode', () => {
        setSession({ isContributor: true, isConnected: true }) // moderated: not open, not strict
        setStore([slideA, slideB], 's1')

        render(<MobileStudioWorkspace />)
        expect(nextBtn().disabled).toBe(true)

        const suggest = screen.getByRole('button', { name: /suggest next slide/i })
        fireEvent.click(suggest)

        expect(mocks.session.addToQueue).toHaveBeenCalledWith(['s2'])
        expect(mocks.session.setLiveSlide).not.toHaveBeenCalled()
    })

    it('offers no Suggest affordance in strict mode', () => {
        setSession({ isContributor: true, isConnected: true, isStrict: true })
        setStore([slideA, slideB], 's1')

        render(<MobileStudioWorkspace />)
        expect(nextBtn().disabled).toBe(true)
        expect(screen.queryByRole('button', { name: /suggest next slide/i })).toBeNull()
    })

    it('shows the operator a suggestion-approval panel with accept/reject', () => {
        setSession({ isOperator: true, isConnected: true })
        setStore([slideA, slideB], 's1', ['s2'])

        render(<MobileStudioWorkspace />)
        expect(screen.getByText(/Suggested \(1\)/)).not.toBeNull()

        fireEvent.click(screen.getByRole('button', { name: /accept suggestion/i }))
        expect(mocks.session.acceptFromQueue).toHaveBeenCalledWith(['s2'])

        fireEvent.click(screen.getByRole('button', { name: /dismiss suggestion/i }))
        expect(mocks.session.removeFromQueue).toHaveBeenCalledWith(['s2'])
    })
})
