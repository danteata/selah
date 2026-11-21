import { useEffect } from 'react'
import { shouldIgnoreShortcut } from '../../hooks/useKeyboardShortcuts'
import { useStagedSlide } from './useStagedSlide'

/**
 * Enter sends the staged slide on air, from anywhere on the desk. It lived in
 * the service order, so it only worked while that panel was mounted; Preview
 * and the service order can now sit anywhere, or in a background tab.
 *
 * Mounted once, in the shell. Renders nothing.
 */
export function StagedSlideShortcut() {
    const { staged, canSend, send } = useStagedSlide()

    useEffect(() => {
        if (!staged || !canSend) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
            if (shouldIgnoreShortcut(e)) return
            // Enter on a focused button or link is that control's own click.
            const el = document.activeElement
            if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return
            e.preventDefault()
            send()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [staged, canSend, send])

    return null
}
