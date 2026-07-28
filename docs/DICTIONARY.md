# Dictionary

Look a word up mid-service and put the definition on screen — Bible names and
places, Greek and Hebrew terms, or plain English. Works offline: the data ships
with the app, like the Bibles.

**Where it is:** the 📖A icon in the Studio nav rail, below Media — the rail is
ordered by how often each surface gets reached, and Bible, songs and media are
reached far more often. Also reachable by ⌘K → "Define a Word", from the Quick
Actions panel, and under "More" in the mobile nav.

## What ships

| Pack | Source | Entries | Licence |
|---|---|---|---|
| Easton's Bible Dictionary (1897) | [CCEL ThML via `neuu-org/bible-dictionary-dataset`](https://github.com/neuu-org/bible-dictionary-dataset) | 3,961 | CC BY 4.0 (public-domain source) |
| Smith's Bible Dictionary (1863) | same | 4,488 | CC BY 4.0 (public-domain source) |
| Strong's Greek Dictionary (1890) | [`openscriptures/strongs`](https://github.com/openscriptures/strongs) | 5,523 | CC BY-SA 3.0 (JSON edition) |
| Strong's Hebrew Dictionary (1894) | same | 8,674 | CC BY-SA 3.0 (JSON edition) |
| Webster's Revised Unabridged (1913) | [`matthewreagan/WebstersEnglishDictionary`](https://github.com/matthewreagan/WebstersEnglishDictionary) | 102,040 | Public domain |

Every pack carries an `attribution` string in the manifest, and the panel shows
it under any entry it opens. Two of the packs are attribution-licensed, so that
credit line is a requirement, not a nicety — don't remove it.

## Building the packs

```bash
npm run build-dictionary-packs                  # all packs
node scripts/build-dictionary-packs.mjs --only easton,smith
node scripts/build-dictionary-packs.mjs --force  # re-download sources
```

Sources are cached under `.cache/dictionary-sources/` (gitignored), so re-runs
are offline. The built packs under `public/dictionaries/` **are** committed —
same as `public/bibles/` — so a clean checkout builds and runs without network
access. Webster's is ~26 MB of that; the rest total ~9 MB.

## On-disk layout

```
public/dictionaries/
├── manifest.json           # which packs exist, entry counts, licences
├── easton/
│   ├── index.json          # every headword, no definitions
│   ├── a.json … z.json     # definitions, sharded by first letter
├── strongs-greek/
│   ├── index.json
│   └── g.json              # Strong's keys are G-numbers, so one shard
└── webster/…
```

The split is what makes a 102k-entry dictionary usable during a service:

- **Searching** costs one `index.json` per pack (Webster's is ~1 MB) — loaded
  once, then cached in IndexedDB and in memory for the session.
- **Opening an entry** costs one shard. Prefix matches share a first letter, so
  a search usually needs one shard per pack, and it's cached from then on.

Entry keys inside a shard are normalised — uppercase, unaccented, punctuation
stripped (`AARON`, `WELLBEING`, `G26`). `normalizeDictionaryKey` and
`shardForKey` in `src/lib/search/dictionarySearch.ts` **must** stay in sync with
`normalizeKey`/`shardFor` in the build script; a divergence silently breaks
every lookup.

## How search ranks

Not BM25, unlike song and Bible-text search. A dictionary lookup is a headword
lookup — the operator knows the word and is typing it — so ranking by term
rarity would bury "love" under "lovelily". Instead:

1. **Exact** key match.
2. **Prefix** match, alphabetically (a binary search over the sorted keys, so
   Webster's stays instant per keystroke).
3. **Fuzzy** — only if the first two passes came up short. This is what keeps
   typing responsive; it also lets "agape" find `ἀγάπη` via the stored
   transliteration, and "G26" find it by number.

Across packs, match quality wins first and pack order breaks ties — Bible
dictionaries are ordered ahead of Webster's, because in a church "Aaron" means
the priest before it means anything else.

## Slides

A definition becomes a `dictionary` slide: the definition text in `contents[0]`,
a `Headword · Pack` caption in `contents[1]`. That is the same two-part shape a
Bible slide uses, and `src/utils/slideCaption.ts` is what tells every renderer
(live output, projection window, preview, slide card, mobile) to give the
caption its own zone instead of treating it as body text. Dictionary slides use
`layout: 'bible'` and inherit the scripture background and template defaults, so
a definition matches the verses it sits beside.

Long entries are split across slides at sentence boundaries
(`chunkDefinitionText`, 320 characters per slide by default) — Easton's articles
run past 2,000 characters, which is unreadable as one slide. Each sense can also
be queued on its own from the entry view, which is usually what a preacher
wants: one meaning, not the whole article.

## Scripture references

Easton's and Smith's entries carry their citations as structured data (55,253 of
them), so the entry view renders them as chips: click to queue the passage in
the church's own Bible version, shift-click to go live. `parseFullBibleReference`
handles the shapes that only appear in cited prose — multi-word book names
("Song of Solomon 2:1"), whole chapters ("Leviticus 8" → verse 1), and spans
crossing a chapter boundary ("Judges 8:33-9:6" → the opening verse, since a
`Scripture` holds one chapter and the alternative is wrong text under a
correct-looking label).

## Adding a dictionary

Add a builder and a registry entry in `scripts/build-dictionary-packs.mjs` —
normalise to the compact entry shape documented at the top of that file, and the
sharding, indexing and manifest are handled for you. Nothing in the app needs to
change: the panel is manifest-driven, and an unknown `kind` only affects
ordering. Check the licence permits redistribution, and put the credit line in
`attribution`.
