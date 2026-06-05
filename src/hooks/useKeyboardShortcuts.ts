import { useEffect, useCallback, useRef, useState } from 'react'

interface ShortcutOptions {
    ctrlOrMeta?: boolean
    shift?: boolean
    alt?: boolean
    preventDefault?: boolean
    ignoreInputFocus?: boolean
}

function isInputElementFocused(): boolean {
    const el = document.activeElement
    return el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.getAttribute('contenteditable') === 'true'
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
            if (!options.ignoreInputFocus && isInputElementFocused()) return

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
        callback: () => void
        options?: ShortcutOptions
    }>
) {
    const shortcutsRef = useRef(shortcuts)

    useEffect(() => {
        shortcutsRef.current = shortcuts
    }, [shortcuts])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isInputElementFocused()) return

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
                    if (options.preventDefault !== false) {
                        event.preventDefault()
                    }
                    callback()
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

// Hook specifically for verse navigation shortcuts (used in BibleVerseNavigator,
// PreviewContent, QuickBibleBar). Bound to N/P and LeftArrow/RightArrow so it
// does NOT collide with the global ArrowUp/ArrowDown slide-queue navigation.
export function useVerseNavigationShortcuts(
    onNextVerse: () => void,
    onPrevVerse: () => void,
    options: { enabled?: boolean; preventDefault?: boolean } = {}
) {
    const { enabled = true, preventDefault = true } = options
    const onNextRef = useRef(onNextVerse)
    const onPrevRef = useRef(onPrevVerse)

    useEffect(() => {
        onNextRef.current = onNextVerse
        onPrevRef.current = onPrevVerse
    }, [onNextVerse, onPrevVerse])

    useEffect(() => {
        if (!enabled) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isInputElementFocused()) return

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
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [enabled, preventDefault])
}

// Hook for number shortcuts (0-9) for quick slide access
export function useNumberShortcuts(
    onNumberPress: (num: number) => void
) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isInputElementFocused()) return
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
