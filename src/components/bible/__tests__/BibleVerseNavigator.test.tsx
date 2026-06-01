import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BibleVerseNavigator } from '../BibleVerseNavigator'
import type { Slide, Scripture } from '../../../types'

const mockFetchScripture = vi.fn()
const mockIsVersionDownloaded = vi.fn().mockResolvedValue(false)

vi.mock('../../../hooks/useScripture', () => ({
    useScripture: () => ({
        fetchScripture: mockFetchScripture,
        isVersionDownloaded: mockIsVersionDownloaded,
    }),
}))

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn().mockImplementation((selector: any) => {
        const state = { settings: { defaultBibleVersion: 'KJV' } }
        return typeof selector === 'function' ? selector(state) : state
    }),
}))

const bibleSlide: Slide = {
    id: 'slide-1',
    index: 0,
    name: 'John 3:16',
    type: 'bible',
    layout: 'full-text',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['John 3:16', '<p>For God so loved the world</p>'],
    data: {
        version: 'KJV',
        labelShortFormat: '43:3:16-18',
    } as Scripture,
}

const textSlide: Slide = {
    id: 'slide-2',
    index: 1,
    name: 'Text Slide',
    type: 'text',
    layout: 'full-text',
    userId: 'user-1',
    churchId: 'church-1',
    scheduleId: 'schedule-1',
    contents: ['Hello'],
}

describe('BibleVerseNavigator', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockFetchScripture.mockResolvedValue({
            content: [
                { verse: '16', scripture: 'For God so loved the world' },
            ],
            label: 'John 3:16',
        })
        mockIsVersionDownloaded.mockResolvedValue(false)
    })

    it('renders nothing when currentSlide is null', () => {
        const { container } = render(
            <BibleVerseNavigator currentSlide={null} onVerseSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders nothing for non-bible slide', () => {
        const { container } = render(
            <BibleVerseNavigator currentSlide={textSlide} onVerseSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders navigator for bible slide with valid data', async () => {
        render(<BibleVerseNavigator currentSlide={bibleSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            expect(screen.getByText(/John/)).toBeInTheDocument()
        }, { timeout: 5000 })
    })

    it('shows book name and chapter in header', async () => {
        render(<BibleVerseNavigator currentSlide={bibleSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            expect(screen.getByText(/John 3/)).toBeInTheDocument()
        }, { timeout: 5000 })
    })

    it('shows verse range in navigation', async () => {
        render(<BibleVerseNavigator currentSlide={bibleSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            expect(screen.getByText(/Verses 16-18/)).toBeInTheDocument()
        }, { timeout: 5000 })
    })

    it('shows single verse label when start equals end', async () => {
        const singleVerseSlide: Slide = {
            ...bibleSlide,
            data: {
                version: 'KJV',
                labelShortFormat: '43:3:16',
            } as Scripture,
        }
        render(<BibleVerseNavigator currentSlide={singleVerseSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            expect(screen.getByText(/Verse 16/)).toBeInTheDocument()
        }, { timeout: 5000 })
    })

    it('does not render when scriptureRef cannot be parsed', () => {
        const badSlide: Slide = {
            ...bibleSlide,
            data: {
                version: 'KJV',
                labelShortFormat: 'invalid',
            } as Scripture,
        }
        const { container } = render(
            <BibleVerseNavigator currentSlide={badSlide} onVerseSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('does not render when data is missing', () => {
        const noDataSlide: Slide = {
            ...bibleSlide,
            data: undefined,
        }
        const { container } = render(
            <BibleVerseNavigator currentSlide={noDataSlide} onVerseSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('does not render when labelShortFormat has insufficient parts', () => {
        const shortFormatSlide: Slide = {
            ...bibleSlide,
            data: {
                version: 'KJV',
                labelShortFormat: '43:3',
            } as Scripture,
        }
        const { container } = render(
            <BibleVerseNavigator currentSlide={shortFormatSlide} onVerseSelect={vi.fn()} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('disables prev button when startVerse is 1', async () => {
        const firstVerseSlide: Slide = {
            ...bibleSlide,
            data: {
                version: 'KJV',
                labelShortFormat: '43:3:1',
            } as Scripture,
        }
        render(<BibleVerseNavigator currentSlide={firstVerseSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            const prevBtn = screen.getByTitle('Previous verses')
            expect(prevBtn).toBeDisabled()
        }, { timeout: 5000 })
    })

    it('enables next button for verse navigation', async () => {
        render(<BibleVerseNavigator currentSlide={bibleSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            const nextBtn = screen.getByTitle('Next verses')
            expect(nextBtn).not.toBeDisabled()
        }, { timeout: 5000 })
    })

    it('shows version buttons when versions are downloaded', async () => {
        mockIsVersionDownloaded.mockImplementation(async (v: string) => {
            return v === 'KJV' || v === 'NIV'
        })
        render(<BibleVerseNavigator currentSlide={bibleSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            const allButtons = document.querySelectorAll('button')
            const versionTexts = Array.from(allButtons).map(b => b.textContent?.trim())
            expect(versionTexts).toContain('KJV')
            expect(versionTexts).toContain('NIV')
        }, { timeout: 10000 })
    })

    it('renders a bible slide with chapter heading', async () => {
        const genesisSlide: Slide = {
            ...bibleSlide,
            data: {
                version: 'KJV',
                labelShortFormat: '1:1:1',
            } as Scripture,
        }
        render(<BibleVerseNavigator currentSlide={genesisSlide} onVerseSelect={vi.fn()} />)
        await waitFor(() => {
            expect(screen.getByText(/Genesis 1/)).toBeInTheDocument()
        }, { timeout: 5000 })
    })
})
