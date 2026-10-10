import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, EyeOff, FileUp, Image as ImageIcon, Loader2, Type, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '../modals/Modal'
import { ProGate } from '../licensing/ProGate'
import { isDesktop, platform } from '../../platform'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation } from '../../hooks/useSlideCreation'
import { useSchedules } from '../../hooks/useSchedules'
import { resolveLocalUrl } from '../../hooks/useLocalBackground'
import { slideBodyHtml } from '../../utils/slideHtml'
import { cssFontStack } from '../../lib/fonts'
import {
    PPTX_EXTENSIONS,
    buildPptxSlides,
    selectedPptxSlides,
    type PptxImportError,
    type PptxImportMode,
    type PptxImportProgress,
    type PptxImportResult,
} from '../../lib/import/pptxToSlides'
import {
    asPptxImportError,
    cancelPptxImport,
    getPptxCapabilities,
    newPptxImportId,
    runPptxImport,
    type PptxCapabilities,
} from '../../services/pptxImport'
import type { Slide } from '../../types'

interface PptxImportModalProps {
    isOpen: boolean
    onClose: () => void
}

type Phase =
    | { kind: 'idle' }
    | { kind: 'importing'; fileName: string; importId: string; progress: PptxImportProgress | null }
    | { kind: 'review'; result: PptxImportResult; mode: PptxImportMode }
    | { kind: 'error'; error: PptxImportError }

const STAGE_LABEL: Record<PptxImportProgress['stage'], string> = {
    checking: 'Checking the file…',
    reading: 'Reading the slides…',
    converting: 'Converting the slides…',
    rendering: 'Drawing the slides…',
}

function fileNameOf(path: string): string {
    return path.split(/[\\/]/).pop() || path
}

/** A plain base for previews; the real slides get Selah's defaults on import. */
function previewBase(): Slide {
    return {
        id: '',
        index: 0,
        name: '',
        type: 'text',
        layout: 'full-text',
        contents: [],
        userId: '',
        churchId: '',
        scheduleId: '',
        slideStyle: {},
    }
}

function previewBackground(slide: Slide): React.CSSProperties {
    if (slide.backgroundType === 'color' || slide.backgroundType === 'gradient') {
        return { background: slide.background }
    }
    if (slide.backgroundType === 'image' && slide.background) {
        const url = resolveLocalUrl(slide.background, slide.localFilePath)
        return {
            backgroundImage: `url("${url.replace(/["\\]/g, '\\$&')}")`,
            backgroundSize: slide.slideStyle?.backgroundFillType === 'fit' ? 'contain' : 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundColor: '#000',
        }
    }
    return { background: '#111827' }
}

/**
 * Import a PowerPoint deck: pick a file, watch it convert, review what came
 * out (and what was left out), then add the slides to the open schedule — or
 * to a new one named after the deck when none is open.
 *
 * Desktop only (the reader is native), and a Pro feature like Add Media.
 */
export function PptxImportModal({ isOpen, onClose }: PptxImportModalProps) {
    const desktop = isDesktop()
    const [capabilities, setCapabilities] = useState<PptxCapabilities | null>(null)
    const [mode, setMode] = useState<PptxImportMode>('editable')
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
    const [includeHidden, setIncludeHidden] = useState(false)
    const [adding, setAdding] = useState(false)

    const activeSchedule = useAppStore((s) => s.activeSchedule)
    const appendActiveSlides = useAppStore((s) => s.appendActiveSlides)
    const setActiveSchedule = useAppStore((s) => s.setActiveSchedule)
    const defaultFont = useAppStore((s) => s.settings.defaultFont)
    const { createPptxSlides } = useSlideCreation()
    const { createSchedule, churchId } = useSchedules()

    // The import in flight, so closing the dialog can stop it.
    const runningRef = useRef<string | null>(null)

    useEffect(() => {
        if (!isOpen || !desktop) return
        let cancelled = false
        void getPptxCapabilities().then((caps) => {
            if (!cancelled) setCapabilities(caps)
        })
        return () => {
            cancelled = true
        }
    }, [isOpen, desktop])

    useEffect(() => () => {
        if (runningRef.current) void cancelPptxImport(runningRef.current)
    }, [])

    const handleClose = () => {
        if (runningRef.current) void cancelPptxImport(runningRef.current)
        onClose()
    }

    const chooseFile = async () => {
        const picked = await platform.dialog.open({
            title: 'Import PowerPoint',
            filters: [{ name: 'PowerPoint', extensions: PPTX_EXTENSIONS }],
        })
        const path = Array.isArray(picked) ? picked[0] : picked
        if (!path) return

        const importId = newPptxImportId()
        runningRef.current = importId
        setPhase({ kind: 'importing', fileName: fileNameOf(path), importId, progress: null })
        try {
            const result = await runPptxImport(path, mode, importId, (progress) => {
                setPhase((p) => (p.kind === 'importing' && p.importId === importId ? { ...p, progress } : p))
            })
            if (runningRef.current !== importId) return
            setIncludeHidden(false)
            setPhase({ kind: 'review', result, mode })
        } catch (error) {
            if (runningRef.current !== importId) return
            const e = asPptxImportError(error)
            setPhase(e.kind === 'cancelled' ? { kind: 'idle' } : { kind: 'error', error: e })
        } finally {
            if (runningRef.current === importId) runningRef.current = null
        }
    }

    const cancelImport = () => {
        if (phase.kind !== 'importing') return
        void cancelPptxImport(phase.importId)
    }

    const review = phase.kind === 'review' ? phase : null
    const previews = useMemo(
        () => (review ? buildPptxSlides(review.result, { mode: review.mode, includeHidden: true, makeBase: previewBase }) : []),
        [review],
    )
    const chosenCount = review ? selectedPptxSlides(review.result, includeHidden).length : 0
    const hiddenCount = review ? review.result.slides.filter((s) => s.hidden).length : 0

    const addSlides = async () => {
        if (!review || chosenCount === 0) return
        setAdding(true)
        try {
            let scheduleId = activeSchedule?._id
            if (!scheduleId) {
                const name = review.result.deckName || 'Imported presentation'
                scheduleId = await createSchedule(name)
                // Offline creation already made it active; online, Convex returns the id only.
                if (scheduleId && useAppStore.getState().activeSchedule?._id !== scheduleId) {
                    const now = new Date().toISOString()
                    setActiveSchedule({ _id: scheduleId, name, authorId: '', editorIds: [], churchId, createdAt: now, updatedAt: now })
                }
            }
            const slides = createPptxSlides(review.result, { mode: review.mode, includeHidden, scheduleId })
            appendActiveSlides(slides)
            toast.success(`Added ${slides.length} ${slides.length === 1 ? 'slide' : 'slides'} from ${review.result.deckName}`)
            onClose()
        } catch (error) {
            toast.error('Couldn’t add the slides', { description: error instanceof Error ? error.message : String(error) })
        } finally {
            setAdding(false)
        }
    }

    if (!isOpen) return null

    const imagesAvailable = !!capabilities?.images
    const unsupported = desktop && capabilities !== null && !capabilities.editable

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            labelledBy="pptx-import-title"
            closeOnBackdrop={phase.kind !== 'importing'}
            className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
        >
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <h3 id="pptx-import-title" className="font-semibold text-[var(--text-primary)]">
                    Import PowerPoint
                </h3>
                <button
                    aria-label="Close"
                    onClick={handleClose}
                    className="ml-auto p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {!desktop ? (
                    <div className="rounded-lg bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                        <p className="font-medium text-[var(--text-primary)]">Available in Selah desktop</p>
                        <p className="mt-1">
                            PowerPoint files are read on your computer, so importing them needs the desktop app.
                        </p>
                    </div>
                ) : (
                    <ProGate feature="PowerPoint import">
                        {unsupported ? (
                            <p className="text-sm text-[var(--text-secondary)]">
                                This build of Selah was made without PowerPoint import. Releases include it, so
                                reinstall from the standard download.
                            </p>
                        ) : phase.kind === 'idle' || phase.kind === 'error' ? (
                            <div className="space-y-4">
                                <fieldset className="grid gap-2 sm:grid-cols-2">
                                    <legend className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Import as</legend>
                                    <ModeOption
                                        checked={mode === 'editable'}
                                        onChange={() => setMode('editable')}
                                        icon={<Type className="w-4 h-4" />}
                                        title="Editable slides"
                                        desc="Text, backgrounds and speaker notes, ready to edit. Pictures, charts and video are left out."
                                    />
                                    {imagesAvailable && (
                                        <ModeOption
                                            checked={mode === 'images'}
                                            onChange={() => setMode('images')}
                                            icon={<ImageIcon className="w-4 h-4" />}
                                            title="Pictures"
                                            desc="Each slide drawn as it was designed. Exact, but not editable."
                                        />
                                    )}
                                </fieldset>
                                {phase.kind === 'error' && (
                                    <div role="alert" className="flex gap-2 rounded-lg border border-red-300/60 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                                        <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0" />
                                        <p>{phase.error.message}</p>
                                    </div>
                                )}
                                <button
                                    onClick={() => void chooseFile()}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg"
                                >
                                    <FileUp className="w-4 h-4" />
                                    {phase.kind === 'error' ? 'Choose another file…' : 'Choose a PowerPoint file…'}
                                </button>
                                <p className="text-xs text-[var(--text-muted)]">.pptx, .ppsx or .potx. Older .ppt files need saving as .pptx first.</p>
                            </div>
                        ) : phase.kind === 'importing' ? (
                            <ImportProgress fileName={phase.fileName} progress={phase.progress} onCancel={cancelImport} />
                        ) : (
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                    <p className="font-medium text-[var(--text-primary)]">{phase.result.deckName}</p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        {phase.result.slides.length} {phase.result.slides.length === 1 ? 'slide' : 'slides'}
                                        {phase.result.aspect < 1.5 ? ' · 4:3' : ' · 16:9'}
                                    </p>
                                </div>
                                {phase.result.warnings.map((w) => (
                                    <p key={w} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
                                ))}
                                {hiddenCount > 0 && (
                                    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                                        <input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} />
                                        Include {hiddenCount} hidden {hiddenCount === 1 ? 'slide' : 'slides'}
                                    </label>
                                )}
                                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Slides to import">
                                    {phase.result.slides.map((s, i) => {
                                        const preview = previews[i]
                                        const skipped = s.hidden && !includeHidden
                                        return (
                                            <li key={s.index} className={skipped ? 'opacity-40' : ''}>
                                                <SlidePreview slide={preview} defaultFont={defaultFont} />
                                                <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                                                    <span className="tabular-nums text-[var(--text-muted)]">{s.index + 1}</span>
                                                    <span className="truncate">{preview?.name}</span>
                                                    {s.hidden && <EyeOff className="w-3 h-3 flex-shrink-0" aria-label="Hidden slide" />}
                                                    {s.warnings.length > 0 && (
                                                        <span className="ml-auto flex-shrink-0 text-amber-600 dark:text-amber-400" title={s.warnings.join('\n')}>
                                                            <AlertTriangle className="w-3 h-3" aria-label={s.warnings.join('. ')} />
                                                        </span>
                                                    )}
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        )}
                    </ProGate>
                )}
            </div>

            {review && (
                <div className="flex items-center gap-3 p-4 border-t border-[var(--border-subtle)]">
                    <p className="text-xs text-[var(--text-muted)] truncate">
                        {activeSchedule ? `Adds to “${activeSchedule.name}”` : `Creates the schedule “${review.result.deckName}”`}
                    </p>
                    <button
                        onClick={() => setPhase({ kind: 'idle' })}
                        className="ml-auto px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg"
                    >
                        Back
                    </button>
                    <button
                        onClick={() => void addSlides()}
                        disabled={adding || chosenCount === 0}
                        className="px-4 py-2 text-sm font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110 disabled:opacity-50 rounded-lg"
                    >
                        {adding ? 'Adding…' : `Add ${chosenCount} ${chosenCount === 1 ? 'slide' : 'slides'}`}
                    </button>
                </div>
            )}
        </Modal>
    )
}

function ModeOption({ checked, onChange, icon, title, desc }: {
    checked: boolean
    onChange: () => void
    icon: React.ReactNode
    title: string
    desc: string
}) {
    return (
        <label
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${checked
                ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5'
                : 'border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]'
                }`}
        >
            <input type="radio" name="pptx-mode" checked={checked} onChange={onChange} className="sr-only" />
            <span className="mt-0.5 text-[var(--accent-teal)]">{icon}</span>
            <span>
                <span className="block text-sm font-medium text-[var(--text-primary)]">{title}</span>
                <span className="block text-xs text-[var(--text-muted)]">{desc}</span>
            </span>
        </label>
    )
}

function ImportProgress({ fileName, progress, onCancel }: {
    fileName: string
    progress: PptxImportProgress | null
    onCancel: () => void
}) {
    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
    return (
        <div className="space-y-3" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="truncate">{fileName}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{progress ? STAGE_LABEL[progress.stage] : 'Opening…'}</p>
            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
            >
                <div className="h-full bg-[var(--accent-teal)] transition-[width]" style={{ width: `${pct ?? 5}%` }} />
            </div>
            <button
                onClick={onCancel}
                className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg"
            >
                Cancel
            </button>
        </div>
    )
}

/**
 * A small, static look at a slide: its background and text in the slide's
 * font and alignment. The HTML is the import's own, escaped and allowlisted
 * in pptxToSlides.
 */
function SlidePreview({ slide, defaultFont }: { slide: Slide | undefined; defaultFont: string }) {
    if (!slide) return <div className="aspect-video rounded-md bg-[var(--bg-tertiary)]" />
    const html = slide.contents[0]
    return (
        <div className="relative aspect-video overflow-hidden rounded-md border border-[var(--border-subtle)]" style={previewBackground(slide)}>
            {html && (
                <div
                    className="absolute inset-[8%] overflow-hidden text-[7px] leading-tight text-white tiptap-preview [&_p]:m-0"
                    style={{
                        fontFamily: cssFontStack(slide.slideStyle?.font || defaultFont),
                        textAlign: (slide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                    }}
                    dangerouslySetInnerHTML={{ __html: slideBodyHtml(html) }}
                />
            )}
        </div>
    )
}
