import { useOnAir } from './useOnAir'
import { useLiveShortcuts } from './useLiveShortcuts'
import { LiveHeader } from './LiveHeader'
import { LiveMonitor } from './LiveMonitor'
import { OnAirControls } from './OnAirControls'
import { LiveVerseNavigator } from './LiveVerseNavigator'
import { SuggestedQueue } from './SuggestedQueue'

/**
 * Live: what's on air and every control for it — the outputs, previous/next,
 * the countdown and video transport, the verse navigator while scripture is
 * on air, and what contributors have suggested. The picture fits whatever
 * size the panel is given.
 */
export function LivePanel() {
    const onAir = useOnAir()
    useLiveShortcuts(onAir)

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <LiveHeader title="Live" isOnAir={!!onAir.liveSlide} />
            <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-3 overflow-y-auto custom-scrollbar">
                <LiveMonitor liveSlide={onAir.liveSlide} fit />
                <OnAirControls onAir={onAir} />
                <LiveVerseNavigator liveSlide={onAir.liveSlide} />
                <SuggestedQueue />
            </div>
        </div>
    )
}
