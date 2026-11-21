import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
    DockviewReact,
    DockviewDefaultTab,
    type DockviewApi,
    type DockviewReadyEvent,
    type IDockviewPanelHeaderProps,
    type IDockviewPanelProps,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import './desk.css'
import { useAppStore } from '../../store/appStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import { MobileStudioWorkspace } from '../layout/MobileStudioWorkspace'
import { DESK_PANELS, isDeskPanelId, isLibraryPanelId, type DeskPanelId } from './deskPanels'
import { buildDefaultLayout } from './deskLayouts'
import { loadDeskLayout, saveDeskLayout, removeRetiredLayoutKeys } from './layoutStorage'
import { attachDeskApi, initLayouts, normalizeDeskPanels, refreshModified, rememberPanelGroup, showDeskPanel, useDeskStore } from './deskStore'

const SAVE_DELAY_MS = 400

const deskTheme = { name: 'selah', className: 'dockview-theme-selah', gap: 6 }

// dockview creates each panel from its component name: the panel's id.
const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = Object.fromEntries(
    Object.values(DESK_PANELS).map((def) => {
        const Content = def.Component
        const DeskPanel = () => (
            <div className="desk-panel h-full w-full overflow-hidden">
                <Content />
            </div>
        )
        DeskPanel.displayName = `DeskPanel(${def.id})`
        return [def.id, DeskPanel]
    }),
)

/** A tab: its title, and a close button only while editing, and never on Live. */
function DeskTab(props: IDockviewPanelHeaderProps) {
    const editing = useDeskStore((s) => s.editing)
    const id = props.api.id
    const closable = isDeskPanelId(id) && DESK_PANELS[id].closable
    return <DockviewDefaultTab {...props} hideClose={!editing || !closable} />
}

const tabComponents = { desk: DeskTab }

/**
 * The docked desk: panels that fill the window, resized by their splitters,
 * and moved, stacked, closed and reopened in Edit layout mode. The
 * arrangement is this device's own and is saved as it changes.
 */
export function DeskWorkspace() {
    const isMobile = useIsMobile()
    if (isMobile) return <MobileStudioWorkspace />
    return <DockedDesk />
}

function DockedDesk() {
    const apiRef = useRef<DockviewApi | null>(null)
    const editing = useDeskStore((s) => s.editing)
    const setOpenPanels = useDeskStore((s) => s.setOpenPanels)
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)

    // The NavRail, the command bar and the rest still ask for a section by
    // setting activeNavSection. On the desk that means "show that panel".
    useEffect(() => {
        if (isLibraryPanelId(activeNavSection)) showDeskPanel(activeNavSection)
    }, [activeNavSection])

    const onReady = useCallback((event: DockviewReadyEvent) => {
        const api = event.api
        apiRef.current = api
        attachDeskApi(api)
        removeRetiredLayoutKeys()

        const saved = loadDeskLayout()
        let restored = false
        if (saved) {
            try {
                api.fromJSON(saved)
                restored = true
            } catch (err) {
                console.warn('[desk] saved layout failed to load; using the default', err)
            }
        }
        if (!restored) buildDefaultLayout(api)
        // Older saves may predate a panel's renderer; Live is never missing.
        normalizeDeskPanels(api)
        initLayouts(!restored)

        const syncOpen = () => setOpenPanels(api.panels.map((p) => p.id).filter(isDeskPanelId))
        syncOpen()

        let saveTimer: ReturnType<typeof setTimeout> | null = null
        api.onDidLayoutChange(() => {
            if (saveTimer) clearTimeout(saveTimer)
            saveTimer = setTimeout(() => {
                saveDeskLayout(api.toJSON())
                refreshModified()
            }, SAVE_DELAY_MS)
        })
        api.onDidAddPanel(syncOpen)
        api.onDidRemovePanel((panel) => {
            if (isDeskPanelId(panel.id)) {
                rememberPanelGroup(panel.id as DeskPanelId, panel.api.group.id)
                // A closed panel is no longer the section the NavRail shows.
                if (useAppStore.getState().activeNavSection === panel.id) setActiveNavSection(null)
            }
            syncOpen()
        })
        // Keep the NavRail's highlight on the library panel last brought forward.
        api.onDidActivePanelChange((event) => {
            const id = event.panel?.id
            if (isLibraryPanelId(id) && useAppStore.getState().activeNavSection !== id) {
                setActiveNavSection(id)
            }
        })
    }, [setOpenPanels, setActiveNavSection])

    useEffect(() => () => attachDeskApi(null), [])

    const className = useMemo(() => `desk ${editing ? 'desk--editing' : ''}`, [editing])

    return (
        <div className={className}>
            {editing && <EditLayoutBar />}
            <div className="desk-dock">
                <DockviewReact
                    components={components}
                    tabComponents={tabComponents}
                    defaultTabComponent={DeskTab}
                    onReady={onReady}
                    theme={deskTheme}
                    disableFloatingGroups
                    // Moving and closing need Edit layout; splitters resize either way.
                    disableDnd={!editing}
                    getTabContextMenuItems={() => []}
                    singleTabMode="default"
                />
            </div>
        </div>
    )
}

function EditLayoutBar() {
    const setEditing = useDeskStore((s) => s.setEditing)
    return (
        <div className="desk-edit-bar" role="status">
            <span>
                <strong>Editing layout.</strong> Drag a tab to an edge to split, or onto another tab strip to stack it. Close panels with their ×.
            </span>
            <button type="button" onClick={() => setEditing(false)} className="desk-edit-done">
                Done
            </button>
        </div>
    )
}
