import { useAppStore } from '../../store/appStore'

/**
 * Settings → Display: go back to the old fixed Studio while the docked desk
 * settles in. Goes away in the release after the desk ships.
 */
export function ClassicWorkspaceSetting() {
    const classicWorkspace = useAppStore((s) => s.classicWorkspace)
    const setClassicWorkspace = useAppStore((s) => s.setClassicWorkspace)
    return (
        <div className="mt-8 pt-6 border-t border-[var(--border-subtle)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Desk</h3>
            <div className="flex items-center justify-between gap-4">
                <div>
                    <label htmlFor="classic-workspace" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Use classic workspace
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        The fixed Studio from before panels could be moved. It will be removed in a coming release.
                    </p>
                </div>
                <button
                    id="classic-workspace"
                    role="switch"
                    aria-checked={classicWorkspace}
                    aria-label="Use classic workspace"
                    onClick={() => setClassicWorkspace(!classicWorkspace)}
                    className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${classicWorkspace ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                        style={{ transform: classicWorkspace ? 'translateX(24px)' : 'translateX(0)' }}
                    />
                </button>
            </div>
        </div>
    )
}
