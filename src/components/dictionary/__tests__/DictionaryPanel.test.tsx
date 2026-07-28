import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictionaryPanel } from '../DictionaryPanel'
import type { DictionaryEntry, DictionaryPack } from '../../../types'

const EASTON: DictionaryPack = {
    id: 'easton',
    name: "Easton's Bible Dictionary",
    shortName: "Easton's",
    kind: 'bible',
    year: '1897',
    entryCount: 2,
    shards: ['a'],
    license: 'CC BY 4.0',
    attribution: "Easton's Bible Dictionary (1897), public domain. Structured text CC BY 4.0.",
}

const WEBSTER: DictionaryPack = {
    ...EASTON,
    id: 'webster',
    name: "Webster's Dictionary",
    shortName: 'Webster',
    kind: 'english',
    year: '1913',
    attribution: "Webster's Revised Unabridged Dictionary (1913), public domain.",
}

const AARON: DictionaryEntry = {
    key: 'AARON',
    word: 'Aaron',
    packId: 'easton',
    senses: [{ text: 'The eldest son of Amram and Jochebed.' }],
    refs: ['Exodus 4:14'],
}

const ABADDON: DictionaryEntry = {
    key: 'ABADDON',
    word: 'Abaddon',
    packId: 'easton',
    senses: [{ text: 'Destruction, the Hebrew name of Apollyon.' }],
}

const PROPITIATION: DictionaryEntry = {
    key: 'PROPITIATION',
    word: 'propitiation',
    packId: 'webster',
    senses: [{ text: 'The act of appeasing the wrath of an offended person.' }],
}

const ENTRIES = [AARON, ABADDON, PROPITIATION]

const loadIndex = vi.fn(async (packId: string) => ({
    packId,
    records: ENTRIES.filter((entry) => entry.packId === packId).map((entry) => ({
        key: entry.key,
        word: entry.word,
        search: entry.word.toLowerCase(),
        packId,
    })),
    byKey: new Map(
        ENTRIES.filter((entry) => entry.packId === packId)
            .map((entry) => [entry.key, {
                key: entry.key,
                word: entry.word,
                search: entry.word.toLowerCase(),
                packId,
            }]),
    ),
}))

const getEntry = vi.fn(async (packId: string, key: string) =>
    ENTRIES.find((entry) => entry.packId === packId && entry.key === key) ?? null)

let packs: DictionaryPack[] = [EASTON, WEBSTER]
let packsLoading = false

vi.mock('../../../hooks/useDictionary', () => ({
    useDictionary: () => ({ loadIndex, getEntry, loadManifest: vi.fn(), loadShard: vi.fn(), getEntries: vi.fn() }),
    useDictionaryPacks: () => ({ packs, loading: packsLoading }),
}))

const createDictionarySlides = vi.fn(() => [{ id: 'slide-1' }])
const createBibleSlide = vi.fn(() => ({ id: 'bible-slide-1' }))
const fetchScripture = vi.fn(async () => ({ label: 'Exodus 4:14', content: [] }))

vi.mock('../../../hooks', () => ({
    useSlideCreation: () => ({ createDictionarySlides, createBibleSlide }),
    useScripture: () => ({ fetchScripture }),
    useAnalytics: () => ({ trackEvent: vi.fn() }),
}))

const addToQueue = vi.fn()
const addAndGoLive = vi.fn()
let canGoLive = true

vi.mock('../../../hooks/useGoLive', () => ({
    useGoLive: () => ({ canGoLive, addToQueue, addAndGoLive, goLive: vi.fn() }),
}))

vi.mock('../../../hooks/useVoiceSearch', () => ({
    useVoiceSearch: () => ({
        isListening: false,
        isSupported: false,
        transcript: '',
        error: null,
        start: vi.fn(),
        stop: vi.fn(),
    }),
}))

vi.mock('../../templates/TemplateSelector', () => ({
    TemplateSelector: () => null,
}))

function search(term: string) {
    fireEvent.change(screen.getByLabelText('Search the dictionary'), { target: { value: term } })
}

describe('DictionaryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        packs = [EASTON, WEBSTER]
        packsLoading = false
        canGoLive = true
    })

    it('prompts for a word before anything is typed', () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        expect(screen.getByText('Search a word to define it on screen')).toBeInTheDocument()
    })

    it('explains itself when no packs are bundled', () => {
        packs = []
        render(<DictionaryPanel onClose={vi.fn()} />)
        expect(screen.getByText('No dictionaries installed')).toBeInTheDocument()
    })

    it('finds an entry and shows its definition snippet', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')

        expect(await screen.findByText('Aaron')).toBeInTheDocument()
        expect(await screen.findByText(/eldest son of Amram/)).toBeInTheDocument()
    })

    it('capitalises a lowercase headword in the results', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('propitiation')

        expect(await screen.findByText('Propitiation')).toBeInTheDocument()
    })

    it('searches only the selected pack once a filter chip is picked', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)

        // Webster's has "propitiation"; Easton's does not.
        fireEvent.click(screen.getByRole('button', { name: "Easton's" }))
        search('propitiation')
        expect(await screen.findByText(/No entries for/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Webster' }))
        expect(await screen.findByText('Propitiation')).toBeInTheDocument()
    })

    it('warms every pack index when it opens, so the first keystroke is instant', async () => {
        // Webster's index is ~1 MB and a second to parse; that second belongs
        // to opening the panel, not to the operator typing mid-service.
        render(<DictionaryPanel onClose={vi.fn()} />)

        await waitFor(() => {
            expect(loadIndex).toHaveBeenCalledWith('easton')
            expect(loadIndex).toHaveBeenCalledWith('webster')
        })
    })

    it('says so when nothing matches', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('zzzz')

        expect(await screen.findByText(/No entries for/)).toBeInTheDocument()
    })

    it('queues a definition from a result row without opening it', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')
        await screen.findByText('Aaron')

        fireEvent.click(screen.getByTitle('Add to queue'))

        await waitFor(() => expect(addToQueue).toHaveBeenCalledWith([{ id: 'slide-1' }]))
        expect(addAndGoLive).not.toHaveBeenCalled()
    })

    it('hides the live buttons when the operator cannot go live', async () => {
        canGoLive = false
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')
        await screen.findByText('Aaron')

        expect(screen.queryByTitle('Send to live output')).not.toBeInTheDocument()
    })

    it('opens an entry and shows its attribution', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')
        fireEvent.click(await screen.findByText('Aaron'))

        expect(await screen.findByText(/Structured text CC BY 4.0/)).toBeInTheDocument()
        expect(screen.getByText("Easton's Bible Dictionary (1897)")).toBeInTheDocument()
    })

    it('turns a cited scripture reference into a Bible slide', async () => {
        render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')
        fireEvent.click(await screen.findByText('Aaron'))

        fireEvent.click(await screen.findByRole('button', { name: 'Exodus 4:14' }))

        await waitFor(() => expect(fetchScripture).toHaveBeenCalledWith('2:4:14'))
        await waitFor(() => expect(addToQueue).toHaveBeenCalledWith([{ id: 'bible-slide-1' }]))
    })

    it('remembers a looked-up word for the next service', async () => {
        const { unmount } = render(<DictionaryPanel onClose={vi.fn()} />)
        search('aaron')
        fireEvent.click(await screen.findByText('Aaron'))
        await screen.findByText(/Structured text CC BY 4.0/)
        unmount()

        render(<DictionaryPanel onClose={vi.fn()} />)
        expect(screen.getByText('Recent lookups')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Aaron' })).toBeInTheDocument()
    })
})
