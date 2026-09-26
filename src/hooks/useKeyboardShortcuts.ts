import { useEffect, useCallback, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'

interface ShortcutOptions {
    ctrlOrMeta?: boolean
    shift?: boolean
    alt?: boolean
    preventDefault?: boolean
    ignoreInputFocus?: boolean
}

const TYPING_ROLES = new Set(['textbox', 'combobox', 'listbox', 'menu', 'menuitem', 'slider', 'spinbutton', 'option'])

/**
 * Whether keys pressed now belong to whatever has focus rather than to us: a
 * text field, a select (its arrow keys change the value), or an ARIA widget
 * that handles arrows itself.
 */
function isInputElementFocused(): boolean {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true
    const role = el.getAttribute('role')
    return !!role && TYPING_ROLES.has(role)
}

/**
 * A modal, the command palette, or any `aria-modal` dialog is up. The quick
 * Bible bar is left out on purpose: it drives verse navigation itself.
 */
function isOverlayOpen(): boolean {
    const state = useAppStore.getState()
    if (state.commandBarOpen) return true
    if (Object.values(state.modals ?? {}).some(Boolean)) return true
    return typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]')
}

/**
 * The one test every global shortcut applies before acting.
 *
 * These keys change what the congregation sees, so err towards not firing.
 * Before this, ↑/↓ in a Settings dropdown also moved the projector, a list
 * that handled the arrow itself still let it through, holding ↓ raced through
 * the service, and "B" typed while recording a hotkey blanked the screen.
 */
export function shouldIgnoreShortcut(event: KeyboardEvent, { ignoreInputFocus = false } = {}): boolean {
    if (event.defaultPrevented || event.repeat) return true
    if (!ignoreInputFocus && isInputElementFocused()) return true
    return isOverlayOpen()
}

// ---------------------------------------------------------------------------
// Who answers ↑/↓ and the verse keys
// ---------------------------------------------------------------------------

let liveNavigationClaims = 0

/**
 * LiveOutput steps the operator's deck with ↑/↓ while it is mounted; the
 * Dashboard's schedule-order fallback checks this and stands down. Both used
 * to act on the same key press — two live-slide changes, two mutations, and in
 * a session, two different "next" slides.
 */
export function useClaimLiveNavigation(active = true) {
    useEffect(() => {
        if (!active) return
        liveNavigationClaims++
        return () => { liveNavigationClaims-- }
    }, [active])
}

export function isLiveNavigationClaimed(): boolean {
    return liveNavigationClaims > 0
}

export const VERSE_NAV_PRIORITY = { preview: 1, live: 2, quickBible: 3 } as const

const verseNavOwners: Array<{ id: symbol; priority: number }> = []

function isTopVerseOwner(id: symbol): boolean {
    let top: { id: symbol; priority: number } | null = null
    for (const owner of verseNavOwners) {
        if (!top || owner.priority > top.priority) top = owner
    }
    return top?.id === id
}

export function useKeyboardShortcut(
    key: string,
    callback: () => void,
    options: ShortcutOptions = {}
) {
    const callbackRef = useRef(callback)

    useEffect(() => {
        callbackRef.current = callback
    }, [callback])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (shouldIgnoreShortcut(event, { ignoreInputFocus: options.ignoreInputFocus })) return

            const keyMatches = event.key.toLowerCase() === key.toLowerCase()
            const ctrlMatches = options.ctrlOrMeta
                ? (event.ctrlKey || event.metaKey)
                : !(event.ctrlKey || event.metaKey)
            const shiftMatches = options.shift !== undefined
                ? event.shiftKey === options.shift
                : true
            const altMatches = options.alt !== undefined
                ? event.altKey === options.alt
                : true

            if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
                if (options.preventDefault !== false) {
                    event.preventDefault()
                }
                callbackRef.current()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [key, options.ctrlOrMeta, options.shift, options.alt, options.preventDefault, options.ignoreInputFocus])
}

// Hook for multiple shortcuts
export function useKeyboardShortcuts(
    shortcuts: Array<{
        key: string
        /** Return `false` to decline the press, leaving it for another handler. */
        callback: () => void | boolean
        options?: ShortcutOptions
    }>
) {
    const shortcutsRef = useRef(shortcuts)

    useEffect(() => {
        shortcutsRef.current = shortcuts
    }, [shortcuts])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (shouldIgnoreShortcut(event)) return

            shortcutsRef.current.forEach(({ key, callback, options = {} }) => {
                if (options.ignoreInputFocus === true) return // skip ones that opted out of the global guard

                const keyMatches = event.key.toLowerCase() === key.toLowerCase()
                const ctrlMatches = options.ctrlOrMeta
                    ? (event.ctrlKey || event.metaKey)
                    : !(event.ctrlKey || event.metaKey)
                const shiftMatches = options.shift !== undefined
                    ? event.shiftKey === options.shift
                    : true
                const altMatches = options.alt !== undefined
                    ? event.altKey === options.alt
                    : true

                if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
                    // A declined press is not prevented, so the handler it was
                    // left for doesn't mistake it for one already dealt with.
                    if (callback() === false) return
                    if (options.preventDefault !== false) {
                        event.preventDefault()
                    }
                }
            })
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])
}

// Hook specifically for slide navigation shortcuts
export function useSlideNavigationShortcuts(
    onNextSlide: () => void,
    onPrevSlide: () => void,
    onGoLive?: () => void,
    onOpenSettings?: () => void,
    onUndo?: () => void,
    onRedo?: () => void
) {
    useKeyboardShortcuts([
        // Navigate to next slide (Arrow Down)
        { key: 'ArrowDown', callback: onNextSlide },
        // Navigate to previous slide (Arrow Up)
        { key: 'ArrowUp', callback: onPrevSlide },
        // Present output (Ctrl/Cmd + P)
        ...(onGoLive ? [{ key: 'p', callback: onGoLive, options: { ctrlOrMeta: true } }] : []),
        // Open settings (Ctrl/Cmd + Comma)
        ...(onOpenSettings ? [{ key: ',', callback: onOpenSettings, options: { ctrlOrMeta: true } }] : []),
        // Undo (Ctrl/Cmd + Z)
        ...(onUndo ? [{ key: 'z', callback: onUndo, options: { ctrlOrMeta: true } }] : []),
        // Redo (Ctrl/Cmd + Y)
        ...(onRedo ? [{ key: 'y', callback: onRedo, options: { ctrlOrMeta: true } }] : []),
    ])
}

// Hook specifically for verse navigation shortcuts (used in LiveOutput,
// PreviewContent, QuickBibleBar). Bound to N/P and LeftArrow/RightArrow so it
// does NOT collide with the global ArrowUp/ArrowDown slide-queue navigation.
//
// Only the highest-priority enabled caller answers a press. All three used to:
// with a Bible slide both live and previewed, one → stepped the live verse and
// the preview's stale copy of the same slide, and whichever fetch finished last
// decided what the projector showed.
export function useVerseNavigationShortcuts(
    onNextVerse: () => void,
    onPrevVerse: () => void,
    options: { enabled?: boolean; preventDefault?: boolean; priority?: number } = {}
) {
    const { enabled = true, preventDefault = true, priority = VERSE_NAV_PRIORITY.preview } = options
    const onNextRef = useRef(onNextVerse)
    const onPrevRef = useRef(onPrevVerse)

    useEffect(() => {
        onNextRef.current = onNextVerse
        onPrevRef.current = onPrevVerse
    }, [onNextVerse, onPrevVerse])

    useEffect(() => {
        if (!enabled) return

        const owner = { id: Symbol('verse-nav'), priority }
        verseNavOwners.push(owner)

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isTopVerseOwner(owner.id)) return
            if (event.defaultPrevented || event.repeat || isInputElementFocused()) return
            // The quick Bible bar is itself an overlay; anything else open wins.
            if (priority !== VERSE_NAV_PRIORITY.quickBible && isOverlayOpen()) return

            // Only respond to plain key presses (no modifiers) so we never
            // shadow Ctrl+P, Cmd+LeftArrow, etc.
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

            if (event.key === 'n' || event.key === 'N' || event.key === 'ArrowRight') {
                if (preventDefault) event.preventDefault()
                onNextRef.current()
            } else if (event.key === 'p' || event.key === 'P' || event.key === 'ArrowLeft') {
                if (preventDefault) event.preventDefault()
                onPrevRef.current()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            const index = verseNavOwners.indexOf(owner)
            if (index !== -1) verseNavOwners.splice(index, 1)
        }
    }, [enabled, preventDefault, priority])
}

// Hook for number shortcuts (0-9) for quick slide access
export function useNumberShortcuts(
    onNumberPress: (num: number) => void
) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (shouldIgnoreShortcut(event)) return
            if (event.ctrlKey || event.metaKey) {
                const num = parseInt(event.key, 10)
                if (!isNaN(num) && num >= 0 && num <= 9) {
                    event.preventDefault()
                    onNumberPress(num)
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onNumberPress])
}

// Hook to track if Ctrl or Meta key is pressed
export function useCtrlOrMetaActive() {
    const [isActive, setIsActive] = useState(false)

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey) {
                setIsActive(true)
            }
        }

        const handleKeyUp = () => {
            setIsActive(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [])

    return isActive
}
