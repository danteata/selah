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
