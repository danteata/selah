import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePointerReorder } from '../usePointerReorder'

/**
 * A list wired up the way a caller would wire it, so the test exercises the
 * hook's contract (handle -> move -> release) rather than its internals.
 */
function ReorderableList({ onReorder }: { onReorder: (from: number, to: number) => void }) {
    const items = ['KJV', 'NIV', 'ESV']
    const reorder = usePointerReorder({ onReorder })

    return (
        <ul data-testid="list" {...reorder.containerProps}>
            {items.map((id, i) => (
                <li
                    key={id}
                    {...reorder.itemProps(i)}
                    data-testid={`row-${id}`}
                    data-dragging={reorder.draggingIndex === i}
                    data-dragover={reorder.dragOverIndex === i}
                >
                    <span {...reorder.handleProps(i)} data-testid={`handle-${id}`}>grip</span>
                    {id}
                </li>
            ))}
        </ul>
    )
}

/**
 * elementFromPoint isn't implemented in the test DOM, so point it at whichever
 * row the test says the pointer is over. Row identity is what the hook reads.
 */
function pointerOver(testId: string | null) {
    document.elementFromPoint = vi.fn(() => (testId ? screen.getByTestId(testId) : null))
}

describe('usePointerReorder', () => {
    const onReorder = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        pointerOver(null)
    })

    it('reorders from the dragged row to the row released over', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 0 })
        pointerOver('row-ESV')
        fireEvent.pointerMove(screen.getByTestId('list'), { clientX: 10, clientY: 90 })
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 90 })

        expect(onReorder).toHaveBeenCalledWith(0, 2)
    })

    it('marks the dragged row while the drag is in flight', () => {
        render(<ReorderableList onReorder={onReorder} />)

        expect(screen.getByTestId('row-NIV')).toHaveAttribute('data-dragging', 'false')
        fireEvent.pointerDown(screen.getByTestId('handle-NIV'), { button: 0 })
        expect(screen.getByTestId('row-NIV')).toHaveAttribute('data-dragging', 'true')
    })

    it('highlights the row being hovered, not the one being dragged', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 0 })
        pointerOver('row-NIV')
        fireEvent.pointerMove(screen.getByTestId('list'), { clientX: 10, clientY: 50 })

        expect(screen.getByTestId('row-NIV')).toHaveAttribute('data-dragover', 'true')
        expect(screen.getByTestId('row-KJV')).toHaveAttribute('data-dragover', 'false')
    })

    it('clears the drag state after a drop', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 0 })
        pointerOver('row-NIV')
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 50 })

        expect(screen.getByTestId('row-KJV')).toHaveAttribute('data-dragging', 'false')
        expect(screen.getByTestId('row-NIV')).toHaveAttribute('data-dragover', 'false')
    })

    it('does nothing when released over the row it started on', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-NIV'), { button: 0 })
        pointerOver('row-NIV')
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 50 })

        expect(onReorder).not.toHaveBeenCalled()
    })

    it('does nothing when released outside any row', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 0 })
        pointerOver(null)
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 500 })

        expect(onReorder).not.toHaveBeenCalled()
    })

    it('cancels when the pointer leaves the list', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 0 })
        fireEvent.pointerLeave(screen.getByTestId('list'))
        pointerOver('row-ESV')
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 90 })

        expect(onReorder).not.toHaveBeenCalled()
        expect(screen.getByTestId('row-KJV')).toHaveAttribute('data-dragging', 'false')
    })

    it('ignores non-primary buttons, so a right-click never starts a drag', () => {
        render(<ReorderableList onReorder={onReorder} />)

        fireEvent.pointerDown(screen.getByTestId('handle-KJV'), { button: 2 })
        expect(screen.getByTestId('row-KJV')).toHaveAttribute('data-dragging', 'false')

        pointerOver('row-ESV')
        fireEvent.pointerUp(screen.getByTestId('list'), { clientX: 10, clientY: 90 })
        expect(onReorder).not.toHaveBeenCalled()
    })

    it('ignores movement when no drag is in progress', () => {
        render(<ReorderableList onReorder={onReorder} />)

        pointerOver('row-ESV')
        fireEvent.pointerMove(screen.getByTestId('list'), { clientX: 10, clientY: 90 })

        expect(screen.getByTestId('row-ESV')).toHaveAttribute('data-dragover', 'false')
    })

    it('opts out of touch scrolling on the handle, so a touch drag reorders', () => {
        render(<ReorderableList onReorder={onReorder} />)
        expect(screen.getByTestId('handle-KJV').className).toContain('touch-none')
    })
})
