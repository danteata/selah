import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { insertTextAtCaret } from '../insertText'

/**
 * The insertion path is where dictation quietly loses text, so these tests are
 * about the failure modes rather than the happy path: a controlled React input
 * that reverts on the next render, a caret that ends up in the wrong place, and
 * an unfocused window that would otherwise take the words and drop them.
 */

function mountInput(value = '', caret = value.length): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    document.body.appendChild(input)
    input.focus()
    input.setSelectionRange(caret, caret)
    return input
}

describe('insertTextAtCaret', () => {
    beforeEach(() => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('inserts at the caret of a focused input', () => {
        const input = mountInput('')

        const outcome = insertTextAtCaret('Psalm 27 verse 1')

        expect(outcome).toEqual({ ok: true, target: 'input' })
        expect(input.value).toBe('Psalm 27 verse 1')
    })

    it('fires an input event so a controlled React input keeps the text', () => {
        const input = mountInput('')
        const onInput = vi.fn()
        input.addEventListener('input', onInput)

        insertTextAtCaret('hello')

        // Without this event React never learns the value changed, and the next
        // render puts the old value back — the text appears and then vanishes.
        expect(onInput).toHaveBeenCalledTimes(1)
        expect(onInput.mock.calls[0][0].bubbles).toBe(true)
    })

    it('separates a second dictation from existing text', () => {
        const input = mountInput('First sentence.')

        insertTextAtCaret('Second sentence.')

        expect(input.value).toBe('First sentence. Second sentence.')
    })

    it('does not double a space that is already there', () => {
        const input = mountInput('First sentence. ')

        insertTextAtCaret('Second sentence.')

        expect(input.value).toBe('First sentence. Second sentence.')
    })

    it('splices at a mid-string caret and leaves the caret after the insertion', () => {
        const input = mountInput('start end', 5)

        insertTextAtCaret('middle')

        expect(input.value).toBe('start middle end')
        // Ready for the next dictation to continue rather than overwrite.
        expect(input.selectionStart).toBe('start middle'.length)
    })

    it('replaces a selection rather than appending around it', () => {
        const input = mountInput('keep this replace-me')
        input.setSelectionRange('keep this '.length, input.value.length)

        insertTextAtCaret('replaced')

        expect(input.value).toBe('keep this replaced')
    })

    it('reports no-focus when the window does not hold keyboard focus', () => {
        mountInput('')
        vi.spyOn(document, 'hasFocus').mockReturnValue(false)

        // A global hotkey does not raise the window, so activeElement can point
        // at a field the operator left ten minutes ago.
        expect(insertTextAtCaret('anything')).toEqual({ ok: false, reason: 'no-focus' })
    })

    it('reports not-editable when nothing editable is focused', () => {
        const div = document.createElement('div')
        div.tabIndex = 0
        document.body.appendChild(div)
        div.focus()

        expect(insertTextAtCaret('anything')).toEqual({ ok: false, reason: 'not-editable' })
    })

    it('refuses a read-only input rather than silently doing nothing', () => {
        const input = mountInput('locked')
        input.readOnly = true

        expect(insertTextAtCaret('anything')).toEqual({ ok: false, reason: 'not-editable' })
        expect(input.value).toBe('locked')
    })

    it('rejects whitespace-only dictation', () => {
        mountInput('')

        expect(insertTextAtCaret('   ')).toEqual({ ok: false, reason: 'rejected' })
    })

    it('routes contenteditable through execCommand so ProseMirror stays in sync', () => {
        const editable = document.createElement('div')
        editable.setAttribute('contenteditable', 'true')
        document.body.appendChild(editable)
        editable.focus()
        // happy-dom does not implement isContentEditable from the attribute.
        Object.defineProperty(editable, 'isContentEditable', { value: true })
        const execCommand = vi.fn().mockReturnValue(true)
        Object.defineProperty(document, 'execCommand', {
            value: execCommand,
            configurable: true,
        })

        const outcome = insertTextAtCaret('dictated')

        expect(outcome).toEqual({ ok: true, target: 'contenteditable' })
        expect(execCommand).toHaveBeenCalledWith('insertText', false, 'dictated')
    })
})
