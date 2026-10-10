#!/usr/bin/env node
// Generates src/styles/slide-fonts.css: self-hosted @font-face rules for every
// font a slide can use, plus the app's own UI fonts.
//
// Why generated rather than importing each @fontsource package's CSS:
//   - woff2 only. Fontsource's CSS also lists a .woff fallback for every face,
//     which Vite then emits too, doubling what ships in the desktop bundle for
//     browsers that all read woff2.
//   - latin + latin-ext only. latin-ext carries Twi/Ga/Ewe's Ɛ and Ɔ; the other
//     subsets (Cyrillic, Greek, Vietnamese) can be added here when needed.
//   - Aliases. Slides store the family name as a plain string, and TipTap writes
//     it unquoted into saved slide HTML. "Source Sans Pro" was renamed upstream to
//     "Source Sans 3", which is not even valid unquoted CSS, so the new files are
//     served under the old name instead of migrating stored slides. "Georgia"
//     is a Microsoft font we can't ship; its rule prefers the installed one and
//     falls back to Gelasio, its metric-compatible OFL substitute.
//
// The family list must match SLIDE_FONTS in src/lib/fonts.ts; a test checks it.
//
// Usage: node scripts/build-slide-fonts-css.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fontsourceDir = join(root, 'node_modules', '@fontsource')
const outFile = join(root, 'src', 'styles', 'slide-fonts.css')

const SUBSETS = ['latin-ext', 'latin']

// Slide body text renders at 600, bold runs at 700, captions and lower-third
// subtitles at 400 (src/lib/graphics/renderSlide.ts), each possibly italic.
const SLIDE_FACES = [400, 600, 700].flatMap((weight) => [
    { weight, style: 'normal' },
    { weight, style: 'italic' },
])

const UI_FACES = [400, 500, 600, 700].map((weight) => ({ weight, style: 'normal' }))

/** family: the CSS name slides store. pkg: the @fontsource package. local: installed names tried first. */
const FAMILIES = [
    { family: 'Inter', pkg: 'inter', faces: SLIDE_FACES },
    { family: 'Roboto', pkg: 'roboto', faces: SLIDE_FACES },
    { family: 'Open Sans', pkg: 'open-sans', faces: SLIDE_FACES },
    { family: 'Lato', pkg: 'lato', faces: SLIDE_FACES },
    { family: 'Montserrat', pkg: 'montserrat', faces: SLIDE_FACES },
    { family: 'Source Sans Pro', pkg: 'source-sans-3', faces: SLIDE_FACES },
    { family: 'Poppins', pkg: 'poppins', faces: SLIDE_FACES },
    { family: 'Nunito', pkg: 'nunito', faces: SLIDE_FACES },
    { family: 'Raleway', pkg: 'raleway', faces: SLIDE_FACES },
    { family: 'Ubuntu', pkg: 'ubuntu', faces: SLIDE_FACES },
    { family: 'Playfair Display', pkg: 'playfair-display', faces: SLIDE_FACES },
    { family: 'Georgia', pkg: 'gelasio', faces: SLIDE_FACES, local: ['Georgia'] },
    { family: 'Crimson Pro', pkg: 'crimson-pro', faces: UI_FACES },
    { family: 'DM Sans', pkg: 'dm-sans', faces: UI_FACES },
]

/** The unicode-range fontsource declares for one subset of one face. */
function unicodeRange(pkg, subset, weight, style) {
    const cssFile = join(fontsourceDir, pkg, style === 'italic' ? `${weight}-italic.css` : `${weight}.css`)
    const css = readFileSync(cssFile, 'utf8')
    const marker = `/* ${pkg}-${subset}-${weight}-${style} */`
    const start = css.indexOf(marker)
    if (start < 0) throw new Error(`${cssFile} has no block for ${subset}`)
    const block = css.slice(start, css.indexOf('}', start))
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]
    if (!range) throw new Error(`${cssFile} declares no unicode-range for ${subset}`)
    return range.trim()
}

const rules = []
const skipped = []
for (const { family, pkg, faces, local = [] } of FAMILIES) {
    if (!existsSync(join(fontsourceDir, pkg))) {
        throw new Error(`@fontsource/${pkg} is not installed`)
    }
    for (const { weight, style } of faces) {
        for (const subset of SUBSETS) {
            const file = join(fontsourceDir, pkg, 'files', `${pkg}-${subset}-${weight}-${style}.woff2`)
            if (!existsSync(file)) {
                // Lato and Ubuntu ship no 600; the browser picks the nearest
                // weight the family has, as it would for any missing face.
                skipped.push(`${family} ${weight} ${style} ${subset}`)
                continue
            }
            const url = relative(dirname(outFile), file).split('\\').join('/')
            const sources = [...local.map((name) => `local('${name}')`), `url('${url}') format('woff2')`]
            rules.push(
                [
                    '@font-face {',
                    `  font-family: '${family}';`,
                    `  font-style: ${style};`,
                    `  font-weight: ${weight};`,
                    '  font-display: swap;',
                    `  src: ${sources.join(', ')};`,
                    `  unicode-range: ${unicodeRange(pkg, subset, weight, style)};`,
                    '}',
                ].join('\n'),
            )
        }
    }
}

const header = `/*
 * GENERATED by scripts/build-slide-fonts-css.mjs — do not edit by hand.
 *
 * Self-hosted fonts from the @fontsource packages, so slides render in the font
 * the operator picked on every machine (projector, NDI box, offline) instead of
 * whatever happens to be installed. Licences: THIRD_PARTY_FONTS.md.
 */
`

writeFileSync(outFile, `${header}\n${rules.join('\n\n')}\n`)
console.log(`Wrote ${rules.length} @font-face rules to ${relative(root, outFile)}`)
if (skipped.length) console.log(`No file for (nearest weight will be used): ${skipped.length} faces`)
