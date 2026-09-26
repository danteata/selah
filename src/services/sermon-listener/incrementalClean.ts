/**
 * Clean an ever-growing transcript without re-cleaning all of it every time.
 *
 * The sermon listener runs command stripping, hallucination and filler
 * filters and proper-noun correction before detection. It used to run them
 * over the entire transcript on every final result and every interim debounce:
 * ~30ms at 10k characters and ~56ms at 100k (about two hours in), on the main
 * thread, several times a second — work growing with the square of the
 * service's length.
 *
 * Each call's text is the committed transcript, optionally followed by an
 * interim tail. The cleaned committed text is cached, so only what was added
 * since is cleaned. A text that doesn't extend the cache at a word boundary
 * (a reset, an edited transcript) is cleaned in full, as before.
 */

export interface CleanCache {
    /** Identifies the cleaning settings the cache was built with. */
    key: string
    raw: string
    clean: string
}

export function createCleanCache(): CleanCache {
    return { key: '', raw: '', clean: '' }
}

export function cleanIncrementally(
    text: string,
    clean: (text: string) => string,
    cache: CleanCache,
    settingsKey: string,
    /** True when `text` is the committed transcript, to be remembered. */
    commit: boolean,
): string {
    if (cache.key !== settingsKey) {
        cache.key = settingsKey
        cache.raw = ''
        cache.clean = ''
    }

    const extendsCache =
        cache.raw.length > 0 &&
        text.startsWith(cache.raw) &&
        (text.length === cache.raw.length || /\s/.test(text[cache.raw.length]))

    let result: string
    if (extendsCache) {
        const tail = text.slice(cache.raw.length).trim()
        const cleanTail = tail ? clean(tail) : ''
        result = !cleanTail ? cache.clean : cache.clean ? `${cache.clean} ${cleanTail}` : cleanTail
    } else {
        result = clean(text)
    }

    if (commit) {
        cache.raw = text
        cache.clean = result
    }
    return result
}
