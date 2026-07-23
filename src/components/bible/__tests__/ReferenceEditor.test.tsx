import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReferenceEditor } from '../ReferenceEditor'

function renderEditor(overrides: Partial<React.ComponentProps<typeof ReferenceEditor>> = {}) {
    const onChange = vi.fn()
    render(
        <ReferenceEditor
            bookIndex={43}
            chapter={3}
            startVerse={16}
            endVerse={16}
            onChange={onChange}
            {...overrides}
        />,
    )
    return { onChange }
}

describe('ReferenceEditor', () => {
    it('renders the book, chapter and verse', () => {
        renderEditor()
        expect(screen.getByText('John')).toBeInTheDocument()
        // Chapter 3 and verse 16 both shown as stepper values.
        expect(screen.getByLabelText('Chapter 3')).toBeInTheDocument()
        expect(screen.getByLabelText('Verse 16')).toBeInTheDocument()
    })

    it('steps the chapter and resets the verse to 1', () => {
        const { onChange } = renderEditor()
        fireEvent.click(screen.getByLabelText('Increase Chapter'))
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 43, bookName: 'John', chapter: 4, startVerse: 1, endVerse: 1,
        })
    })

    it('steps the verse without changing the chapter', () => {
        const { onChange } = renderEditor()
        fireEvent.click(screen.getByLabelText('Increase Verse'))
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 17, endVerse: 17,
        })
    })

    it('rolls the chapter into the next book past the last chapter', () => {
        // John has 21 chapters → +1 lands on Acts 1.
        const { onChange } = renderEditor({ chapter: 21 })
        fireEvent.click(screen.getByLabelText('Increase Chapter'))
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 44, bookName: 'Acts', chapter: 1, startVerse: 1, endVerse: 1,
        })
    })

    it('clamps the verse to the loaded maximum', () => {
        const { onChange } = renderEditor({ startVerse: 5, endVerse: 5, maxVerse: 5 })
        fireEvent.click(screen.getByLabelText('Increase Verse'))
        // Already at the max loaded verse — no change emitted.
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not step below verse 1', () => {
        const { onChange } = renderEditor({ startVerse: 1, endVerse: 1 })
        fireEvent.click(screen.getByLabelText('Decrease Verse'))
        expect(onChange).not.toHaveBeenCalled()
    })

    it('lets you type a chapter number directly and commits on blur', () => {
        const { onChange } = renderEditor()
        const input = screen.getByLabelText('Chapter 3')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '10' } })
        fireEvent.blur(input)
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 43, bookName: 'John', chapter: 10, startVerse: 1, endVerse: 1,
        })
    })

    it('lets you type a verse number directly and commits on Enter', () => {
        const { onChange } = renderEditor()
        const input = screen.getByLabelText('Verse 16')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '5' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 43, bookName: 'John', chapter: 3, startVerse: 5, endVerse: 5,
        })
    })

    it('strips non-digit characters while typing', () => {
        renderEditor()
        const input = screen.getByLabelText('Chapter 3') as HTMLInputElement
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '1a2b' } })
        expect(input.value).toBe('12')
    })

    it('reverts to the current value on Escape without committing', () => {
        const { onChange } = renderEditor()
        const input = screen.getByLabelText('Chapter 3') as HTMLInputElement
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '99' } })
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(onChange).not.toHaveBeenCalled()
        expect(input.value).toBe('3')
    })

    it('does not emit a change when the typed value equals the current one', () => {
        const { onChange } = renderEditor()
        const input = screen.getByLabelText('Chapter 3')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '3' } })
        fireEvent.blur(input)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not emit a change when the field is cleared then blurred', () => {
        const { onChange } = renderEditor()
        const input = screen.getByLabelText('Verse 16') as HTMLInputElement
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: '' } })
        fireEvent.blur(input)
        expect(onChange).not.toHaveBeenCalled()
        expect(input.value).toBe('16')
    })

    it('changes the book via the picker and resets to chapter 1 verse 1', () => {
        const { onChange } = renderEditor()
        fireEvent.click(screen.getByTitle('Change book'))
        const input = screen.getByPlaceholderText('Jump to book…')
        fireEvent.change(input, { target: { value: 'rom' } })
        // Enter accepts the top-ranked suggestion (Romans, index 45).
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledWith({
            bookIndex: 45, bookName: 'Romans', chapter: 1, startVerse: 1, endVerse: 1,
        })
    })
})
