import { useSongTracker } from '../../hooks/useSongTracker'
import { useSongAutoDetect } from '../../hooks/useSongAutoDetect'

/**
 * Headless bridge that runs the song features for the whole session:
 *  - {@link useSongAutoDetect} identifies + pulls up a song when singing starts,
 *  - {@link useSongTracker} advances it once it's live.
 *
 * Must be mounted inside <SermonListenerProvider> so the hooks can read the
 * shared transcript stream. Renders nothing.
 */
export function SongTrackerBridge() {
    useSongAutoDetect()
    useSongTracker()
    return null
}
