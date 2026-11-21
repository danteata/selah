# Docked desk layout

## Overview

Operators coming from EasyWorship (or ProPresenter, OBS) should be able to rebuild the desk
they know by moving and resizing panels. Today Selah has two workspaces: a fixed Studio and a
react-grid-layout Dashboard. The Dashboard can't do this: it snaps panels to a 12-column grid,
moves panels the operator never touched, sizes heights in fixed 40px rows, and offers four
panels that are too coarse. Live Output alone bundles Preview, program, Next Up, the on-air
controls and the sermon listener.

Both workspaces are replaced by one **docked layout** built on dockview (see
[ADR 0001](../docs/adr/0001-docked-panels-with-dockview.md)). Vocabulary is in
[GLOSSARY.md](../GLOSSARY.md) under "The operator's desk".

No backend changes. Layouts live on the device.

### Decisions (settled)

| | |
|---|---|
| Model | Docking: panels fill the window, splitters resize them, tabs drag to an edge (split) or onto a tab strip (stack). No floating panels and no pop-out windows. |
| Workspaces | One. "Studio" becomes the **Default layout**. |
| Panels | Service order, Preview, Live, Sermon listener, Bible, Songs & Hymns, Media, Dictionary, Templates, Countdown, Alerts. Library, Schedule and Settings stay as dialogs. Each panel can be open at most once. |
| Live | Cannot be closed. Holds every on-air control: previous/next, blank, media transport, the verse navigator when scripture is on air, and the screen/NDI picker. |
| Preview | Shows the **staged slide**, or **next up** (labelled) when nothing is staged. |
| Staging | Only from the service order. Private to each desk, never shared in a live session. Enter sends it from any panel (ignored while typing or when a button has focus). |
| Wording | "Active" becomes **On air** in Live and **staged** in the service order. |
| Quick Actions | Removed. "New text slide" and "New lower third" move to an **Add** menu on the service order. |
| NavRail | Shows that panel: brings it forward in its tab stack, or reopens it where it last was. On desktop the ContextPanel sidebar goes away. |
| Protection | Splitters always resize. Moving, closing and adding panels needs **Edit layout** mode. |
| Layouts | Built-in **Default** and **Classic**. The current arrangement autosaves per device. Saved layouts get Save / Save as…, and are marked *modified* after a change. Built-ins can only be saved as a copy. |
| Menu | One **Layout** menu in the TopBar: switch layout, Save / Save as…, Edit layout, Panels ▸, Reset to Default. It replaces the Studio/Dashboard toggle and the dashboard's floating dock. |
| Scope | Desktop only. Narrow windows keep `MobileStudioWorkspace`, along with its ContextPanel and `activeNavSection`. |
| Migration | Old dashboard layouts, preset and lock keys are discarded. Everyone starts on Default. |
| Rollout | The old Studio stays for one release behind Settings → "Use classic workspace", then is deleted. The Dashboard grid goes immediately. |
| Out of scope | Exporting, importing or sharing layouts. Staging from library panels. |

### Layouts

```
Default                                                Classic
┌──────────┬─────────┬────────────────┬───────────┐    ┌──────────┬──────────────┬──────────────┐
│          │ Preview │                │ Bible │ … │    │ Service  │   Preview    │     Live     │
│ Service  ├─────────┤      Live      │  library  │    │  order   │              │              │
│  order   │ Sermon  │                │ tab stack │    ├──────────┴──────────────┴──────────────┤
│          │listener │                │           │    │ Bible │ Songs & Hymns │ Media │ Sermon … │
└──────────┴─────────┴────────────────┴───────────┘    └─────────────────────────────────────────┘
```

**Done means** a tester can start from Default and rebuild Classic by dragging and resizing
alone, without being told how.

---

## Slices

Each slice ships on its own and leaves the app working.

### 1. The staged slide becomes a real thing

Today the staged slide is local `useState` in `PreviewContent.tsx:13`, and the Enter-to-send
handler (`PreviewContent.tsx:126-140`) only works while the service order is mounted. A
Preview panel elsewhere on the desk needs to read the staged slide, so it moves into shared
state.

- Add `stagedSlideId` and `setStagedSlide` to `appStore`. Keep it local: not in `partialize`,
  not synced through the live session.
- `PreviewContent` reads and writes it. Removing a slide clears it if it was staged
  (`PreviewContent.tsx:146`).
- Move Enter-to-send to a hook mounted once in the shell (`useSendStagedSlide`). Keep the
  existing guards: typing, focused button or link, `canGoLive`, already on air.
- Add `selectNextUp(state)`, the slide after the one on air in the service order. Today it is
  computed inside `LiveOutput`.
- Rename the label "Active" to "On air" (`LiveOutput.tsx:793`). Name the queue highlight
  "staged" in titles and aria labels.

Tests: staging survives a re-render of the service order. Enter sends from outside the
service order and is ignored in inputs. Removing the staged slide clears it. `selectNextUp`
handles the edges (nothing on air, last slide, song groups).

### 2. Split Live Output into panels

Break `LiveOutput.tsx` (1055 lines) into parts that can stand alone. The old `LiveOutput`
becomes a thin composition of them, so the classic Studio fallback looks the same.

- `live/LivePanel.tsx`: the program feed, previous/next, blank, media transport, the verse
  navigator (when scripture is on air), and the screen/NDI picker in its header. It must work
  from narrow to wide without the `stacked/split/focus` modes, so it chooses its own
  arrangement from its size (container query or ResizeObserver).
- `live/PreviewPanel.tsx`: the staged slide drawn with output settings, as Next Up is today
  (`LiveOutput.tsx:146-151`). Falls back to next up, labelled "Next Up". A Send button sits
  beside it.
- `sermon-listener/SermonListenerPanel` is already its own component. The desk mounts it
  directly.
- The old `LiveOutput` keeps `liveOutputLayout`, `sermonShownInSidebar` and
  `lastContentSection` for the fallback only. Nothing in the desk reads them.

No visible change in this slice. Tests: the existing `LiveOutput` tests still pass, and
`LivePanel` and `PreviewPanel` each get render tests (on air / blank / nothing on air, staged
/ next up / empty).

### 3. Add menu on the service order

This has to land before Quick Actions is removed.

- An **Add** menu on the service order with Text slide, Lower third, and the
  `appWideActions` creators Quick Actions exposes today (`QuickActionsSidebar.tsx:35-36`).
  Reuse `useQuickActionHandlers`.

### 4. The docked desk

New module `src/components/desk/`. Add `dockview-react`.

- `panels.tsx`: a registry of `DeskPanelId → { title, icon, component, minimumWidth,
  minimumHeight, closable }`. Live is `closable: false`. Library panels wrap the existing
  section bodies (`ContextSectionContent` in `ContextPanel.tsx`), lifted out so they don't
  depend on the sidebar.
- `layouts.ts`: the Default and Classic layouts, built with the dockview API (not
  hand-written JSON, so they stay valid across dockview versions).
- `layoutStorage.ts`: per-device storage under a new versioned key. Every read and write is
  wrapped in try/catch. A layout that fails to load or names an unknown panel falls back to
  Default, and the failure is logged. On first run it deletes `selah-dashboard-layout`,
  `selah-dashboard-preset` and `selah-dashboard-edit-locked`.
- `DeskWorkspace.tsx`: a `DockviewReact` mounted in the workspace slot of `AppShell`.
  - **Edit layout** off: tabs can't be dragged and close buttons are hidden, but sashes still
    resize.
  - Edit layout on: everything works except closing Live. A visible edge or tint shows the
    mode is on, and there is an obvious Done.
  - Saves the current arrangement on change, debounced.
- `showPanel(id)` replaces `setActiveNavSection` on the desktop desk. If the panel is open it
  is activated. If it is closed it is reopened in its last group, else at a sensible default
  position. Wire it to `NavRail`, `CommandBar`, `ListeningChip` and the `StatusBar` sermon
  toggle. Mobile keeps `activeNavSection`, unchanged.
- On the desk, `AppShell` doesn't render `ContextPanel`.
- **Layout menu** in the TopBar, replacing the workspace toggle at `TopBar.tsx:227`: Default,
  Edit layout, Panels ▸ (each panel with a check; Live is always checked and disabled), Reset
  to Default.
- Settings → "Use classic workspace" mounts the old `StudioWorkspace` instead. Replace
  `workspaceMode` with this boolean and drop the `'dashboard'` value.
- Delete `components/dashboard/*`, `types/dashboard.ts`, `QuickActionsSidebar` and their
  tests. Remove `react-grid-layout` and `react-resizable` from `package.json`.

Tests:
- Storage round-trip, plus corrupt JSON, blocked storage and an unknown panel id.
- Live can't be closed, through the UI or Panels ▸.
- `showPanel` both activates an open panel and reopens a closed one.
- With Edit layout off, nothing can be dragged or closed, but resizing still works.
- Old keys are removed.
- The classic workspace toggle mounts the old Studio.

Manual: run it in Tauri on a 1080p display and a 1366×768 laptop. Check that panel minimums
hold, that the layout fills the window, and that it survives a restart.

### 5. Classic and saved layouts

- Add Classic to the Layout menu.
- Saved layouts: Save as… (name prompt, in-app, not `window.prompt`), Save, Rename, Delete.
  The menu marks the loaded layout *modified* once the arrangement differs from what was
  saved. Default and Classic offer only Save as….
- Tests: saving, loading, modified detection, built-ins read-only, and deleting the layout
  that is loaded (falls back to the autosaved current arrangement).
- **Acceptance:** the Default → Classic rebuild with a tester who hasn't seen the feature.
  Note where they hesitate and fix the cues (drop-target overlays, tab affordance, the Edit
  layout prompt) before calling it done.

### 6. Remove the fallback (next release)

- Delete the old `StudioWorkspace`, the Settings toggle, `liveOutputLayout`,
  `slideQueueWidth`, the desktop-only parts of `ContextPanel` (`panelMode`, `panelPosition`,
  `contextPanelWidth`), and the old `LiveOutput` composition. Remove them from `partialize`.
- Keep what mobile still uses: `activeNavSection` and the ContextPanel overlay path in
  `MobileBottomNav`.
- `store/__tests__/sermonLayout.test.ts` and the sermon-in-sidebar special cases go.

## Risks

- **Panel content assumes its old size.** `PreviewContent`, the library lists and the sermon
  listener were built for one width. Slice 2 deals with Live. The others need a pass at their
  minimum sizes during slice 4.
- **Keyboard shortcuts that relied on focus or mounting**, such as verse navigation priority
  (`useClaimLiveNavigation`). A panel hidden in a background tab may stay mounted or unmount
  depending on dockview's renderer setting. Choose `always` rendering for Live and Preview so
  their shortcuts and NDI/output hooks never unmount.
- **NDI and alternate output hooks live inside `LiveOutput`** (`useNdiOutput`,
  `useAlternateOutput`). They must keep running whatever the layout. Consider lifting them
  into the shell in slice 2 rather than leaving them in a panel.
