/**
 * StudioWorkspace — The main workspace content inside the AppShell.
 * 
 * Two-pane split layout:
 * - Left:  Slide Queue (vertical list of all slides)
 * - Right: Live Preview Monitor (16:9 aspect ratio)
 */
import { useMemo } from 'react'
import { PreviewContent } from '../preview/PreviewContent'
import { LiveOutput } from '../live/LiveOutput'

export function StudioWorkspace() {
    return (
        <div className="studio-workspace-split">
            {/* Slide Queue — left pane */}
            <div className="studio-slide-queue">
                <PreviewContent />
            </div>

            {/* Live Preview Area — right pane */}
            <div className="studio-live-area">
                <LiveOutput />
            </div>
        </div>
    )
}
