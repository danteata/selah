/**
 * PowerPoint import: the Rust reader's neutral description of a deck
 * (`src-tauri/src/pptx_import.rs`) → Selah slides.
 *
 * A Selah slide has no positioned text boxes. Its text is one HTML block,
 * auto-fitted inside the slide's window padding, so a PowerPoint slide maps
 * onto it like this:
 *
 * - every text box's paragraphs, in reading order, become that one block;
 * - the union of the boxes becomes `slideStyle.windowPadding`;
 * - the most common alignment and font become the slide's, and only runs that
 *   differ carry their own;
 * - point sizes are dropped, since AutoFit sizes the text.
 *
 * The HTML ends up in `innerHTML` (SlideView, the editor), and everything in
 * it came out of a file someone sent us, so it is built here from parts only:
 * text is escaped, the tags are p/br/strong/em/u/span/ul/ol/li, and the only
 * styles are a text-align from a fixed list, a `#rrggbb` colour and a font
 * from `SLIDE_FONTS`. Anything else in the input is dropped, not passed on.
 */

import { SLIDE_FONTS, cssFontStack } from '../fonts'
import {
    backgroundFillTypes,
    backgroundTypes,
    slideLayoutTypes,
    slideTypes,
    type PptxSlideData,
    type Slide,
    type SlideStyle,
} from '../../types'

// ==================== Wire types (mirror pptx_import.rs) ====================

export type PptxImportMode = 'editable' | 'images'
export type PptxAlign = 'left' | 'center' | 'right' | 'justify'
export type PptxBullet = 'none' | 'bullet' | 'number'

export interface PptxRun {
    /** `\n` is a line break inside the paragraph. */
    text: string
    b: boolean
    i: boolean
    u: boolean
    color?: string
    font?: string
}

export interface PptxParagraph {
    align: PptxAlign
    level: number
    bullet: PptxBullet
    runs: PptxRun[]
}

/** Fractions of the slide. */
export interface PptxBox {
    x: number
    y: number
    w: number
    h: number
}

export type PptxBackground =
    | { kind: 'none' }
    | { kind: 'color'; color: string }
    | { kind: 'gradient'; angle: number; radial: boolean; stops: Array<{ pos: number; color: string }> }
    | { kind: 'image'; path: string }

export interface PptxSlide {
    index: number
    hidden: boolean
    title?: string
    paragraphs: PptxParagraph[]
    box?: PptxBox
    background: PptxBackground
    notes?: string
    imagePath?: string
    warnings: string[]
}

export interface PptxImportResult {
    deckName: string
    aspect: number
    warnings: string[]
    slides: PptxSlide[]
}

export type PptxImportErrorKind =
    | 'notSupported'
    | 'tooLarge'
    | 'tooManyEntries'
    | 'zipBomb'
    | 'encrypted'
    | 'legacyPpt'
    | 'notPptx'
    | 'cancelled'
    | 'io'

export interface PptxImportError {
    kind: PptxImportErrorKind
    message: string
}

export interface PptxImportProgress {
    importId: string
    stage: 'checking' | 'reading' | 'converting' | 'rendering'
    done: number
    total: number
}

export const PPTX_EXTENSIONS = ['pptx', 'ppsx', 'potx']
export const PPTX_PROGRESS_EVENT = 'pptx-import://progress'

// ==================== Escaping and the allowlist ====================

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A `#rrggbb` colour, lowercased, or null for anything else. */
export function safeColor(color: string | undefined | null): string | null {
    return color && HEX_COLOR.test(color) ? color.toLowerCase() : null
}

const ALIGNMENTS: readonly PptxAlign[] = ['left', 'center', 'right', 'justify']

function safeAlign(align: unknown): PptxAlign {
    return ALIGNMENTS.includes(align as PptxAlign) ? (align as PptxAlign) : 'left'
}

/** Selah's text is white unless styled, so a white run needs no colour of its own. */
const DEFAULT_TEXT_COLOR = '#ffffff'

// ==================== Fonts ====================

const SLIDE_FAMILY = new Map(SLIDE_FONTS.map((f) => [f.family.toLowerCase(), f.family]))

/**
 * Families decks ask for but Selah doesn't ship, onto the closest one it does.
 * Modelled on deckcraft's `substitutes()` (crates/fonts/src/fontdb.rs), cut
 * down to `SLIDE_FONTS`. Calibri goes to Lato: Carlito, the metric-compatible
 * Calibri substitute, is itself derived from Lato. Monospace families have no
 * counterpart and stay unset.
 */
const FONT_SUBSTITUTES: Record<string, string> = {
    calibri: 'Lato',
    'calibri light': 'Lato',
    carlito: 'Lato',
    arial: 'Inter',
    'arial nova': 'Inter',
    helvetica: 'Inter',
    'helvetica neue': 'Inter',
    'liberation sans': 'Inter',
    aptos: 'Inter',
    'aptos display': 'Inter',
    'aptos narrow': 'Inter',
    'segoe ui': 'Inter',
    'segoe ui light': 'Inter',
    'segoe ui semibold': 'Inter',
    tahoma: 'Inter',
    verdana: 'Inter',
    'nunito sans': 'Nunito',
    'source sans 3': 'Source Sans Pro',
    'franklin gothic': 'Open Sans',
    'franklin gothic book': 'Open Sans',
    'franklin gothic medium': 'Open Sans',
    univers: 'Open Sans',
    'century gothic': 'Montserrat',
    avenir: 'Montserrat',
    'avenir next': 'Montserrat',
    futura: 'Montserrat',
    'gill sans': 'Montserrat',
    'gill sans mt': 'Montserrat',
    'trebuchet ms': 'Montserrat',
    corbel: 'Montserrat',
    candara: 'Montserrat',
    impact: 'Montserrat',
    'arial black': 'Montserrat',
    cambria: 'Georgia',
    'times new roman': 'Georgia',
    times: 'Georgia',
    'liberation serif': 'Georgia',
    garamond: 'Georgia',
    'book antiqua': 'Georgia',
    palatino: 'Georgia',
    'palatino linotype': 'Georgia',
    constantia: 'Georgia',
    merriweather: 'Georgia',
    gelasio: 'Georgia',
    'source serif 4': 'Georgia',
    'source serif pro': 'Georgia',
}

/** The `SLIDE_FONTS` family for a deck's font, or undefined to inherit. */
export function mapPptxFont(name: string | undefined | null): string | undefined {
    const key = (name ?? '').trim().toLowerCase()
    if (!key) return undefined
    return SLIDE_FAMILY.get(key) ?? FONT_SUBSTITUTES[key]
}

// ==================== Text → HTML ====================

function runChars(p: PptxParagraph): number {
    return p.runs.reduce((n, r) => n + r.text.trim().length, 0)
}

function isEmpty(p: PptxParagraph): boolean {
    return p.runs.every((r) => r.text.trim() === '')
}

/** The alignment most of the text has, by characters. Justify reads as left. */
export function dominantAlignment(paragraphs: PptxParagraph[]): 'left' | 'center' | 'right' {
    const weight = { left: 0, center: 0, right: 0 }
    for (const p of paragraphs) {
        const align = safeAlign(p.align)
        weight[align === 'justify' ? 'left' : align] += runChars(p)
    }
    const best = (Object.keys(weight) as Array<keyof typeof weight>).reduce((a, b) => (weight[b] > weight[a] ? b : a))
    return weight[best] > 0 ? best : 'center'
}

/** The `SLIDE_FONTS` family most of the text maps to, by characters. */
export function dominantFont(paragraphs: PptxParagraph[]): string | undefined {
    const weight = new Map<string, number>()
    for (const p of paragraphs) {
        for (const r of p.runs) {
            const family = mapPptxFont(r.font)
            if (family) weight.set(family, (weight.get(family) ?? 0) + r.text.trim().length)
        }
    }
    let best: string | undefined
    let bestWeight = 0
    for (const [family, w] of weight) {
        if (w > bestWeight) {
            best = family
            bestWeight = w
        }
    }
    return best
}

interface HtmlOptions {
    /** The slide's alignment; paragraphs that match it carry none. */
    baseAlign: string
    /** The slide's font; runs in it carry none. */
    baseFont?: string
}

function runHtml(run: PptxRun, opts: HtmlOptions): string {
    let html = escapeHtml(run.text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')).replace(/\n/g, '<br>')
    if (!html) return ''
    if (run.u) html = `<u>${html}</u>`
    if (run.i) html = `<em>${html}</em>`
    if (run.b) html = `<strong>${html}</strong>`
    const styles: string[] = []
    const color = safeColor(run.color)
    if (color && color !== DEFAULT_TEXT_COLOR) styles.push(`color: ${color}`)
    const family = mapPptxFont(run.font)
    // cssFontStack quotes a SLIDE_FONTS name, so this can't break out of the
    // attribute; escapeHtml covers the quotes anyway.
    if (family && family !== opts.baseFont) styles.push(`font-family: ${cssFontStack(family)}`)
    return styles.length ? `<span style="${escapeHtml(styles.join('; '))}">${html}</span>` : html
}

function paragraphBody(p: PptxParagraph, opts: HtmlOptions): string {
    const align = safeAlign(p.align)
    const style = align !== opts.baseAlign ? ` style="text-align: ${align}"` : ''
    return `<p${style}>${p.runs.map((r) => runHtml(r, opts)).join('')}</p>`
}

/**
 * Paragraphs → slide HTML. Bulleted and numbered paragraphs become nested
 * `<ul>`/`<ol>` by level, in the `<li><p>` shape TipTap writes, so the slide
 * stays editable. Empty paragraphs at either end are dropped; inside, they
 * keep the deck's spacing.
 */
export function paragraphsToHtml(paragraphs: PptxParagraph[], opts: HtmlOptions): string {
    let start = 0
    let end = paragraphs.length
    while (start < end && isEmpty(paragraphs[start])) start++
    while (end > start && isEmpty(paragraphs[end - 1])) end--

    const out: string[] = []
    // Open lists, outermost first.
    const stack: Array<{ tag: 'ul' | 'ol'; level: number }> = []
    const closeTo = (depth: number) => {
        while (stack.length > depth) out.push(`</li></${stack.pop()!.tag}>`)
    }

    for (const p of paragraphs.slice(start, end)) {
        if (p.bullet !== 'bullet' && p.bullet !== 'number') {
            closeTo(0)
            out.push(paragraphBody(p, opts))
            continue
        }
        const tag = p.bullet === 'number' ? 'ol' : 'ul'
        const level = Math.max(0, Math.min(8, Math.floor(Number(p.level) || 0)))
        // Leave lists deeper than this paragraph.
        while (stack.length && stack[stack.length - 1].level > level) closeTo(stack.length - 1)
        const top = stack[stack.length - 1]
        if (top && top.level === level && top.tag === tag) {
            out.push('</li><li>')
        } else if (top && top.level === level) {
            // Same level, other kind of list: a new list beside it.
            closeTo(stack.length - 1)
            out.push(`<${tag}><li>`)
            stack.push({ tag, level })
        } else {
            // Deeper (or the first): open a list inside the current item.
            out.push(`<${tag}><li>`)
            stack.push({ tag, level })
        }
        out.push(paragraphBody(p, opts))
    }
    closeTo(0)
    return out.join('')
}

// ==================== Layout and background ====================

/** SlideView's frame, in the units `windowPadding` is measured in. */
const FRAME_WIDTH = 1920
const FRAME_HEIGHT = 1080
/** Keep at least this share of the frame for text, whatever the deck says. */
const MIN_TEXT_SHARE = 0.25

/**
 * The text's box → `windowPadding`. Padding is in SlideView frame pixels
 * (1920 wide, both axes), so the fractions scale onto a 1920×1080 frame.
 */
export function pptxBoxToPadding(box: PptxBox | undefined): SlideStyle['windowPadding'] | undefined {
    if (!box) return undefined
    const vals = [box.x, box.y, box.w, box.h]
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    let x0 = clamp(box.x)
    let x1 = clamp(box.x + box.w)
    let y0 = clamp(box.y)
    let y1 = clamp(box.y + box.h)
    // A sliver of a box would squeeze the text to nothing: widen it about its centre.
    const widen = (a: number, b: number): [number, number] => {
        if (b - a >= MIN_TEXT_SHARE) return [a, b]
        const mid = Math.min(1 - MIN_TEXT_SHARE / 2, Math.max(MIN_TEXT_SHARE / 2, (a + b) / 2))
        return [mid - MIN_TEXT_SHARE / 2, mid + MIN_TEXT_SHARE / 2]
    }
    ;[x0, x1] = widen(x0, x1)
    ;[y0, y1] = widen(y0, y1)
    return {
        left: Math.round(x0 * FRAME_WIDTH),
        right: Math.round((1 - x1) * FRAME_WIDTH),
        top: Math.round(y0 * FRAME_HEIGHT),
        bottom: Math.round((1 - y1) * FRAME_HEIGHT),
    }
}

export interface MappedBackground {
    backgroundType: string
    background: string
    localFilePath?: string
}

/** The deck's background, or null to keep Selah's default for the slide. */
export function pptxBackground(bg: PptxBackground | undefined): MappedBackground | null {
    if (!bg) return null
    switch (bg.kind) {
        case 'color': {
            const color = safeColor(bg.color)
            return color ? { backgroundType: backgroundTypes.color, background: color } : null
        }
        case 'gradient': {
            const stops = (bg.stops ?? [])
                .map((s) => ({ color: safeColor(s.color), pos: Math.round(Math.min(1, Math.max(0, Number(s.pos) || 0)) * 100) }))
                .filter((s): s is { color: string; pos: number } => s.color !== null)
            if (stops.length === 0) return null
            if (stops.length === 1) return { backgroundType: backgroundTypes.color, background: stops[0].color }
            const list = stops.map((s) => `${s.color} ${s.pos}%`).join(', ')
            // DrawingML measures clockwise from left→right; CSS from bottom→top.
            const angle = (((Number(bg.angle) || 0) + 90) % 360 + 360) % 360
            const css = bg.radial ? `radial-gradient(circle, ${list})` : `linear-gradient(${Math.round(angle)}deg, ${list})`
            return { backgroundType: backgroundTypes.gradient, background: css }
        }
        case 'image':
            return bg.path ? { backgroundType: backgroundTypes.image, background: bg.path, localFilePath: bg.path } : null
        default:
            return null
    }
}

// ==================== Slides ====================

function plainText(p: PptxParagraph): string {
    return p.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim()
}

/** A name for the slide list: its title, else its first line, else its number. */
function slideName(slide: PptxSlide): string {
    const title = slide.title?.replace(/\s+/g, ' ').trim()
    if (title) return title.slice(0, 80)
    const first = slide.paragraphs.map(plainText).find(Boolean)
    return first ? first.slice(0, 80) : `Slide ${slide.index + 1}`
}

export interface BuildOptions {
    mode: PptxImportMode
    includeHidden: boolean
    /** A fresh slide with Selah's defaults (id, schedule, style) to fill in. */
    makeBase: () => Slide
}

/** The slides an import will add, in deck order. */
export function selectedPptxSlides(result: PptxImportResult, includeHidden: boolean): PptxSlide[] {
    return result.slides.filter((s) => includeHidden || !s.hidden)
}

export function pptxSlideToSlide(slide: PptxSlide, deck: PptxImportResult, mode: PptxImportMode, base: Slide): Slide {
    const data: PptxSlideData = {
        source: 'pptx',
        deckName: deck.deckName,
        slideNumber: slide.index + 1,
        ...(slide.notes ? { notes: slide.notes } : {}),
    }
    const name = slideName(slide)

    if (mode === 'images' && slide.imagePath) {
        return {
            ...base,
            name,
            type: slideTypes.media,
            layout: slideLayoutTypes.empty,
            contents: [],
            backgroundType: backgroundTypes.image,
            background: slide.imagePath,
            backgroundVideoKey: null,
            localFilePath: slide.imagePath,
            data,
            slideStyle: { ...base.slideStyle, backgroundFillType: backgroundFillTypes.fit },
        }
    }

    const alignment = dominantAlignment(slide.paragraphs)
    const font = dominantFont(slide.paragraphs)
    const padding = pptxBoxToPadding(slide.box)
    const background = pptxBackground(slide.background)
    const html = paragraphsToHtml(slide.paragraphs, { baseAlign: alignment, baseFont: font })

    const out: Slide = {
        ...base,
        name,
        type: slideTypes.text,
        layout: slideLayoutTypes.full_text,
        // One block: SlideView shows contents[1..] as captions.
        contents: [html],
        data,
        slideStyle: {
            ...base.slideStyle,
            alignment,
            ...(font ? { font } : {}),
            ...(padding ? { windowPadding: padding } : {}),
        },
    }
    if (background) {
        out.backgroundType = background.backgroundType
        out.background = background.background
        out.backgroundVideoKey = null
        out.localFilePath = background.localFilePath
        out.backgroundStorageId = null
    }
    return out
}

export function buildPptxSlides(result: PptxImportResult, opts: BuildOptions): Slide[] {
    return selectedPptxSlides(result, opts.includeHidden).map((s) => pptxSlideToSlide(s, result, opts.mode, opts.makeBase()))
}

/** "3 slides left out pictures or charts" style summary of per-slide warnings. */
export function warningCount(result: PptxImportResult): number {
    return result.slides.reduce((n, s) => n + (s.warnings.length > 0 ? 1 : 0), 0)
}
