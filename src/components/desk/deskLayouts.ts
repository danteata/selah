import type { AddPanelOptions, DockviewApi } from 'dockview-react'
import { DESK_PANELS, type DeskPanelDef, type DeskPanelId } from './deskPanels'

/** What dockview needs to create a panel: the component is the panel's id. */
export function panelOptions(def: DeskPanelDef): Pick<AddPanelOptions, 'id' | 'component' | 'title' | 'renderer' | 'minimumWidth' | 'minimumHeight'> {
    return {
        id: def.id,
        component: def.id,
        title: def.title,
        renderer: def.alwaysRendered ? 'always' : 'onlyWhenVisible',
        minimumWidth: def.minimumWidth,
        minimumHeight: def.minimumHeight,
    }
}

const LIBRARY_STACK: DeskPanelId[] = ['bible', 'music', 'media', 'dictionary', 'templates', 'countdown', 'alerts']

/**
 * The default layout: today's Studio with its sidebar open.
 *
 *   Service order │ Preview / Sermon │ Live │ Bible │ Songs │ …
 */
export function buildDefaultLayout(api: DockviewApi): void {
    api.clear()
    const order = api.addPanel(panelOptions(DESK_PANELS.serviceOrder))
    const live = api.addPanel({
        ...panelOptions(DESK_PANELS.live),
        position: { referencePanel: order, direction: 'right' },
    })
    const preview = api.addPanel({
        ...panelOptions(DESK_PANELS.preview),
        position: { referencePanel: live, direction: 'left' },
    })
    api.addPanel({
        ...panelOptions(DESK_PANELS.sermon),
        position: { referencePanel: preview, direction: 'below' },
    })
    const [first, ...rest] = LIBRARY_STACK
    const library = api.addPanel({
        ...panelOptions(DESK_PANELS[first]),
        position: { referencePanel: live, direction: 'right' },
    })
    for (const id of rest) {
        api.addPanel({
            ...panelOptions(DESK_PANELS[id]),
            position: { referencePanel: library, direction: 'within' },
            inactive: true,
        })
    }
    library.api.setActive()

    order.api.setSize({ width: 300 })
    preview.api.setSize({ width: 280, height: Math.round(api.height * 0.4) })
    library.api.setSize({ width: 340 })
    live.api.setActive()
}

const CLASSIC_BOTTOM: DeskPanelId[] = ['bible', 'music', 'media', 'sermon', 'dictionary', 'templates', 'countdown', 'alerts']

/**
 * Classic: the arrangement EasyWorship users know.
 *
 *   Service order │ Preview │ Live
 *   ──────────────┴─────────┴─────
 *   Bible │ Songs & Hymns │ Media │ Sermon Listener │ …
 */
export function buildClassicLayout(api: DockviewApi): void {
    api.clear()
    const order = api.addPanel(panelOptions(DESK_PANELS.serviceOrder))
    const preview = api.addPanel({
        ...panelOptions(DESK_PANELS.preview),
        position: { referencePanel: order, direction: 'right' },
    })
    const live = api.addPanel({
        ...panelOptions(DESK_PANELS.live),
        position: { referencePanel: preview, direction: 'right' },
    })
    const [first, ...rest] = CLASSIC_BOTTOM
    // Below everything, across the whole width.
    const library = api.addPanel({
        ...panelOptions(DESK_PANELS[first]),
        position: { direction: 'below' },
    })
    for (const id of rest) {
        api.addPanel({
            ...panelOptions(DESK_PANELS[id]),
            position: { referencePanel: library, direction: 'within' },
            inactive: true,
        })
    }
    library.api.setActive()

    const orderWidth = 280
    order.api.setSize({ width: orderWidth })
    preview.api.setSize({ width: Math.round((api.width - orderWidth) / 2) })
    library.api.setSize({ height: Math.round(api.height * 0.42) })
    live.api.setActive()
}

export const BUILT_IN_LAYOUTS = {
    default: { name: 'Default', build: buildDefaultLayout },
    classic: { name: 'Classic', build: buildClassicLayout },
} as const
