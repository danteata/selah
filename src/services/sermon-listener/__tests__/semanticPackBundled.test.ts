import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The desktop's search-by-meaning pack (src-tauri/semantic-packs) has to ship
 * on every platform. A platform config's `resources` replaces the base list
 * rather than adding to it, and the Windows and Linux ones were written
 * before the pack existed: from 0.1.29 to 0.1.43 those builds had no pack,
 * so typing a phrase in the Bible panel found nothing.
 */

const tauriDir = resolve(__dirname, '../../../../src-tauri')
const resources = (file: string) =>
    (JSON.parse(readFileSync(resolve(tauriDir, file), 'utf8')) as { bundle?: { resources?: string[] | Record<string, string> } })
        .bundle?.resources

function bundlesSemanticPacks(list: string[] | Record<string, string> | undefined): boolean {
    if (!list) return false
    const sources = Array.isArray(list) ? list : Object.keys(list)
    return sources.some((source) => source.startsWith('semantic-packs'))
}

describe('the search-by-meaning pack ships on every platform', () => {
    it.each(['tauri.conf.json', 'tauri.windows.conf.json', 'tauri.linux.conf.json'])('%s', (file) => {
        const list = resources(file)
        // A platform file without its own list inherits the base one.
        if (list === undefined && file !== 'tauri.conf.json') return
        expect(bundlesSemanticPacks(list)).toBe(true)
    })

    it('lands where the app looks for it', () => {
        const windows = resources('tauri.windows.conf.json') as Record<string, string>
        expect(windows['semantic-packs/']).toBe('semantic-packs/')
    })
})
