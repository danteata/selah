/**
 * Word morph between two slides: the words they share travel from their place
 * on the old slide to their place on the new one, growing or shrinking to the
 * new size, while the rest of the old text fades out and the rest of the new
 * text fades in, both following the shared words. A chorus that comes round
 * again, or a verse that changes one line, rearranges instead of blinking.
 *
 * The algorithm is deckcraft's Morph (`crates/render/src/morph_text.rs`,
 * Copyright (c) 2026 ArtCraft Team and the DeckCraft contributors, MIT OR
 * Apache-2.0 — see THIRD_PARTY_NOTICES.md), moved from glyphs on a canvas to
 * word boxes in the DOM: tokens are runs of non-space characters, a new token
 * takes the first unused old token with the same text, and unmatched text rides
 * the average scale-and-shift `F(p) = s·p + c` that the pairs define.
 */

/** A measured word: its text and box, relative to the slide frame. */
export interface WordBox {
    key: string
    x: number
    y: number
    width: number
    height: number
    /** Computed font size in px, for the size ratio between slides. */
    fontSize: number
}

/** Scale and shift from the old text to the new: `F(p) = s·p + c`. */
export interface Affine {
    s: number
    cx: number
    cy: number
}

/**
 * Wrap each word of `html` in a plain inline `<span data-mw>`, so it can be
 * measured. Plain inline spans don't change layout, so text fitted around
 * them fits exactly as before. A word split across tags (`<b>Ho</b>ly`) gets a
 * span per piece; they're measured as separate tokens.
 */
export function wrapWords(html: string): string {
    if (typeof DOMParser === 'undefined' || !html) return html
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const texts: Text[] = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
    for (const node of texts) {
        const text = node.data
        const out = doc.createDocumentFragment()
        let last = 0
        for (const match of text.matchAll(/\S+/g)) {
            if (match.index > last) out.append(text.slice(last, match.index))
            const span = doc.createElement('span')
            span.setAttribute('data-mw', '')
            span.textContent = match[0]
            out.append(span)
            last = match.index + match[0].length
        }
        if (last < text.length) out.append(text.slice(last))
        node.replaceWith(out)
    }
    return doc.body.innerHTML
}

/** A word's matching key. With `normalize`, case and edge punctuation are ignored. */
export function tokenKey(text: string, normalize = false): string {
    if (!normalize) return text
    return text.toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
}

/**
 * For each new token, the index of the old token it pairs with, or null: the
 * first unused old token with the same key, in reading order, each used once.
 */
export function matchTokens(oldKeys: readonly string[], newKeys: readonly string[]): (number | null)[] {
    const used = new Array<boolean>(oldKeys.length).fill(false)
    return newKeys.map((key) => {
        const i = oldKeys.findIndex((k, idx) => !used[idx] && k === key)
        if (i < 0) return null
        used[i] = true
        return i
    })
}

/**
 * The average scale-and-shift taking the old text to the new, fitted to the
 * paired words' positions and size ratios. Null when nothing is shared.
 */
export function fitAffine(pairs: readonly { from: WordBox; to: WordBox }[]): Affine | null {
    if (pairs.length === 0) return null
    const ratio = (p: { from: WordBox; to: WordBox }) =>
        p.from.fontSize > 0 && p.to.fontSize > 0 ? p.to.fontSize / p.from.fontSize : 1
    const s = pairs.reduce((sum, p) => sum + ratio(p), 0) / pairs.length
    if (!Number.isFinite(s) || s <= 0) return null
    const cx = pairs.reduce((sum, p) => sum + (p.to.x - p.from.x * s), 0) / pairs.length
    const cy = pairs.reduce((sum, p) => sum + (p.to.y - p.from.y * s), 0) / pairs.length
    return { s, cx, cy }
}

export function smoothstep(t: number): number {
    const p = Math.min(1, Math.max(0, t))
    return p * p * (3 - 2 * p)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Where a clone drawn at its own box sits at progress `t`: offset, scale, opacity. */
export interface Placement {
    dx: number
    dy: number
    scale: number
    opacity: number
}

/** A shared word: drawn at its new box, starting from its old one. */
export function pairedAt(from: WordBox, to: WordBox, t: number): Placement {
    const start = to.fontSize > 0 && from.fontSize > 0 ? from.fontSize / to.fontSize : 1
    return {
        dx: lerp(from.x - to.x, 0, t),
        dy: lerp(from.y - to.y, 0, t),
        scale: lerp(start, 1, t),
        opacity: 1,
    }
}

/** An old word with no partner: fades out while riding `F` from its old place. */
export function leavingAt(box: WordBox, f: Affine | null, t: number): Placement {
    if (!f) return { dx: 0, dy: 0, scale: 1, opacity: 1 - t }
    return {
        dx: t * (box.x * (f.s - 1) + f.cx),
        dy: t * (box.y * (f.s - 1) + f.cy),
        scale: lerp(1, f.s, t),
        opacity: 1 - t,
    }
}

/** A new word with no partner: fades in, arriving along `F` at its new place. */
export function arrivingAt(box: WordBox, f: Affine | null, t: number): Placement {
    if (!f) return { dx: 0, dy: 0, scale: 1, opacity: t }
    // Starts at F⁻¹(q) = (q - c) / s, at 1/s of its size.
    const fromX = (box.x - f.cx) / f.s
    const fromY = (box.y - f.cy) / f.s
    return {
        dx: lerp(fromX - box.x, 0, t),
        dy: lerp(fromY - box.y, 0, t),
        scale: lerp(1 / f.s, 1, t),
        opacity: t,
    }
}
