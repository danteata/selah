import { useEffect, useRef, useState } from 'react'
import { LayoutDashboard, Check, Pencil, RotateCcw, Save, Trash2, Lock } from 'lucide-react'
import { DESK_PANELS, DESK_PANEL_ORDER } from './deskPanels'
import { BUILT_IN_LAYOUTS } from './deskLayouts'
import { MAX_LAYOUT_NAME, type BuiltInLayoutId } from './savedLayouts'
import {
    applyBuiltInLayout,
    applySavedLayout,
    deleteSavedLayout,
    hideDeskPanel,
    loadedLayoutName,
    renameSavedLayout,
    resetDeskLayout,
    saveLayout,
    saveLayoutAs,
    showDeskPanel,
    useDeskStore,
} from './deskStore'

const BUILT_IN_IDS = Object.keys(BUILT_IN_LAYOUTS) as BuiltInLayoutId[]

/** A step that asks twice before it throws something away. */
type Pending =
    | { kind: 'switch'; target: string }
    | { kind: 'delete'; id: string }
    | { kind: 'reset' }
    | null

/** Naming a layout, inline in the menu. */
type Naming = { kind: 'saveAs' } | { kind: 'rename'; id: string } | null

/**
 * The desk's one menu: switch layout, save it, Edit layout, the panels (open
 * one, or close it while editing), and Reset to Default.
 */
export function LayoutMenu() {
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState<Pending>(null)
    const [naming, setNaming] = useState<Naming>(null)
    const [name, setName] = useState('')
    const [nameError, setNameError] = useState<string | null>(null)
    const editing = useDeskStore((s) => s.editing)
    const setEditing = useDeskStore((s) => s.setEditing)
    const openPanels = useDeskStore((s) => s.openPanels)
    const savedLayouts = useDeskStore((s) => s.savedLayouts)
    const loaded = useDeskStore((s) => s.loaded)
    const modified = useDeskStore((s) => s.modified)
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    // Closing the menu forgets half-finished steps.
    const [prevOpen, setPrevOpen] = useState(open)
    if (prevOpen !== open) {
        setPrevOpen(open)
        if (!open) {
            setPending(null)
            setNaming(null)
            setNameError(null)
        }
    }

    const loadedName = loadedLayoutName(loaded, savedLayouts)
    const isLoaded = (kind: 'builtin' | 'saved', id: string) => loaded?.kind === kind && loaded.id === id

    // Switching away from changes nobody saved asks first.
    const switchTo = (target: string, apply: () => void) => {
        if (modified && !(pending?.kind === 'switch' && pending.target === target)) {
            setPending({ kind: 'switch', target })
            return
        }
        apply()
        setOpen(false)
    }

    const startNaming = (next: Naming, initial: string) => {
        setNaming(next)
        setName(initial)
        setNameError(null)
        setPending(null)
    }

    const submitName = () => {
        if (!naming) return
        const error = naming.kind === 'saveAs' ? saveLayoutAs(name) : renameSavedLayout(naming.id, name)
        if (error) {
            setNameError(error)
            return
        }
        setNaming(null)
        if (naming.kind === 'saveAs') setOpen(false)
    }

    const nameForm = (
        <form
            className="px-3 py-2 space-y-1.5"
            onSubmit={(e) => { e.preventDefault(); submitName() }}
        >
            <input
                autoFocus
                value={name}
                maxLength={MAX_LAYOUT_NAME}
                onChange={(e) => { setName(e.target.value); setNameError(null) }}
                placeholder="Layout name"
                aria-label="Layout name"
                className="w-full px-2 py-1.5 rounded-md text-sm bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-teal)]"
            />
            {nameError && <p className="text-[11px] text-[var(--accent-rose)]">{nameError}</p>}
            <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setNaming(null)} className="px-2 py-1 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
                    Cancel
                </button>
                <button type="submit" className="px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110">
                    Save
                </button>
            </div>
        </form>
    )

    const sectionLabel = (text: string) => (
        <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{text}</div>
    )
    const divider = <div className="my-1 border-t border-[var(--border-subtle)]" />
    const switchWarning = (target: string) =>
        pending?.kind === 'switch' && pending.target === target
            ? <span className="text-[11px] text-[var(--accent-rose)]">Unsaved changes. Click again to switch.</span>
            : null

    return (
        <div className="relative hidden sm:inline-flex phone:hidden" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`flex items-center gap-1.5 p-1.5 rounded-lg transition-all ${
                    editing
                        ? 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                        : open
                            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
                title={loadedName ? `Layout: ${loadedName}${modified ? ' (modified)' : ''}` : 'Layout'}
            >
                <LayoutDashboard className="w-4 h-4" />
                {loadedName && (
                    <span className="hidden xl:inline text-xs font-medium max-w-[9rem] truncate">
                        {loadedName}{modified ? ' •' : ''}
                    </span>
                )}
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Layout"
                    className="absolute right-0 top-full mt-1 w-64 max-h-[80vh] overflow-y-auto rounded-xl bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] z-50 py-1 text-sm"
                >
                    {sectionLabel('Layouts')}
                    {BUILT_IN_IDS.map((id) => (
                        <button
                            key={id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isLoaded('builtin', id)}
                            onClick={() => switchTo(`builtin:${id}`, () => applyBuiltInLayout(id))}
                            className="w-full flex flex-col items-stretch px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                        >
                            <span className="flex items-center gap-2">
                                <Lock className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden />
                                <span className="flex-1">{BUILT_IN_LAYOUTS[id].name}</span>
                                {isLoaded('builtin', id) && modified && <span className="text-[10px] text-[var(--accent-amber)]">modified</span>}
                                {isLoaded('builtin', id) && <Check className="w-4 h-4 text-[var(--accent-teal)]" />}
                            </span>
                            {switchWarning(`builtin:${id}`)}
                        </button>
                    ))}

                    {savedLayouts.map((layout) => {
                        if (naming?.kind === 'rename' && naming.id === layout.id) return <div key={layout.id}>{nameForm}</div>
                        const current = isLoaded('saved', layout.id)
                        const confirmingDelete = pending?.kind === 'delete' && pending.id === layout.id
                        return (
                            <div key={layout.id} className="group flex items-start hover:bg-[var(--bg-tertiary)]">
                                <button
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={current}
                                    onClick={() => switchTo(`saved:${layout.id}`, () => { applySavedLayout(layout.id) })}
                                    className="flex-1 min-w-0 flex flex-col items-stretch px-3 py-1.5 text-left text-[var(--text-primary)]"
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="w-3.5" aria-hidden />
                                        <span className="flex-1 truncate">{layout.name}</span>
                                        {current && modified && <span className="text-[10px] text-[var(--accent-amber)]">modified</span>}
                                        {current && <Check className="w-4 h-4 text-[var(--accent-teal)]" />}
                                    </span>
                                    {switchWarning(`saved:${layout.id}`)}
                                    {confirmingDelete && (
                                        <span className="text-[11px] text-[var(--accent-rose)]">Click the bin again to delete.</span>
                                    )}
                                </button>
                                <div className="flex items-center pr-2 pt-1.5 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                                    <button
                                        type="button"
                                        onClick={() => startNaming({ kind: 'rename', id: layout.id }, layout.name)}
                                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                        aria-label={`Rename ${layout.name}`}
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!confirmingDelete) {
                                                setPending({ kind: 'delete', id: layout.id })
                                                return
                                            }
                                            deleteSavedLayout(layout.id)
                                            setPending(null)
                                        }}
                                        className={`p-1 rounded hover:text-[var(--accent-rose)] ${confirmingDelete ? 'text-[var(--accent-rose)]' : 'text-[var(--text-muted)]'}`}
                                        aria-label={`Delete ${layout.name}`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        )
                    })}

                    {naming?.kind === 'saveAs' ? nameForm : (
                        <div className="flex gap-1 px-2 pt-1">
                            <button
                                type="button"
                                role="menuitem"
                                disabled={loaded?.kind !== 'saved' || !modified}
                                title={loaded?.kind === 'builtin' ? 'Built-in layouts can only be saved as a copy' : undefined}
                                onClick={() => { saveLayout(); setOpen(false) }}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] disabled:hover:bg-transparent disabled:cursor-default"
                            >
                                <Save className="w-3.5 h-3.5" />
                                Save
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => startNaming({ kind: 'saveAs' }, '')}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                            >
                                Save as…
                            </button>
                        </div>
                    )}

                    {divider}
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={editing}
                        onClick={() => { setEditing(!editing); setOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    >
                        <Pencil className="w-4 h-4 text-[var(--text-muted)]" />
                        <span className="flex-1">Edit layout</span>
                        {editing && <Check className="w-4 h-4 text-[var(--accent-amber)]" />}
                    </button>

                    {divider}
                    {sectionLabel('Panels')}
                    {DESK_PANEL_ORDER.map((id) => {
                        const def = DESK_PANELS[id]
                        const isOpen = openPanels.includes(id)
                        // Opening is always safe; closing needs Edit layout, and
                        // Live never closes.
                        const disabled = isOpen && (!def.closable || !editing)
                        const title = !def.closable
                            ? 'Live is always on the desk'
                            : isOpen && !editing
                                ? 'Turn on Edit layout to close panels'
                                : undefined
                        const Icon = def.icon
                        return (
                            <button
                                key={id}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={isOpen}
                                disabled={disabled}
                                title={title}
                                onClick={() => (isOpen ? hideDeskPanel(id) : showDeskPanel(id))}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] disabled:hover:bg-transparent disabled:cursor-default"
                            >
                                <Icon className="w-4 h-4 text-[var(--text-muted)]" />
                                <span className="flex-1">{def.title}</span>
                                {isOpen && <Check className={`w-4 h-4 ${disabled ? 'text-[var(--text-muted)]' : 'text-[var(--accent-teal)]'}`} />}
                            </button>
                        )
                    })}

                    {divider}
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            if (pending?.kind !== 'reset') {
                                setPending({ kind: 'reset' })
                                return
                            }
                            resetDeskLayout()
                            setOpen(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] ${
                            pending?.kind === 'reset' ? 'text-[var(--accent-rose)]' : 'text-[var(--text-primary)]'
                        }`}
                    >
                        <RotateCcw className="w-4 h-4" />
                        {pending?.kind === 'reset' ? 'Click again to reset' : 'Reset to Default'}
                    </button>
                </div>
            )}
        </div>
    )
}
