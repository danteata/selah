/**
 * Headword search across the bundled dictionary packs.
 *
 * Deliberately not BM25 (unlike songs and Bible text). A dictionary lookup is
 * a *headword* lookup: the operator knows the word, they are typing it, and
 * they want it at the top before they finish. Ranking by term rarity over
 * 120k one-word documents would bury "love" under "lovelily".
 *
 * So the order is: exact key, then alphabetical prefix, then fuzzy — and fuzzy
 * only runs when the cheap passes come up short. Prefix search is a binary
 * search over the pack's sorted keys, which stays instant per keystroke even
 * with Webster's 102k entries.
 */

import fuzzysort from 'fuzzysort'
import type { DictionaryPack } from '../../types'

/** One headword, as it appears in a pack's `index.json`. */
export interface DictionaryIndexRecord {
    /** Normalised lookup key ("AARON", "G26"). */
    key: string
    /** Display headword ("Aaron", "ἀγάπη"). */
    word: string
    /** Extra searchable text — transliteration, Strong's number, first gloss. */
    search: string
    packId: string
}

export interface DictionaryIndex {
    packId: string
    /** Records sorted by `key`, so prefix scans are a binary search + walk. */
    records: DictionaryIndexRecord[]
    byKey: Map<string, DictionaryIndexRecord>
}

export type DictionaryMatchType = 'exact' | 'prefix' | 'fuzzy'

export interface DictionaryMatch {
    record: DictionaryIndexRecord
    matchType: DictionaryMatchType
    score: number
}

/** The on-disk index record form: a bare display word, or [word, key, search]. */
export type RawIndexRecord = string | [word: string, key?: string, search?: string]

export interface RawDictionaryIndex {
    pack: string
    format: number
    entries: RawIndexRecord[]
}

const PLAIN_ASCII_WORD = /^[A-Za-z]+$/

/**
 * Uppercase, strip diacritics and punctuation.
 *
 * Must stay in sync with `normalizeKey` in scripts/build-dictionary-packs.mjs —
 * the packs are keyed by its output, so a divergence silently breaks lookups.
 */
export function normalizeDictionaryKey(word: string): string {
    // Plain A-Z headwords — 94% of Webster's — need nothing but an uppercase,
    // and taking that shortcut halves the cost of parsing its 102k-entry index,
    // which the operator waits on before their first search.
    if (PLAIN_ASCII_WORD.test(word)) return word.toUpperCase()
    return word
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Which shard file holds a key: its first ASCII letter, else `_`.
 *
 * Must stay in sync with `shardFor` in scripts/build-dictionary-packs.mjs.
 * Strong's keys ("G26"/"H175") land in `g.json`/`h.json`; non-Latin headwords
 * land in `_.json`.
 */
export function shardForKey(key: string): string {
    const first = key.slice(0, 1).toLowerCase()
    return /[a-z]/.test(first) ? first : '_'
}

/** Fold to a lowercase ASCII-ish form so "agape" matches "agápē". */
function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
}

export function parseDictionaryIndex(raw: RawDictionaryIndex): DictionaryIndex {
    const records: DictionaryIndexRecord[] = []

    for (const entry of raw.entries) {
        if (typeof entry === 'string') {
            const key = normalizeDictionaryKey(entry)
            if (!key) continue
            records.push({ key, word: entry, search: fold(entry), packId: raw.pack })
            continue
        }
        const [word, key, search] = entry
        const resolvedKey = key || normalizeDictionaryKey(word)
        if (!resolvedKey) continue
        records.push({
            key: resolvedKey,
            word,
            search: fold([word, search].filter(Boolean).join(' ')),
            packId: raw.pack,
        })
    }

    // The build script writes records in key order, and re-sorting 102k of them
    // costs a third of a second on the operator's first search. Verify instead —
    // one linear pass — and only sort a pack that wasn't written in order.
    let ordered = true
    for (let i = 1; i < records.length; i++) {
        if (records[i - 1].key > records[i].key) {
            ordered = false
            break
        }
    }
    if (!ordered) {
        records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    }

    // Duplicate keys cannot happen — the build script merges them — but if a
    // pack ever ships one, the first record wins, matching the shard's single
    // entry for that key.
    const byKey = new Map<string, DictionaryIndexRecord>()
    for (const record of records) {
        if (!byKey.has(record.key)) byKey.set(record.key, record)
    }

    return { packId: raw.pack, records, byKey }
}

/** Index of the first record whose key is >= `target`. */
function lowerBound(records: DictionaryIndexRecord[], target: string): number {
    let low = 0
    let high = records.length
    while (low < high) {
        const mid = (low + high) >>> 1
        if (records[mid].key < target) low = mid + 1
        else high = mid
    }
    return low
}

export function searchDictionaryIndex(
    index: DictionaryIndex,
    query: string,
    limit = 25,
): DictionaryMatch[] {
    const key = normalizeDictionaryKey(query)
    if (!key) return []

    const matches: DictionaryMatch[] = []
    const seen = new Set<string>()

    const push = (record: DictionaryIndexRecord, matchType: DictionaryMatchType, score: number) => {
        if (seen.has(record.key)) return
        seen.add(record.key)
        matches.push({ record, matchType, score })
    }

    const exact = index.byKey.get(key)
    if (exact) push(exact, 'exact', 1)

    // Alphabetical prefix walk. Shorter keys sort first among a shared prefix,
    // so "LOVE" precedes "LOVELILY" without extra scoring.
    for (let i = lowerBound(index.records, key); i < index.records.length; i++) {
        const record = index.records[i]
        if (!record.key.startsWith(key)) break
        if (matches.length >= limit) break
        push(record, 'prefix', 1 - (record.key.length - key.length) / 1000)
    }

    // Only pay for fuzzy matching when the prefix pass didn't fill the list —
    // this is what keeps a 102k-entry pack responsive per keystroke.
    if (matches.length < limit && key.length >= 2) {
        const folded = fold(query.trim())
        const fuzzy = fuzzysort.go(folded, index.records, {
            keys: ['search', 'key'],
            limit: limit - matches.length,
            threshold: 0.4,
        })
        for (const result of fuzzy) {
            push(result.obj, 'fuzzy', result.score)
        }
    }

    return matches
}

const MATCH_TYPE_RANK: Record<DictionaryMatchType, number> = {
    exact: 0,
    prefix: 1,
    fuzzy: 2,
}

/**
 * Search several packs and interleave the results.
 *
 * Pack order is the caller's preference order (the panel's filter order), and
 * is the tiebreak after match quality — so with Easton's first, "Aaron" shows
 * Easton's above Smith's, but an exact Webster hit still beats a fuzzy one.
 */
export function searchDictionaries(
    indexes: DictionaryIndex[],
    query: string,
    options: { limit?: number; limitPerPack?: number; packOrder?: DictionaryPack[] } = {},
): DictionaryMatch[] {
    const { limit = 40, limitPerPack = 25 } = options
    const packRank = new Map(
        (options.packOrder ?? []).map((pack, position) => [pack.id, position]),
    )

    const all = indexes.flatMap((index) => searchDictionaryIndex(index, query, limitPerPack))

    return all
        .sort((a, b) => {
            const byType = MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType]
            if (byType !== 0) return byType
            if (b.score !== a.score) return b.score - a.score
            const rankA = packRank.get(a.record.packId) ?? Number.MAX_SAFE_INTEGER
            const rankB = packRank.get(b.record.packId) ?? Number.MAX_SAFE_INTEGER
            if (rankA !== rankB) return rankA - rankB
            return a.record.key < b.record.key ? -1 : 1
        })
        .slice(0, limit)
}

/**
 * Webster's headwords are stored lowercase ("propitiation"); Easton's and
 * Smith's are already cased. Capitalising the lowercase ones keeps a projected
 * definition from opening on a lowercase word.
 *
 * Only ASCII-lowercase headwords are touched. A Greek lemma must project as
 * "ἀγάπη", not "Ἀγάπη" — the capital is a different letter form that no
 * lexicon prints, and Hebrew has no case at all.
 */
export function formatHeadword(word: string): string {
    if (!word) return ''
    if (!/^[a-z]/.test(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1)
}
