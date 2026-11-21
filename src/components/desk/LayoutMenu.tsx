import { useEffect, useRef, useState } from 'react'
import { LayoutDashboard, Check, Pencil, RotateCcw } from 'lucide-react'
import { DESK_PANELS, DESK_PANEL_ORDER } from './deskPanels'
import { hideDeskPanel, resetDeskLayout, showDeskPanel, useDeskStore } from './deskStore'

/**
 * The desk's one menu: Edit layout, the panels (open one, or close it while
 * editing), and Reset to Default.
 */
export function LayoutMenu() {
    const [open, setOpen] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false)
    const editing = useDeskStore((s) => s.editing)
    const setEditing = useDeskStore((s) => s.setEditing)
    const openPanels = useDeskStore((s) => s.openPanels)
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

    // Reset asks twice; closing the menu forgets the first ask.
    const [prevOpen, setPrevOpen] = useState(open)
    if (prevOpen !== open) {
        setPrevOpen(open)
        if (!open) setConfirmReset(false)
    }

    return (
        <div className="relative hidden sm:inline-flex phone:hidden" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`p-1.5 rounded-lg transition-all ${
                    editing
                        ? 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                        : open
                            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
                title="Layout"
            >
                <LayoutDashboard className="w-4 h-4" />
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Layout"
                    className="absolute right-0 top-full mt-1 w-60 rounded-xl bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] z-50 py-1 text-sm"
                >
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

                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                    <div className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        Panels
                    </div>
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

                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            if (!confirmReset) {
                                setConfirmReset(true)
                                return
                            }
                            resetDeskLayout()
                            setOpen(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] ${
                            confirmReset ? 'text-[var(--accent-rose)]' : 'text-[var(--text-primary)]'
                        }`}
                    >
                        <RotateCcw className="w-4 h-4" />
                        {confirmReset ? 'Click again to reset' : 'Reset to Default'}
                    </button>
                </div>
            )}
        </div>
    )
}
