import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Scripture, Slide } from '../../../types'

const fetchScripture = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks')>()),
    useScripture: () => ({ fetchScripture }),
}))

import { useAppStore } from '../../../store/appStore'
import { MobileVerseStepper } from '../MobileVerseStepper'

const psalm = (verse: number): Scripture => ({
    label: `Psalms 23:${verse}`,
    labelShortFormat: `19:23:${verse}`,
    version: 'KJV',
    content: [{ verse: String(verse), scripture: `Verse ${verse} text.` }],
} as unknown as Scripture)

const slideAt = (verse: number): Slide => ({
    id: 'live',
    index: 0,
    scheduleId: '',
    userId: '',
    churchId: '',
    name: `Psalms 23:${verse}`,
    type: 'bible',
    layout: 'standard',
    contents: [],
    background: '#000',
    data: psalm(verse),
    slideStyle: {},
} as Slide)

function liveAt(verse: number) {
    const slide = slideAt(verse)
    useAppStore.setState({ activeSlides: [slide], liveSlideId: slide.id })
    return slide
}

describe('MobileVerseStepper', () => {
    beforeEach(() => {
        fetchScripture.mockReset()
        fetchScripture.mockImplementation(async (label: string) => psalm(Number(label.split(':')[2])))
    })

    it('names the verse that is live', () => {
        render(<MobileVerseStepper slide={liveAt(3)} onSlideChanged={vi.fn()} />)
        expect(screen.getByText('Psalms 23:3')).toBeInTheDocument()
    })

    it('puts the next verse on the live slide and shares it', async () => {
        const onSlideChanged = vi.fn()
        render(<MobileVerseStepper slide={liveAt(3)} onSlideChanged={onSlideChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Next verse' }))

        await waitFor(() => expect(onSlideChanged).toHaveBeenCalled())
        expect(fetchScripture).toHaveBeenCalledWith('19:23:4', 'KJV')
        const live = useAppStore.getState().activeSlides[0]
        expect(live.name).toBe('Psalms 23:4')
        expect(live.displayVerseNumbers).toEqual([4])
        expect(live.contents.join(' ')).toContain('Verse 4 text.')
        expect(onSlideChanged).toHaveBeenCalledWith(live)
    })

    it('goes back a verse', async () => {
        render(<MobileVerseStepper slide={liveAt(3)} onSlideChanged={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Previous verse' }))
        await waitFor(() => expect(fetchScripture).toHaveBeenCalledWith('19:23:2', 'KJV'))
    })

    it("can't step past either end of the chapter", () => {
        const { rerender } = render(<MobileVerseStepper slide={liveAt(1)} onSlideChanged={vi.fn()} />)
        expect(screen.getByRole('button', { name: 'Previous verse' })).toBeDisabled()
        rerender(<MobileVerseStepper slide={liveAt(6)} onSlideChanged={vi.fn()} />)
        expect(screen.getByRole('button', { name: 'Next verse' })).toBeDisabled()
    })

    it("leaves the screen alone if it moved on while the verse loaded", async () => {
        const onSlideChanged = vi.fn()
        let release!: () => void
        fetchScripture.mockImplementation(() => new Promise((resolve) => { release = () => resolve(psalm(4)) }))
        render(<MobileVerseStepper slide={liveAt(3)} onSlideChanged={onSlideChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Next verse' }))
        useAppStore.setState({ liveSlideId: 'something-else' })
        release()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next verse' })).not.toBeDisabled())
        expect(onSlideChanged).not.toHaveBeenCalled()
    })
})
