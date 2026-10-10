/**
 * Golden-image comparison, run on the Node side of Vitest's browser mode.
 *
 * A test renders in real Chromium, hands the PNG over as a data URL, and this
 * compares it with the committed golden next to the test file
 * (`__goldens__/<name>.png`). Modelled on filmcraft's golden tests (MIT OR
 * Apache-2.0, ArtCraft Team and the FilmCraft contributors): two tolerance
 * tiers, a bless switch to re-record, and actual/expected/diff PNGs written
 * on failure so a reviewer can see what changed.
 *
 *   SELAH_BLESS=1 bun run test:golden   re-record every golden the run touches
 *
 * Bless only inside the Playwright container CI uses (docs/TESTING.md): text
 * rasterises slightly differently from one machine's fonts and GPU to the next.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { BrowserCommand } from 'vitest/node'

/**
 * - `exact`: not one pixel may differ. For pure functions of a seed and a
 *   time, like the motion backgrounds.
 * - `render`: up to 0.1% of pixels may differ, for anything with text, where
 *   anti-aliasing shifts a little between Chromium releases.
 */
export type GoldenTolerance = 'exact' | 'render'

export interface GoldenResult {
    pass: boolean
    message: string
}

const MAX_DIFF_FRACTION: Record<GoldenTolerance, number> = { exact: 0, render: 0.001 }

/** pixelmatch's per-pixel colour threshold (0..1, perceptual). Exact means
 *  exact: at 0.1 a shifted gradient stop went unnoticed. */
const PIXEL_THRESHOLD: Record<GoldenTolerance, number> = { exact: 0, render: 0.1 }

/** Goldens are committed, so a runaway one (a full-HD screenshot) is refused. */
const MAX_GOLDEN_BYTES = 200 * 1024

const RESULTS_DIR = resolve('test-results/golden')

function decode(dataUrl: string): Buffer {
    const comma = dataUrl.indexOf(',')
    return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, 'base64')
}

export const compareGolden: BrowserCommand<[name: string, png: string, tolerance: GoldenTolerance]> = (
    ctx,
    name,
    png,
    tolerance,
): GoldenResult => {
    if (!ctx.testPath) return { pass: false, message: 'compareGolden needs a test file' }
    const goldenPath = join(dirname(ctx.testPath), '__goldens__', `${name}.png`)
    const actualBytes = decode(png)

    if (process.env.SELAH_BLESS === '1') {
        if (actualBytes.length > MAX_GOLDEN_BYTES) {
            return {
                pass: false,
                message: `${name}.png is ${Math.round(actualBytes.length / 1024)} KB, over the ` +
                    `${MAX_GOLDEN_BYTES / 1024} KB limit for committed goldens; render it smaller`,
            }
        }
        mkdirSync(dirname(goldenPath), { recursive: true })
        writeFileSync(goldenPath, actualBytes)
        return { pass: true, message: `blessed ${name}` }
    }

    if (!existsSync(goldenPath)) {
        return {
            pass: false,
            message: `no golden for "${name}" (${goldenPath}). Record it with SELAH_BLESS=1 bun run test:golden`,
        }
    }

    const actual = PNG.sync.read(actualBytes)
    const expected = PNG.sync.read(readFileSync(goldenPath))
    if (actual.width !== expected.width || actual.height !== expected.height) {
        writeResults(name, actualBytes, readFileSync(goldenPath), null)
        return {
            pass: false,
            message: `"${name}" is ${actual.width}×${actual.height}, the golden is ${expected.width}×${expected.height}`,
        }
    }

    const diff = new PNG({ width: actual.width, height: actual.height })
    const differing = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
        threshold: PIXEL_THRESHOLD[tolerance],
        includeAA: false,
    })
    const allowed = Math.floor(actual.width * actual.height * MAX_DIFF_FRACTION[tolerance])
    if (differing <= allowed) return { pass: true, message: `${differing} pixels differ` }

    const written = writeResults(name, actualBytes, readFileSync(goldenPath), PNG.sync.write(diff))
    return {
        pass: false,
        message: `"${name}": ${differing} pixels differ (${tolerance} allows ${allowed}). ` +
            `See ${written}. If the change is intended, re-record with SELAH_BLESS=1 bun run test:golden`,
    }
}

function writeResults(name: string, actual: Buffer, expected: Buffer, diff: Buffer | null): string {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const base = join(RESULTS_DIR, basename(name))
    writeFileSync(`${base}.actual.png`, actual)
    writeFileSync(`${base}.expected.png`, expected)
    if (diff) writeFileSync(`${base}.diff.png`, diff)
    return `${base}.{actual,expected${diff ? ',diff' : ''}}.png`
}
