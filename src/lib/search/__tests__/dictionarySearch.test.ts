import { describe, it, expect } from 'vitest'
import {
    normalizeDictionaryKey,
    shardForKey,
    parseDictionaryIndex,
    searchDictionaryIndex,
    searchDictionaries,
    formatHeadword,
    type RawDictionaryIndex,
} from '../dictionarySearch'

const EASTON: RawDictionaryIndex = {
    pack: 'easton',
    format: 1,
    entries: ['Aaron', 'Aaronites', 'Abaddon', 'Love', 'Song of Solomon'],
}

const WEBSTER: RawDictionaryIndex = {
    pack: 'webster',
    format: 1,
    entries: ['love', 'lovelily', 'loveliness', 'propitiation'],
}

const GREEK: RawDictionaryIndex = {
    pack: 'strongs-greek',
    format: 1,
    entries: [
        ['ἀγάπη', 'G26', 'agápē G26 love, i.e. affection or benevolence'],
        ['ἀγαπάω', 'G25', 'agapáō G25 to love'],
    ],
}

describe('normalizeDictionaryKey', () => {
    it('uppercases and strips diacritics so accents do not hide an entry', () => {
        expect(normalizeDictionaryKey('agápē')).toBe('AGAPE')
        expect(normalizeDictionaryKey('Aï')).toBe('AI')
    })

    it('drops punctuation but keeps internal spacing', () => {
        expect(normalizeDictionaryKey('well-being')).toBe('WELLBEING')
        expect(normalizeDictionaryKey('  Song of  Solomon ')).toBe('SONG OF SOLOMON')
    })

    it('leaves Strong\'s numbers usable as keys', () => {
        expect(normalizeDictionaryKey('G26')).toBe('G26')
        expect(normalizeDictionaryKey('h175')).toBe('H175')
    })
})

describe('shardForKey', () => {
    it('shards Latin headwords by first letter', () => {
        expect(shardForKey('AARON')).toBe('a')
        expect(shardForKey('PROPITIATION')).toBe('p')
    })

    it('puts Greek and Hebrew Strong\'s numbers in their own shards', () => {
        expect(shardForKey('G26')).toBe('g')
        expect(shardForKey('H175')).toBe('h')
    })

    it('falls back to the catch-all shard for non-Latin keys', () => {
        expect(shardForKey('ΑΓΑΠΗ')).toBe('_')
    })
})

describe('parseDictionaryIndex', () => {
    it('derives the key from a bare display word', () => {
        const index = parseDictionaryIndex(WEBSTER)
        expect(index.byKey.get('PROPITIATION')?.word).toBe('propitiation')
    })

    it('keeps the explicit key and search text of a lexicon record', () => {
        const index = parseDictionaryIndex(GREEK)
        const record = index.byKey.get('G26')
        expect(record?.word).toBe('ἀγάπη')
        expect(record?.search).toContain('agape')
    })

    it('sorts records by key so prefix scans can binary search', () => {
        const keys = parseDictionaryIndex(EASTON).records.map((r) => r.key)
        expect(keys).toEqual([...keys].sort())
    })
})

describe('searchDictionaryIndex', () => {
    it('puts the exact headword first', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(WEBSTER), 'love')
        expect(results[0].record.word).toBe('love')
        expect(results[0].matchType).toBe('exact')
    })

    it('ranks a shorter prefix match above a longer one', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(WEBSTER), 'lovel')
        expect(results.map((r) => r.record.word)).toEqual(['lovelily', 'loveliness'])
    })

    it('finds a Greek entry by its transliteration', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(GREEK), 'agape')
        expect(results[0].record.word).toBe('ἀγάπη')
    })

    it('finds a Greek entry by its Strong\'s number', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(GREEK), 'G26')
        expect(results[0].record.key).toBe('G26')
        expect(results[0].matchType).toBe('exact')
    })

    it('matches a multi-word headword typed without exact spacing', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(EASTON), 'song of solomon')
        expect(results[0].record.word).toBe('Song of Solomon')
    })

    it('returns nothing for an empty or punctuation-only query', () => {
        const index = parseDictionaryIndex(EASTON)
        expect(searchDictionaryIndex(index, '')).toEqual([])
        expect(searchDictionaryIndex(index, '   ...  ')).toEqual([])
    })

    it('never returns the same entry twice across passes', () => {
        const results = searchDictionaryIndex(parseDictionaryIndex(WEBSTER), 'love')
        const keys = results.map((r) => r.record.key)
        expect(new Set(keys).size).toBe(keys.length)
    })
})

describe('searchDictionaries', () => {
    const indexes = [EASTON, WEBSTER, GREEK].map(parseDictionaryIndex)
    const packs = [
        { id: 'easton', shortName: "Easton's", kind: 'bible' as const },
        { id: 'strongs-greek', shortName: 'Greek', kind: 'lexicon' as const },
        { id: 'webster', shortName: 'Webster', kind: 'english' as const },
    ].map((pack) => ({
        ...pack,
        name: pack.shortName,
        entryCount: 0,
        shards: [],
        license: '',
        attribution: '',
    }))

    it('breaks ties by the caller\'s pack order', () => {
        // "Love" is an exact match in both Easton's and Webster's; Easton's is
        // listed first, so a church searching a Bible term sees it first.
        const results = searchDictionaries(indexes, 'love', { packOrder: packs })
        const exact = results.filter((r) => r.matchType === 'exact')
        expect(exact[0].record.packId).toBe('easton')
        expect(exact.map((r) => r.record.packId)).toContain('webster')
    })

    it('ranks an exact match in a low-priority pack above a prefix match in a high-priority one', () => {
        const results = searchDictionaries(indexes, 'propitiation', { packOrder: packs })
        expect(results[0].record.packId).toBe('webster')
    })

    it('honours the overall result limit', () => {
        const results = searchDictionaries(indexes, 'a', { limit: 2 })
        expect(results.length).toBe(2)
    })
})

describe('formatHeadword', () => {
    it('capitalises Webster\'s lowercase headwords for projection', () => {
        expect(formatHeadword('propitiation')).toBe('Propitiation')
    })

    it('leaves already-cased and non-Latin headwords alone', () => {
        expect(formatHeadword('Song of Solomon')).toBe('Song of Solomon')
        expect(formatHeadword('ἀγάπη')).toBe('ἀγάπη')
    })

    it('tolerates an empty word', () => {
        expect(formatHeadword('')).toBe('')
    })
})
