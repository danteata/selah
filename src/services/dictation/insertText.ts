/**
 * Put dictated text into whatever Selah input has focus.
 *
 * Phase A is in-app only: the text goes into a Selah field, not into another
 * application. That keeps the whole feature clear of macOS Accessibility
 * permission, which is a separate TCC grant, cannot be re-prompted once denied,
 * and is the single thing most likely to make a first run fail. System-wide
 * paste is Phase B — see `plan/dictation-mode-and-distribution.md` §1.6.
 *
 * Three targets, in the order they're tried:
 *
 * 1. `<input>` / `<textarea>` — spliced at the caret. React controlled inputs
 *    need the *native* value setter: assigning `el.value` directly is invisible
 *    to React's synthetic event layer, so the DOM updates, the component's state
 *    does not, and the next render wipes the text back out.
 * 2. `contenteditable` (TipTap/ProseMirror — the slide editor) — via
 *    `execCommand('insertText')`. Deprecated, but it is still the only way to
 *    insert through ProseMirror's own transaction pipeline, which is what keeps
 *    undo working and the document model in sync. Hand-built Range surgery on a
 *    ProseMirror node desynchronises its state and corrupts the next edit.
 * 3. Nothing editable focused — reported back so the caller can fall back to the
 *    clipboard rather than silently dropping what was just spoken.
 */

export type InsertOutcome =
    | { ok: true; target: 'input' | 'textarea' | 'contenteditable' }
    | { ok: false; reason: 'no-focus' | 'not-editable' | 'rejected' }

function isTextEntry(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
    if (!el) return false
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
    if (el instanceof HTMLInputElement) {
        // Only the types with a text caret. `selectionStart` throws on the
        // others (number, email, date…), which is also a fair signal, but
        // checking the type is clearer than catching for control flow.
        const textLike = ['text', 'search', 'url', 'tel', 'password', '']
        return textLike.includes(el.type) && !el.disabled && !el.readOnly
    }
    return false
}

/**
 * React tracks the last value it wrote on the DOM node and skips the change
 * event when the new value matches. Going through the prototype's setter is
 * what makes React notice — the same trick testing-library uses.
 */
function setValueThroughReact(
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
): void {
    const prototype =
        el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (setter) {
        setter.call(el, value)
    } else {
        // No descriptor is not a case we expect; a plain assignment at least
        // shows the operator their words while React catches up on the next
        // keystroke.
        el.value = value
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Join dictated text onto what is already there without doubling or eating a
 * space. Dictation arrives without leading whitespace, and an operator adding a
 * second sentence to a field expects a gap before it.
 */
function withSpacing(before: string, text: string, after: string): string {
    const needsLeading = before.length > 0 && !/\s$/.test(before) && !/^[\s.,;:!?]/.test(text)
    const needsTrailing = after.length > 0 && !/^\s/.test(after) && !/\s$/.test(text)
    return `${needsLeading ? ' ' : ''}${text}${needsTrailing ? ' ' : ''}`
}

/**
 * Insert `text` at the caret of the focused editable.
 *
 * Never throws — a dictation that cannot land is a message to the operator, not
 * an exception for the hook to unwind.
 */
export function insertTextAtCaret(text: string): InsertOutcome {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, reason: 'rejected' }

    // A global hotkey does not raise the window, so `activeElement` can be a
    // field in a window the operator walked away from ten minutes ago. Only
    // insert when this window actually holds keyboard focus.
    if (typeof document === 'undefined' || !document.hasFocus()) {
        return { ok: false, reason: 'no-focus' }
    }

    const active = document.activeElement

    if (isTextEntry(active)) {
        const start = active.selectionStart ?? active.value.length
        const end = active.selectionEnd ?? start
        const before = active.value.slice(0, start)
        const after = active.value.slice(end)
        const insertion = withSpacing(before, trimmed, after)

        setValueThroughReact(active, `${before}${insertion}${after}`)

        // Leave the caret after what was just inserted, so a second dictation
        // continues rather than overwriting.
        const caret = start + insertion.length
        active.setSelectionRange(caret, caret)

        return { ok: true, target: active instanceof HTMLTextAreaElement ? 'textarea' : 'input' }
    }

    if (active instanceof HTMLElement && active.isContentEditable) {
        const selection = window.getSelection()
        const collapsedAtEnd = selection?.isCollapsed ?? true
        // Spacing for a rich-text target is judged from the text immediately
        // before the caret, which is all `anchorNode` gives us cheaply. Good
        // enough: the failure mode is one missing space, not a corrupt document.
        const preceding = collapsedAtEnd ? (selection?.anchorNode?.textContent ?? '') : ''
        const offset = selection?.anchorOffset ?? preceding.length
        const insertion = withSpacing(preceding.slice(0, offset), trimmed, '')

        const inserted = document.execCommand('insertText', false, insertion)
        if (inserted) return { ok: true, target: 'contenteditable' }
        return { ok: false, reason: 'rejected' }
    }

    return { ok: false, reason: 'not-editable' }
}

/**
 * Last resort when nothing editable has focus: put it on the clipboard so the
 * words are recoverable with one paste.
 *
 * Deliberately not silent — the caller pairs this with a toast. The worst
 * outcome for dictation is speaking a sentence and having it vanish with no
 * indication of where it went.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch (err) {
        console.warn('[dictation] clipboard write failed:', err)
        return false
    }
}
