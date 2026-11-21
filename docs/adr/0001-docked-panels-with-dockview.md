# The operator's desk is a docked layout built on dockview

The fixed Studio workspace and the react-grid-layout Dashboard are replaced by one docked layout: panels always fill the window, are resized with splitters, and are moved by dragging a tab to an edge (split) or onto a tab strip (stack). The aim is that someone coming from EasyWorship or ProPresenter can rebuild the arrangement they know. We use dockview (`dockview-react`) for the docking.

## Considered Options

- **Keep react-grid-layout and fix it.** Rejected: a column grid with vertical compaction snaps and reflows panels the user didn't touch, sizes in fixed row heights that don't follow the window, and leaves holes. These are properties of the model, not bugs.
- **flexlayout-react.** A viable docking library, but less complete drag-to-dock behaviour and less active maintenance than dockview at the time of choosing.
- **Build splitters ourselves on react-resizable-panels.** Gives resizing but not tab stacks or drag-to-dock, which are the parts that are hard to get right.

## Consequences

- Panels are fine-grained (service order, Preview, Live, each library tool) so familiar layouts can be composed; Live Output's stacked/split/focus modes and the ContextPanel sidebar go away.
- Saved layouts are stored per device as dockview's serialised layout; the old grid layouts are discarded, not migrated.
- Moving, closing and adding panels needs an explicit Edit layout mode; resizing does not. Live can never be closed.
- Desktop only: narrow windows keep the fixed mobile workspace.
