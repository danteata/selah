import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { useResultNavigation } from '../useResultNavigation'

/**
 * Stand-in for the songs / dictionary / Bible panels: a search box and a list,
 * with the key handler on the root element (not the input) — that placement is
 * what makes arrows work after focus has moved onto a row.
 */
function Panel({
    onActivate,
    initialResults = ['first', 'second', 'third'],
    editor = false,
}: {
    onActivate: (index: number, options: { queue: boolean }) => void
    initialResults?: string[]
    /** Renders an editing surface inside the panel root, the way the music
     *  browser mounts the song editor. */
    editor?: boolean
}) {
    const [query, setQuery] = useState('')
    const [, forceRender] = useState(0)
    const base = query ? [`${query}-a`, `${query}-b`] : initialResults
    // Deliberately a fresh array on every render, the way `useSongs()` and
    // Convex query results behave.
    const results = base.map((result) => result)

    const { focusedIndex, handleKeyDown, listRef } = useResultNavigation<HTMLDivElement>({
        count: results.length,
        resetKey: `${query}:${results.length}`,
        onActivate,
    })

    return (
        <div onKeyDown={handleKeyDown}>
            <input aria-label="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button onClick={() => forceRender((n) => n + 1)}>re-render</button>
            <div ref={listRef}>
                {results.map((result, index) => (
                    <div key={result} data-result-index={index} data-testid={`row-${index}`}>
                        {result}{focusedIndex === index ? ' [focused]' : ''}
                        <button>Add</button>
                    </div>
                ))}
            </div>
            {editor && (
                <div>
                    <textarea aria-label="lyrics" defaultValue="line one" />
                    <div aria-label="rich lyrics" contentEditable suppressContentEditableWarning>
                        line one
                    </div>
                    <select aria-label="section">
                        <option>Verse 1</option>
                        <option>Chorus</option>
                    </select>
                </div>
            )}
        </div>
    )
}

const focusedRow = () => screen.getByText(/\[focused\]/).textContent

describe('useResultNavigation', () => {
    it('highlights the best result as soon as there are results', () => {
        render(<Panel onActivate={vi.fn()} />)
        // No keystroke needed — this is the whole point: Enter presents the top
        // match without arrowing down to it first.
        expect(focusedRow()).toContain('first')
    })

    it('presents the highlighted result on Enter and queues it on Shift+Enter', () => {
        const onActivate = vi.fn()
        render(<Panel onActivate={onActivate} />)
        const input = screen.getByLabelText('search')

        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onActivate).toHaveBeenCalledWith(0, { queue: false })

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        expect(onActivate).toHaveBeenLastCalledWith(0, { queue: true })
    })

    it('walks the list with the arrow keys and wraps at both ends', () => {
        render(<Panel onActivate={vi.fn()} />)
        const input = screen.getByLabelText('search')

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        expect(focusedRow()).toContain('second')

        fireEvent.keyDown(input, { key: 'ArrowUp' })
        fireEvent.keyDown(input, { key: 'ArrowUp' })
        expect(focusedRow()).toContain('third')

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        expect(focusedRow()).toContain('first')
    })

    it('activates the row the arrows landed on, not the first one', () => {
        const onActivate = vi.fn()
        render(<Panel onActivate={onActivate} />)
        const input = screen.getByLabelText('search')

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onActivate).toHaveBeenCalledWith(1, { queue: false })
    })

    it('re-highlights the top match when the results change', () => {
        render(<Panel onActivate={vi.fn()} />)
        const input = screen.getByLabelText('search')

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        expect(focusedRow()).toContain('second')

        // A new search must not leave the highlight on row 2 of the old list.
        fireEvent.change(input, { target: { value: 'grace' } })
        expect(focusedRow()).toContain('grace-a')
    })

    it('keeps the highlight through an unrelated re-render', () => {
        render(<Panel onActivate={vi.fn()} />)
        fireEvent.keyDown(screen.getByLabelText('search'), { key: 'ArrowDown' })
        expect(focusedRow()).toContain('second')

        // The reported "arrows sometimes don't navigate": anything that re-rendered
        // the panel used to snap the highlight back to the first row, because the
        // result set was compared by array identity and the array was rebuilt.
        fireEvent.click(screen.getByText('re-render'))
        expect(focusedRow()).toContain('second')
    })

    it('leaves Enter alone when a button inside a row has focus', () => {
        const onActivate = vi.fn()
        render(<Panel onActivate={onActivate} />)

        // The browser already turns Enter on a focused button into a click;
        // acting here as well would add the row twice.
        fireEvent.keyDown(screen.getAllByText('Add')[1], { key: 'Enter' })
        expect(onActivate).not.toHaveBeenCalled()
    })

    describe('editing surfaces inside the panel', () => {
        // The reported bug: editing a song opened from the music search results
        // and pressing Enter in the lyrics sent that song to the live output and
        // swallowed the newline. The handler is bound to the panel root, so it
        // saw every key typed into the editor the panel itself renders.
        it('does not activate a result on Enter in a textarea', () => {
            const onActivate = vi.fn()
            render(<Panel onActivate={onActivate} editor />)

            const event = fireEvent.keyDown(screen.getByLabelText('lyrics'), {
                key: 'Enter',
                cancelable: true,
            })
            expect(onActivate).not.toHaveBeenCalled()
            // And the newline must still be the browser's to insert.
            expect(event).toBe(true) // not prevented
        })

        it('does not activate a result on Enter in a contenteditable', () => {
            const onActivate = vi.fn()
            render(<Panel onActivate={onActivate} editor />)

            fireEvent.keyDown(screen.getByLabelText('rich lyrics'), { key: 'Enter' })
            expect(onActivate).not.toHaveBeenCalled()
        })

        it('leaves the arrow keys to the caret inside a textarea', () => {
            render(<Panel onActivate={vi.fn()} editor />)
            expect(focusedRow()).toContain('first')

            // Moving the caret between lines must not walk the result list.
            fireEvent.keyDown(screen.getByLabelText('lyrics'), { key: 'ArrowDown' })
            expect(focusedRow()).toContain('first')
        })

        it('leaves the arrow keys to a select', () => {
            render(<Panel onActivate={vi.fn()} editor />)
            fireEvent.keyDown(screen.getByLabelText('section'), { key: 'ArrowDown' })
            expect(focusedRow()).toContain('first')
        })

        it('still drives the list from the search box', () => {
            // The guard must not overreach: a single-line input is where the
            // keyboard contract is meant to work, since Enter inserts nothing
            // and the arrows don't move between lines there.
            const onActivate = vi.fn()
            render(<Panel onActivate={onActivate} editor />)
            const input = screen.getByLabelText('search')

            fireEvent.keyDown(input, { key: 'ArrowDown' })
            expect(focusedRow()).toContain('second')
            fireEvent.keyDown(input, { key: 'Enter' })
            expect(onActivate).toHaveBeenCalledWith(1, { queue: false })
        })
    })

    it('does nothing when there are no results', () => {
        const onActivate = vi.fn()
        render(<Panel onActivate={onActivate} initialResults={[]} />)
        const input = screen.getByLabelText('search')

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onActivate).not.toHaveBeenCalled()
    })

    it('keeps the highlighted row scrolled into view', () => {
        const scrollIntoView = vi.fn()
        // happy-dom has no scrollIntoView; the hook feature-detects it, so this
        // also covers that guard.
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
            value: scrollIntoView,
            configurable: true,
            writable: true,
        })

        render(<Panel onActivate={vi.fn()} />)
        fireEvent.keyDown(screen.getByLabelText('search'), { key: 'ArrowDown' })

        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    })
})
