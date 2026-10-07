/**
 * Undo the part of the old bundled song library that should never have
 * reached anyone's machine.
 *
 * Earlier builds seeded every desktop install with ~2,900 entries from one
 * church's EasyWorship export (ids `ew_<n>`). About 116 of them were not songs
 * but that church's sermon outlines, prayer points, announcements and house
 * rules — one carries a member's phone number. The library no longer ships;
 * this removes those non-song entries from installs that already received
 * them.
 *
 * Deliberately narrow:
 *  - only seeded ids (`ew_`), never a song the church added itself;
 *  - only entries `nonSongReason` identifies as documents — seeded real songs
 *    stay, because a church may already have them in its service orders;
 *  - only entries never edited since seeding (seeding wrote `createdAt` and
 *    `updatedAt` together), so nothing a user changed is thrown away.
 *
 * Runs once per profile.
 */
import { getIndexedDB } from '../../hooks/useIndexedDB'
import { nonSongReason } from '../../lib/songLibraryFilter'
import type { Song } from '../../types'

const DONE_KEY = 'selah:ew-nonsong-cleanup'
/** The old seeder's version flag — meaningless now the asset is gone. */
const OLD_SEED_FLAG_KEY = 'selah:ew-songs-seeded-version'

export async function removeBundledNonSongs(): Promise<number> {
    try {
        if (localStorage.getItem(DONE_KEY)) return 0
    } catch {
        return 0
    }
    try {
        const db = getIndexedDB()
        const seeded = await db.library.where('id').startsWith('ew_').toArray()
        const doomed = seeded
            .filter((item) => item.type === 'song' && item.createdAt === item.updatedAt)
            .filter((item) => nonSongReason(item.content as Song) !== null)
            .map((item) => item.id)
        if (doomed.length > 0) await db.library.bulkDelete(doomed)
        try {
            localStorage.setItem(DONE_KEY, '1')
            localStorage.removeItem(OLD_SEED_FLAG_KEY)
        } catch {
            // Storage unavailable: the cleanup simply runs again next launch.
        }
        return doomed.length
    } catch (err) {
        console.warn('[songs] Could not remove bundled non-song entries:', err)
        return 0
    }
}
