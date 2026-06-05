#!/usr/bin/env node
/**
 * serve-updates.mjs — local dev helper for the Tauri updater.
 *
 * What it does:
 *   Serves the project root over HTTP on port 8787 so the running desktop
 *   app can fetch `latest.json` (and any test bundles) from
 *   `http://localhost:8787/latest.json`.  Matches the endpoint you have
 *   configured in `src-tauri/tauri.conf.json` under
 *   `plugins.updater.endpoints`.
 *
 * How to use it:
 *   1. Place a `latest.json` at the project root (copy from
 *      `latest.json.template` and edit).
 *   2. From another terminal, run:
 *        node scripts/serve-updates.mjs
 *   3. In the desktop app, open Settings → Updates → "Check for updates".
 *      The app will hit `http://localhost:8787/latest.json` and act on it.
 *
 * Why port 8787:
 *   Matches the default in `tauri.conf.json` so the config and the
 *   helper stay in lockstep.  Change both if you need a different port.
 *
 * Exit: Ctrl-C.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const PORT = 8787
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')

const MIME = {
    '.json': 'application/json; charset=utf-8',
    '.sig': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.tar.gz': 'application/gzip',
    '.zip': 'application/zip',
}

const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new url.URL(req.url, `http://${req.headers.host}`).pathname)
    const filePath = path.normalize(path.join(ROOT, pathname))

    // Disallow path traversal — only serve files under the project root.
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain' })
            res.end(`Not found: ${pathname}`)
            return
        }
        const ext = path.extname(filePath)
        res.writeHead(200, {
            'content-type': MIME[ext] || 'application/octet-stream',
            'content-length': stat.size,
            // Disable caching so a tweaked `latest.json` is picked up immediately.
            'cache-control': 'no-store',
        })
        fs.createReadStream(filePath).pipe(res)
    })
})

server.listen(PORT, () => {
    console.log(`[serve-updates] Serving ${ROOT} at http://localhost:${PORT}`)
    console.log(`[serve-updates] Manifest URL: http://localhost:${PORT}/latest.json`)
    console.log('[serve-updates] Press Ctrl-C to stop.')
})
