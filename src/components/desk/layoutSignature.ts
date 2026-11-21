import type { SerializedDockview, SerializedGridObject } from 'dockview-react'

/** A tab stack in a saved layout: dockview doesn't export the type. */
type GroupPanelViewState = { views: string[] }

/** Proportions closer than this read as the same layout. */
const SIZE_STEP = 0.05

/**
 * What a layout *is*, for telling whether it has been changed since it was
 * loaded or saved: which panels sit together in which tab stacks, how the
 * stacks are split, and each split's proportions to the nearest 5%. Pixel
 * sizes, the window's size and which tab is in front are left out, so a
 * restart or a different screen doesn't read as a change.
 */
export function layoutSignature(layout: SerializedDockview, { sizes = true } = {}): string {
    return JSON.stringify([layout.grid.orientation, node(layout.grid.root, sizes)])
}

/** The two signatures differ in arrangement, not just in proportions. */
export function sameArrangement(a: string, b: string): boolean {
    return stripSizes(a) === stripSizes(b)
}

function stripSizes(signature: string): string {
    // Sizes are the first element of each [size, child] pair.
    return JSON.stringify(strip(JSON.parse(signature)))
}

function strip(value: unknown): unknown {
    if (!Array.isArray(value)) return value
    if (value.length === 2 && (typeof value[0] === 'number' || value[0] === null) && Array.isArray(value[1])) {
        return strip(value[1])
    }
    return value.map(strip)
}

function node(n: SerializedGridObject<GroupPanelViewState>, sizes: boolean): unknown {
    if (n.type === 'leaf') return (n.data as GroupPanelViewState).views
    const children = n.data as SerializedGridObject<GroupPanelViewState>[]
    const total = children.reduce((sum, child) => sum + (child.size ?? 0), 0)
    return children.map((child) => [
        sizes && total > 0 ? Math.round((child.size ?? 0) / total / SIZE_STEP) * SIZE_STEP : null,
        node(child, sizes),
    ])
}
