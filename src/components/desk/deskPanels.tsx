/* eslint-disable react-refresh/only-export-components -- a registry: each panel's component is built beside its title, limits and renderer */
import type { ComponentType } from 'react'
import { BookOpen, BookA, Music, Image, Layout, Clock, AlertCircle, Mic, Rows3, Eye, Radio } from 'lucide-react'
import type { NavSection } from '../../types/studio'
import { PreviewContent } from '../preview/PreviewContent'
import { LivePanel } from '../live/LivePanel'
import { PreviewPanel } from '../live/PreviewPanel'
import { ContextSectionContent } from '../layout/ContextPanel'
import { PanelErrorBoundary } from '../offline/PanelErrorBoundary'

/** The library tools that are panels on the desk; each is also a NavRail section. */
export const LIBRARY_PANEL_IDS = ['bible', 'music', 'media', 'dictionary', 'templates', 'countdown', 'alerts', 'sermon'] as const
export type LibraryPanelId = (typeof LIBRARY_PANEL_IDS)[number]

export type DeskPanelId = 'serviceOrder' | 'preview' | 'live' | LibraryPanelId

export interface DeskPanelDef {
    id: DeskPanelId
    title: string
    icon: ComponentType<{ className?: string }>
    Component: ComponentType
    minimumWidth: number
    minimumHeight: number
    /** Live is the one panel that can never be closed. */
    closable: boolean
    /**
     * Keep mounted while hidden behind another tab. Live and Preview carry
     * global shortcuts and output hooks that must never stop; the service
     * order keeps its scroll position and live-slide tracking.
     */
    alwaysRendered: boolean
}

function librarySection(section: NavSection) {
    function LibrarySection() {
        return (
            <PanelErrorBoundary name={`desk-${section}`}>
                <ContextSectionContent section={section} />
            </PanelErrorBoundary>
        )
    }
    LibrarySection.displayName = `LibrarySection(${section})`
    return LibrarySection
}

function guarded(name: string, Inner: ComponentType) {
    function Guarded() {
        return (
            <PanelErrorBoundary name={name}>
                <Inner />
            </PanelErrorBoundary>
        )
    }
    Guarded.displayName = `Guarded(${name})`
    return Guarded
}

const library = (id: LibraryPanelId, title: string, icon: DeskPanelDef['icon']): DeskPanelDef => ({
    id,
    title,
    icon,
    Component: librarySection(id),
    minimumWidth: 240,
    minimumHeight: 200,
    closable: true,
    alwaysRendered: false,
})

export const DESK_PANELS: Record<DeskPanelId, DeskPanelDef> = {
    serviceOrder: {
        id: 'serviceOrder',
        title: 'Service order',
        icon: Rows3,
        Component: guarded('desk-service-order', PreviewContent),
        minimumWidth: 220,
        minimumHeight: 200,
        closable: true,
        alwaysRendered: true,
    },
    preview: {
        id: 'preview',
        title: 'Preview',
        icon: Eye,
        Component: guarded('desk-preview', PreviewPanel),
        minimumWidth: 200,
        minimumHeight: 150,
        closable: true,
        alwaysRendered: true,
    },
    live: {
        id: 'live',
        title: 'Live',
        icon: Radio,
        Component: guarded('desk-live', LivePanel),
        minimumWidth: 320,
        minimumHeight: 260,
        closable: false,
        alwaysRendered: true,
    },
    bible: library('bible', 'Bible', BookOpen),
    music: library('music', 'Songs & Hymns', Music),
    media: library('media', 'Media', Image),
    dictionary: library('dictionary', 'Dictionary', BookA),
    templates: library('templates', 'Templates', Layout),
    countdown: library('countdown', 'Countdown', Clock),
    alerts: library('alerts', 'Alerts', AlertCircle),
    sermon: library('sermon', 'Sermon Listener', Mic),
}

/** Every panel, in the order the Panels menu lists them. */
export const DESK_PANEL_ORDER: DeskPanelId[] = [
    'serviceOrder', 'preview', 'live', 'sermon',
    'bible', 'music', 'media', 'dictionary', 'templates', 'countdown', 'alerts',
]

export function isDeskPanelId(id: string): id is DeskPanelId {
    return Object.prototype.hasOwnProperty.call(DESK_PANELS, id)
}

export function isLibraryPanelId(id: string | null | undefined): id is LibraryPanelId {
    return !!id && (LIBRARY_PANEL_IDS as readonly string[]).includes(id)
}
