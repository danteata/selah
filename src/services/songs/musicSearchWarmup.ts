/**
 * Builds the songs panel's search index while the studio is idle, and again
 * whenever the song list changes, so opening the panel finds it ready and
 * you can search straight away (see musicLibraryIndex.ts).
 */
import { loadHymns } from '../../hooks/useHymn'
import { unifiedMusicIndexFor } from '../../lib/search/musicLibraryIndex'
import { getDeviceSongs, getLibrarySongs, loadDeviceSongs, subscribeDeviceSongs } from './deviceSongs'
import { subscribeServerSongs } from './serverSongs'

function whenIdle(run: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(run, { timeout: 5000 })
        return () => cancelIdleCallback(id)
    }
    const timer = setTimeout(run, 3000)
    return () => clearTimeout(timer)
}

/** Start keeping the index warm; returns a function that stops. */
export function keepMusicSearchWarm(): () => void {
    let stopped = false
    let cancel: (() => void) | null = null

    const warm = async () => {
        const [hymns] = await Promise.all([loadHymns(), getDeviceSongs() ?? loadDeviceSongs()])
        if (!stopped) unifiedMusicIndexFor(getLibrarySongs(), hymns)
    }
    const schedule = () => {
        if (stopped || cancel) return
        cancel = whenIdle(() => {
            cancel = null
            void warm()
        })
    }

    const unsubscribeServer = subscribeServerSongs(schedule)
    const unsubscribeDevice = subscribeDeviceSongs(schedule)
    schedule()
    return () => {
        stopped = true
        cancel?.()
        unsubscribeServer()
        unsubscribeDevice()
    }
}
