# Bundled Bible JSON files

Drop one file per Bible version here, lowercased. The app reads these as static
assets at runtime — see `useScripture.ts` and `BUNDLED_BIBLE_URL`.

```
public/bibles/
├── kjv.json
├── nkjv.json
├── niv.json
├── amp.json
├── nlt.json
└── tpt.json
```

## Format

Each file is a JSON array of verse objects with the shape defined in
`src/types/index.ts` (`BibleVerse`):

```ts
interface BibleVerse {
  book: string       // either a book name ("Genesis") or a 1-66 index
  chapter: string    // 1-indexed, as a string to match existing data
  verse: string      // 1-indexed, as a string
  scripture: string  // the verse text
}
```

The existing data in Convex storage (or the CloudFront CDN at
`https://d37gopmfkl2m2z.cloudfront.net/open/bible-versions/{id}.json`)
already matches this shape — you can copy those JSON files directly into this
directory.

## How it's served

Vite copies everything in `public/` into the build output as-is. So:

- **Web**: served by your host with normal HTTP cache headers. After the first
  visit, the browser cache serves it for the lifetime of the deployment.
- **Tauri desktop**: bundled into the `.app` and served via the
  `tauri://localhost` protocol. Works fully offline.

## Lookup chain

`useScripture.downloadBibleVersion(version)` tries, in order:

1. **IndexedDB** — instant, after the first cache hit
2. **`/bibles/{version}.json`** (this directory) — one fetch per version, then HTTP-cached
3. CloudFront CDN — last-resort fallback for versions not yet bundled

Convex is **not** in the chain. The Bible files previously stored in Convex are
kept as cold backup only — see `convex/bibleVersions.ts:saveBibleVersion` for the
admin upload path. The client never reads from Convex.

## After dropping files in

1. Run `pnpm dev` (or `pnpm tauri dev`) — Vite picks them up automatically.
2. Open the Bible settings panel. The first lookup for each version will fetch
   from `/bibles/...` and cache to IndexedDB.
3. Subsequent lookups hit IndexedDB. The bundled asset is read at most once per
   version per browser.
