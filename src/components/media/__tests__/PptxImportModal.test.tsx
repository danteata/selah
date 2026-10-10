import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { PptxImportResult } from '../../../lib/import/pptxToSlides'
import type { Slide } from '../../../types'

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(),
    isDesktop: vi.fn(() => true),
    dialogOpen: vi.fn(),
    isPro: { value: true },
    createPptxSlides: vi.fn(),
    createSchedule: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('../../../platform', () => ({
    isDesktop: mocks.isDesktop,
    platform: { dialog: { open: mocks.dialogOpen } },
}))
vi.mock('../../../providers/LicenseProvider', () => ({
    useEntitlements: () => ({
        isPro: mocks.isPro.value,
        loading: false,
        startProCheckout: vi.fn(),
        redeemComp: vi.fn(),
        validatePromo: vi.fn(),
    }),
}))
vi.mock('../../../hooks/useSlideCreation', () => ({
    useSlideCreation: () => ({ createPptxSlides: mocks.createPptxSlides }),
}))
vi.mock('../../../hooks/useSchedules', () => ({
    useSchedules: () => ({ createSchedule: mocks.createSchedule, churchId: 'church-1' }),
}))
vi.mock('../../../hooks/useLocalBackground', () => ({
    resolveLocalUrl: (url: string) => url,
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { PptxImportModal } from '../PptxImportModal'
import { useAppStore } from '../../../store/appStore'

const result: PptxImportResult = {
    deckName: 'Sunday Service',
    aspect: 1.778,
    warnings: [],
    slides: [
        {
            index: 0,
            hidden: false,
            title: 'Amazing Grace',
            paragraphs: [{ align: 'center', level: 0, bullet: 'none', runs: [{ text: 'Amazing Grace', b: false, i: false, u: false }] }],
            background: { kind: 'color', color: '#1f3864' },
            warnings: [],
        },
        {
            index: 1,
            hidden: true,
            paragraphs: [{ align: 'left', level: 0, bullet: 'none', runs: [{ text: '<b>Chorus</b>', b: false, i: false, u: false }] }],
            background: { kind: 'none' },
            warnings: ['Left out a chart'],
        },
        {
            index: 2,
            hidden: false,
            paragraphs: [{ align: 'center', level: 0, bullet: 'none', runs: [{ text: 'Ɛyɛ me dɛ', b: false, i: false, u: false }] }],
            background: { kind: 'none' },
            warnings: [],
        },
    ],
}

function slide(id: string): Slide {
    return { id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: 'sched-1', contents: ['<p>x</p>'] }
}

/** invoke() for each command; pptx_import resolves when the test says. */
function setupInvoke(caps = { editable: true, images: false }) {
    let resolveImport!: (r: PptxImportResult) => void
    let rejectImport!: (e: unknown) => void
    mocks.invoke.mockImplementation((cmd: string) => {
        if (cmd === 'pptx_import_capabilities') return Promise.resolve(caps)
        if (cmd === 'pptx_import') {
            return new Promise((res, rej) => {
                resolveImport = res
                rejectImport = rej
            })
        }
        return Promise.resolve(undefined)
    })
    return {
        resolve: (r: PptxImportResult) => act(async () => resolveImport(r)),
        reject: (e: unknown) => act(async () => rejectImport(e)),
    }
}

let progressHandler: ((e: { payload: unknown }) => void) | null = null
const unlisten = vi.fn()

function importArgs() {
    const call = mocks.invoke.mock.calls.find(([cmd]) => cmd === 'pptx_import')
    return call?.[1] as { path: string; mode: string; importId: string }
}

async function pickFile() {
    fireEvent.click(await screen.findByRole('button', { name: /choose a powerpoint file/i }))
    await waitFor(() => expect(importArgs()).toBeDefined())
}

describe('PptxImportModal', () => {
    const onClose = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.isDesktop.mockReturnValue(true)
        mocks.isPro.value = true
        mocks.dialogOpen.mockResolvedValue('/home/op/Sunday Service.pptx')
        mocks.createPptxSlides.mockReturnValue([slide('a'), slide('b')])
        mocks.createSchedule.mockResolvedValue('new-sched')
        progressHandler = null
        mocks.listen.mockImplementation(async (_event: string, handler: (e: { payload: unknown }) => void) => {
            progressHandler = handler
            return unlisten
        })
        useAppStore.getState().signOut()
        useAppStore.setState({
            activeSchedule: { _id: 'sched-1', name: 'Sunday', authorId: '', editorIds: [], churchId: 'church-1' },
            activeSlides: [],
            liveOutputSlidesId: [],
        })
    })

    it('says it needs the desktop app on the web', () => {
        mocks.isDesktop.mockReturnValue(false)
        render(<PptxImportModal isOpen onClose={onClose} />)
        expect(screen.getByText('Available in Selah desktop')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /choose/i })).toBeNull()
        expect(mocks.invoke).not.toHaveBeenCalled()
    })

    it('shows the Pro upsell to free users instead of the importer', async () => {
        mocks.isPro.value = false
        setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        expect(await screen.findByText(/PowerPoint import is a Pro feature/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /choose a powerpoint file/i })).toBeNull()
    })

    it('offers pictures mode only when the build can render', async () => {
        setupInvoke({ editable: true, images: false })
        const { unmount } = render(<PptxImportModal isOpen onClose={onClose} />)
        await screen.findByRole('button', { name: /choose a powerpoint file/i })
        expect(screen.getByText('Editable slides')).toBeInTheDocument()
        expect(screen.queryByText('Pictures')).toBeNull()
        unmount()

        setupInvoke({ editable: true, images: true })
        render(<PptxImportModal isOpen onClose={onClose} />)
        expect(await screen.findByText('Pictures')).toBeInTheDocument()
    })

    it('imports, shows progress and a preview, then adds the chosen slides to the open schedule', async () => {
        const ctl = setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        await pickFile()

        expect(mocks.dialogOpen).toHaveBeenCalledWith(
            expect.objectContaining({ filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppsx', 'potx'] }] }),
        )
        const args = importArgs()
        expect(args).toMatchObject({ path: '/home/op/Sunday Service.pptx', mode: 'editable' })
        expect(screen.getByText('Sunday Service.pptx')).toBeInTheDocument()

        // Progress for another import is ignored; this one's shows.
        act(() => progressHandler?.({ payload: { importId: 'other', stage: 'rendering', done: 0, total: 1 } }))
        act(() => progressHandler?.({ payload: { importId: args.importId, stage: 'converting', done: 1, total: 4 } }))
        expect(screen.getByText('Converting the slides…')).toBeInTheDocument()
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')

        await ctl.resolve(result)
        expect(unlisten).toHaveBeenCalled()
        expect(await screen.findByText('3 slides · 16:9')).toBeInTheDocument()
        expect(screen.getByText('Include 1 hidden slide')).toBeInTheDocument()
        expect(screen.getByLabelText('Left out a chart')).toBeInTheDocument()
        expect(screen.getByText('Adds to “Sunday”')).toBeInTheDocument()

        // Previews render the escaped HTML: the deck's "<b>" is text, not markup.
        const list = screen.getByRole('list', { name: 'Slides to import' })
        expect(list.querySelector('b')).toBeNull()
        expect(list.textContent).toContain('<b>Chorus</b>')
        expect(list.textContent).toContain('Ɛyɛ me dɛ')

        fireEvent.click(screen.getByRole('button', { name: 'Add 2 slides' }))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(mocks.createPptxSlides).toHaveBeenCalledWith(result, { mode: 'editable', includeHidden: false, scheduleId: 'sched-1' })
        expect(mocks.createSchedule).not.toHaveBeenCalled()
        expect(useAppStore.getState().activeSlides.map((s) => s.id)).toEqual(['a', 'b'])
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Added 2 slides from Sunday Service')
    })

    it('includes hidden slides when asked', async () => {
        const ctl = setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        await pickFile()
        await ctl.resolve(result)
        fireEvent.click(await screen.findByLabelText('Include 1 hidden slide'))
        fireEvent.click(screen.getByRole('button', { name: 'Add 3 slides' }))
        await waitFor(() => expect(mocks.createPptxSlides).toHaveBeenCalled())
        expect(mocks.createPptxSlides.mock.calls[0][1]).toMatchObject({ includeHidden: true })
    })

    it('creates a schedule named after the deck when none is open', async () => {
        useAppStore.setState({ activeSchedule: null })
        const ctl = setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        await pickFile()
        await ctl.resolve(result)
        expect(await screen.findByText('Creates the schedule “Sunday Service”')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Add 2 slides' }))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(mocks.createSchedule).toHaveBeenCalledWith('Sunday Service')
        expect(mocks.createPptxSlides.mock.calls[0][1]).toMatchObject({ scheduleId: 'new-sched' })
        expect(useAppStore.getState().activeSchedule?._id).toBe('new-sched')
    })

    it('shows the reader’s error and lets the operator pick another file', async () => {
        const ctl = setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        await pickFile()
        await ctl.reject({ kind: 'encrypted', message: 'This presentation is password-protected.' })
        expect(await screen.findByRole('alert')).toHaveTextContent('This presentation is password-protected.')
        expect(screen.getByRole('button', { name: /choose another file/i })).toBeInTheDocument()
    })

    it('cancels the import in flight', async () => {
        const ctl = setupInvoke()
        render(<PptxImportModal isOpen onClose={onClose} />)
        await pickFile()
        const { importId } = importArgs()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(mocks.invoke).toHaveBeenCalledWith('pptx_import_cancel', { importId })
        await ctl.reject({ kind: 'cancelled', message: 'The import was cancelled.' })
        // Back to the start, not an error.
        expect(await screen.findByRole('button', { name: /choose a powerpoint file/i })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('does nothing when the file dialog is dismissed', async () => {
        setupInvoke()
        mocks.dialogOpen.mockResolvedValue(null)
        render(<PptxImportModal isOpen onClose={onClose} />)
        fireEvent.click(await screen.findByRole('button', { name: /choose a powerpoint file/i }))
        await waitFor(() => expect(mocks.dialogOpen).toHaveBeenCalled())
        expect(importArgs()).toBeUndefined()
    })
})
