#!/usr/bin/env node
/**
 * Build the bundled dictionary packs shipped under `public/dictionaries/`.
 *
 * Why this exists
 * ---------------
 * The Dictionary panel has to answer a lookup *during* a service, on a church
 * laptop that may have no internet. So the data ships with the app, exactly
 * like `public/bibles/*.json` — but a dictionary is 10-100× more entries than
 * a Bible is verses, and Webster's alone is 22 MB. Loading that to answer one
 * lookup is not acceptable.
 *
 * So each pack is split into two things:
 *
 *   index.json   — every headword, and nothing else. Small enough to load up
 *                  front (Webster's: ~1 MB) and search instantly.
 *   <letter>.json — the definitions, sharded by the first letter of the
 *                  lookup key. Fetched only when an entry is actually opened.
 *
 * Search therefore costs one index fetch per pack; reading an entry costs one
 * shard fetch, cached in IndexedDB from then on.
 *
 * Usage
 * -----
 *   node scripts/build-dictionary-packs.mjs                 # all packs
 *   node scripts/build-dictionary-packs.mjs --only easton,smith
 *   node scripts/build-dictionary-packs.mjs --force         # re-download sources
 *
 * Downloaded sources are cached under `.cache/dictionary-sources/` (gitignored)
 * so re-running the build is offline and fast.
 *
 * The runtime loader is `src/hooks/useDictionary.ts`.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_ROOT = join(REPO_ROOT, 'public', 'dictionaries')
const CACHE_ROOT = join(REPO_ROOT, '.cache', 'dictionary-sources')

/** Bumped when the on-disk pack format changes; the client checks it. */
const FORMAT_VERSION = 1

const { values: args } = parseArgs({
    options: {
        only: { type: 'string' },
        out: { type: 'string', default: OUT_ROOT },
        force: { type: 'boolean', default: false },
    },
})

// ---------------------------------------------------------------------------
// Shared entry shape
//
// Keys are single letters because they repeat once per entry — over ~120k
// entries the difference between `word` and `w` is megabytes.
//
//   w  display headword ("Aaron", "ἀγάπη")
//   s  senses: [{ t: text, l?: label }]
//   r  scripture references, already normalised ("Exodus 4:14")
//   x  transliteration / pronunciation
//   m  lemma in the original script
//   n  Strong's number ("G26")
// ---------------------------------------------------------------------------

/** Uppercase, strip diacritics and punctuation — the lookup key. Must stay in
 *  sync with `normalizeDictionaryKey` in src/lib/search/dictionarySearch.ts. */
function normalizeKey(word) {
    return word
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Shard a key lands in: its first ASCII letter, else `_`. Strong's keys
 *  ("G26"/"H175") therefore fall into `g.json`/`h.json`, and non-Latin
 *  headwords into `_.json`. Must stay in sync with the client. */
function shardFor(key) {
    const first = key.slice(0, 1).toLowerCase()
    return /[a-z]/.test(first) ? first : '_'
}

/** Collapse the whitespace that survives XML/text extraction. */
function clean(text) {
    return String(text ?? '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim()
}

// ---------------------------------------------------------------------------
// Source download (cached)
// ---------------------------------------------------------------------------

async function fetchCached(url, cacheName) {
    const cachePath = join(CACHE_ROOT, cacheName)
    if (!args.force && existsSync(cachePath)) {
        const mb = (statSync(cachePath).size / 1024 / 1024).toFixed(1)
        console.log(`  cached  ${cacheName} (${mb} MB)`)
        return readFileSync(cachePath, 'utf8')
    }

    console.log(`  fetch   ${url}`)
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
            const body = await response.text()
            mkdirSync(CACHE_ROOT, { recursive: true })
            writeFileSync(cachePath, body)
            const mb = (Buffer.byteLength(body) / 1024 / 1024).toFixed(1)
            console.log(`  saved   ${cacheName} (${mb} MB)`)
            return body
        } catch (error) {
            lastError = error
            console.warn(`  retry   attempt ${attempt} failed: ${error.message}`)
        }
    }
    throw new Error(`Failed to download ${url}: ${lastError?.message}`)
}

// ---------------------------------------------------------------------------
// Pack builders
//
// Each returns { entries: Map<key, entry>, meta } — sharding, indexing and
// writing are shared below, so a new dictionary only needs a builder here.
// ---------------------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

/**
 * Easton's (1897) and Smith's (1863), parsed from CCEL ThML by
 * neuu-org/bible-dictionary-dataset. Already sharded a-z there, and — the
 * reason this source was chosen over the plainer Easton JSON dumps — every
 * entry carries its scripture references resolved to full book names, which
 * is what lets the panel turn "Ex 4:14" into a projectable Bible slide.
 */
async function buildCcelPack({ id, sourceDir }) {
    const entries = new Map()
    const base = `https://raw.githubusercontent.com/neuu-org/bible-dictionary-dataset/main/data/02_sources/${sourceDir}`

    for (const letter of LETTERS) {
        let raw
        try {
            raw = await fetchCached(`${base}/${letter}.json`, `${id}-${letter}.json`)
        } catch {
            // Not every dictionary has an entry for every letter (Easton's has
            // no X). A missing shard is expected, not a failure.
            continue
        }

        for (const record of Object.values(JSON.parse(raw))) {
            const display = clean(record.name)
            if (!display) continue
            const key = normalizeKey(display)
            if (!key) continue

            const senses = (record.definitions ?? [])
                .map((definition) => ({ t: clean(definition.text) }))
                .filter((sense) => sense.t.length > 0)
            if (senses.length === 0) continue

            const refs = [...new Set((record.scripture_refs ?? [])
                .map((ref) => cleanReference(ref.reference))
                .filter(Boolean))]

            mergeEntry(entries, key, { w: display, s: senses, ...(refs.length ? { r: refs } : {}) })
        }
    }

    return entries
}

/**
 * Strong's Greek/Hebrew from openscriptures. The file is a JS assignment
 * rather than JSON, so the object literal is sliced out of it.
 *
 * The lookup key is the Strong's number, not the lemma — an operator types
 * "agape" or "G26", never "ἀγάπη", so the transliteration and KJV glosses go
 * into the index's search text while the Greek/Hebrew stays as the display
 * form for projection.
 */
async function buildStrongsPack({ id, url, cacheName, globalName }) {
    const raw = await fetchCached(url, cacheName)
    const start = raw.indexOf('{', raw.indexOf(globalName))
    if (start === -1) throw new Error(`Could not find ${globalName} object literal`)

    // The file ends with `};` plus a trailing comment/newline in some revisions.
    const end = raw.lastIndexOf('}')
    const dictionary = JSON.parse(raw.slice(start, end + 1))

    const entries = new Map()
    for (const [strongsNumber, record] of Object.entries(dictionary)) {
        // "G0026" appears in some revisions; the app and every cross-reference
        // in the wild use the unpadded form.
        const key = strongsNumber.replace(/^([GH])0+/, '$1')
        const lemma = clean(record.lemma)
        const translit = clean(record.translit)
        const display = lemma || translit || key

        const senses = []
        const definition = clean(record.strongs_def)
        if (definition) senses.push({ t: definition })
        const kjvDefinition = clean(record.kjv_def).replace(/^--/, '')
        if (kjvDefinition) senses.push({ t: kjvDefinition, l: 'KJV usage' })
        const derivation = clean(record.derivation).replace(/;$/, '')
        if (derivation) senses.push({ t: derivation, l: 'Derivation' })
        if (senses.length === 0) continue

        entries.set(key, {
            w: display,
            s: senses,
            n: key,
            ...(translit ? { x: translit } : {}),
            ...(lemma ? { m: lemma } : {}),
        })
    }

    return entries
}

/**
 * Webster's 1913 (public domain) from matthewreagan/WebstersEnglishDictionary
 * — a flat `{ headword: definition }` map, one paragraph per word.
 */
async function buildWebsterPack() {
    const raw = await fetchCached(
        'https://raw.githubusercontent.com/matthewreagan/WebstersEnglishDictionary/master/dictionary_compact.json',
        'webster-1913.json',
    )

    const entries = new Map()
    for (const [word, definition] of Object.entries(JSON.parse(raw))) {
        const display = clean(word)
        const key = normalizeKey(display)
        if (!key) continue

        // Webster's runs etymology, senses and quotations together in one
        // string. Splitting on the numbered sense markers gives the panel
        // something it can show as a list, and the slide builder something it
        // can put on separate slides.
        const body = clean(definition).replace(/^Defn:\s*/i, '')
        if (!body) continue
        const senses = splitNumberedSenses(body).map((text) => ({ t: text }))

        mergeEntry(entries, key, { w: display, s: senses })
    }

    return entries
}

/** "1. first sense 2. second sense" -> ["first sense", "second sense"]. */
function splitNumberedSenses(body) {
    const parts = body.split(/(?:^|\s)(?=\d{1,2}\.\s+[A-Z(])/)
        .map((part) => clean(part).replace(/^\d{1,2}\.\s*/, ''))
        .filter(Boolean)
    return parts.length > 1 ? parts : [body]
}

/**
 * Tidy a scripture reference into something the app's parser accepts.
 *
 * The CCEL sources carry two artefacts of the original markup: a trailing
 * semicolon from a run of citations, and a "verse 0" placeholder used when the
 * citation was to a whole chapter ("Genesis 20:0-0" means Genesis 20). Left
 * alone, both make the reference unparseable and the panel's chip does nothing
 * when clicked.
 */
function cleanReference(reference) {
    const trimmed = clean(reference).replace(/[;,.]+$/, '')
    if (!trimmed) return ''

    // "Genesis 20:0-0" / "Genesis 20:0" -> "Genesis 20" (whole chapter).
    const chapterOnly = trimmed.match(/^(.+?\s+\d+):0(?:\s*-\s*0)?$/)
    if (chapterOnly) return chapterOnly[1]

    // "2 Kings 3:4-0" -> "2 Kings 3:4" (open-ended range).
    return trimmed.replace(/(:\d+)\s*-\s*0$/, '$1')
}

/**
 * Two headwords can normalise to the same key ("AI" and "Ai", "Ai" and "Aï").
 * Keep the first display form and append the senses rather than letting the
 * later entry silently overwrite a real definition.
 */
function mergeEntry(entries, key, entry) {
    const existing = entries.get(key)
    if (!existing) {
        entries.set(key, entry)
        return
    }
    existing.s.push(...entry.s)
    if (entry.r) existing.r = [...new Set([...(existing.r ?? []), ...entry.r])]
}

// ---------------------------------------------------------------------------
// Pack registry
// ---------------------------------------------------------------------------

const PACKS = [
    {
        id: 'easton',
        name: "Easton's Bible Dictionary",
        shortName: "Easton's",
        kind: 'bible',
        year: '1897',
        license: 'CC BY 4.0',
        attribution: "Easton's Bible Dictionary (M. G. Easton, 1897), public domain. Structured text: NEUU bible-dictionary-dataset, CC BY 4.0.",
        sourceUrl: 'https://github.com/neuu-org/bible-dictionary-dataset',
        build: () => buildCcelPack({ id: 'easton', sourceDir: 'easton' }),
    },
    {
        id: 'smith',
        name: "Smith's Bible Dictionary",
        shortName: "Smith's",
        kind: 'bible',
        year: '1863',
        license: 'CC BY 4.0',
        attribution: "Smith's Bible Dictionary (William Smith, 1863), public domain. Structured text: NEUU bible-dictionary-dataset, CC BY 4.0.",
        sourceUrl: 'https://github.com/neuu-org/bible-dictionary-dataset',
        build: () => buildCcelPack({ id: 'smith', sourceDir: 'smith' }),
    },
    {
        id: 'strongs-greek',
        name: "Strong's Greek Dictionary",
        shortName: 'Greek',
        kind: 'lexicon',
        year: '1890',
        license: 'CC BY-SA 3.0',
        attribution: "Strong's Greek Dictionary (James Strong, 1890), public domain. JSON edition © Open Scriptures, CC BY-SA.",
        sourceUrl: 'https://github.com/openscriptures/strongs',
        build: () => buildStrongsPack({
            id: 'strongs-greek',
            url: 'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js',
            cacheName: 'strongs-greek.js',
            globalName: 'strongsGreekDictionary',
        }),
    },
    {
        id: 'strongs-hebrew',
        name: "Strong's Hebrew Dictionary",
        shortName: 'Hebrew',
        kind: 'lexicon',
        year: '1894',
        license: 'CC BY-SA 3.0',
        attribution: "Strong's Hebrew Dictionary (James Strong, 1894), public domain. JSON edition © Open Scriptures, CC BY-SA.",
        sourceUrl: 'https://github.com/openscriptures/strongs',
        build: () => buildStrongsPack({
            id: 'strongs-hebrew',
            url: 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js',
            cacheName: 'strongs-hebrew.js',
            globalName: 'strongsHebrewDictionary',
        }),
    },
    {
        id: 'webster',
        name: "Webster's Dictionary",
        shortName: 'Webster',
        kind: 'english',
        year: '1913',
        license: 'Public domain',
        attribution: "Webster's Revised Unabridged Dictionary (1913), public domain.",
        sourceUrl: 'https://github.com/matthewreagan/WebstersEnglishDictionary',
        build: () => buildWebsterPack(),
    },
]

// ---------------------------------------------------------------------------
// Write a pack: shards + index
// ---------------------------------------------------------------------------

function writePack(pack, entries) {
    const outDir = join(args.out, pack.id)
    mkdirSync(outDir, { recursive: true })

    const shards = new Map()
    for (const [key, entry] of entries) {
        const shard = shardFor(key)
        if (!shards.has(shard)) shards.set(shard, {})
        shards.get(shard)[key] = entry
    }

    let bytes = 0
    for (const [shard, records] of shards) {
        const json = JSON.stringify(records)
        writeFileSync(join(outDir, `${shard}.json`), json)
        bytes += Buffer.byteLength(json)
    }

    // Index records are `display` alone where the key is derivable from it, and
    // `[display, key, searchText]` otherwise (Strong's, where you search by
    // transliteration but project the Greek). Mixing the two forms keeps the
    // Webster index — the one big enough to matter — at its smallest.
    //
    // Written in key order. The client binary-searches this array for prefix
    // matches, and sorting 102k records at load time costs a third of a second
    // it can spend instead on being responsive.
    const index = []
    for (const [key, entry] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const searchText = [entry.x, entry.n, entry.s[0]?.t?.slice(0, 60)]
            .filter(Boolean)
            .join(' ')
        if (normalizeKey(entry.w) === key && !entry.x && !entry.n) {
            index.push(entry.w)
        } else {
            index.push([entry.w, key, searchText])
        }
    }

    const indexJson = JSON.stringify({
        pack: pack.id,
        format: FORMAT_VERSION,
        entries: index,
    })
    writeFileSync(join(outDir, 'index.json'), indexJson)
    bytes += Buffer.byteLength(indexJson)

    return {
        shards: [...shards.keys()].sort(),
        entryCount: entries.size,
        bytes,
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const requested = args.only
    ? new Set(args.only.split(',').map((id) => id.trim()))
    : null

const selected = PACKS.filter((pack) => !requested || requested.has(pack.id))
if (selected.length === 0) {
    console.error(`No packs matched --only=${args.only}. Known: ${PACKS.map((p) => p.id).join(', ')}`)
    process.exit(1)
}

mkdirSync(args.out, { recursive: true })

// A partial run must not drop the packs it wasn't asked to build, so the
// existing manifest is read back and merged.
const manifestPath = join(args.out, 'manifest.json')
const previous = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { packs: [] }
const manifestPacks = new Map((previous.packs ?? []).map((pack) => [pack.id, pack]))

let totalBytes = 0
for (const pack of selected) {
    console.log(`\n${pack.name}`)
    const entries = await pack.build()
    if (entries.size === 0) throw new Error(`${pack.id}: produced no entries`)

    const { shards, entryCount, bytes } = writePack(pack, entries)
    totalBytes += bytes

    manifestPacks.set(pack.id, {
        id: pack.id,
        name: pack.name,
        shortName: pack.shortName,
        kind: pack.kind,
        year: pack.year,
        entryCount,
        shards,
        license: pack.license,
        attribution: pack.attribution,
        sourceUrl: pack.sourceUrl,
    })

    console.log(`  built   ${entryCount.toLocaleString()} entries, ${shards.length} shards, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
}

writeFileSync(manifestPath, JSON.stringify({
    format: FORMAT_VERSION,
    builtAt: new Date().toISOString(),
    packs: [...manifestPacks.values()].sort((a, b) => a.id.localeCompare(b.id)),
}, null, 2))

console.log(`\nWrote ${selected.length} pack(s) to ${args.out} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`)
