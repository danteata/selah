/**
 * Fill the screen with a song's lines without stranding a word.
 *
 * Sung lines are kept whole on the projector (SlideView's `keepLines`): wrapped
 * wherever the width ran out, a line left a word on a line of its own ("me").
 * But kept whole, the longest line sets the size, and a verse of four long
 * lines filled the width and a third of the height, where scripture, wrapping
 * freely, filled the screen.
 *
 * So when the frame has room, a long line is split, by us and not the browser:
 * into two (or three) parts as even as the words allow, never fewer than two
 * words in a part, and only when that makes the text markedly bigger. The
 * verse's own line breaks always stay.
 */

/** Width of `text` at a font size of 1 (any unit, as long as it's consistent). */
export type MeasureText = (text: string) => number

/** Line height the slide body is set at (SlideView's AutoFitText). */
const LINE_HEIGHT = 1.0
/** Split only for text at least this much bigger: kept whole, a sung line is
 *  easier to sing from, so a split has to earn its place. */
const MIN_GAIN = 1.15
/** Most parts a sung line is split into. */
const MAX_PARTS = 3
/** Fewest words in any part, so no word is left on its own. */
const MIN_WORDS = 2

interface Split {
    /** Word index each part after the first starts at. */
    breaks: number[]
    /** Widest part. */
    width: number
}

/**
 * How a break after `word` reads, as a factor on the split's width: a break
 * at a comma or full stop follows the phrase, and one after a little word
 * ("trust the / sweetest frame") leaves it hanging. Only a nudge between
 * splits about as even as each other.
 */
function breakCost(word: string): number {
    if (/[,;:.!?)\u2014\u2013-]$/.test(word)) return 0.94
    const letters = word.replace(/[^\p{L}]/gu, '').length
    if (letters <= 2) return 1.4
    if (letters <= 3) return 1.15
    return 1
}

/** The split of `words` into `parts` whose widest part is narrowest. */
function evenSplit(words: string[], parts: number, measure: MeasureText): Split | null {
    const n = words.length
    if (parts === 1) return { breaks: [], width: measure(words.join(' ')) }
    if (n < parts * MIN_WORDS) return null
    const width = (from: number, to: number) => measure(words.slice(from, to).join(' '))
    let best: (Split & { score: number }) | null = null
    if (parts === 2) {
        for (let a = MIN_WORDS; a <= n - MIN_WORDS; a++) {
            const w = Math.max(width(0, a), width(a, n))
            const score = w * breakCost(words[a - 1])
            if (!best || score < best.score) best = { breaks: [a], width: w, score }
        }
    } else {
        for (let a = MIN_WORDS; a <= n - 2 * MIN_WORDS; a++) {
            for (let b = a + MIN_WORDS; b <= n - MIN_WORDS; b++) {
                const w = Math.max(width(0, a), width(a, b), width(b, n))
                const score = w * breakCost(words[a - 1]) * breakCost(words[b - 1])
                if (!best || score < best.score) best = { breaks: [a, b], width: w, score }
            }
        }
    }
    return best && { breaks: best.breaks, width: best.width }
}

/** Biggest font (relative) a block of `rows` lines, `width` wide, takes in the frame. */
function fontFor(width: number, rows: number, aspect: number): number {
    // Frame height 1, width `aspect`.
    return Math.min(aspect / width, 1 / (rows * LINE_HEIGHT))
}

/**
 * Where to break each line, or null to keep every line whole.
 *
 * `lines` are the verse's own lines; null marks one that can't be split (it
 * carries markup). `aspect` is the text area's width over its height.
 */
export function planLyricBreaks(
    lines: Array<string | null>,
    measure: MeasureText,
    aspect: number,
    unsplittable: number[] = [],
): number[][] | null {
    const words = lines.map((line) => (line === null ? null : line.trim().split(/\s+/).filter(Boolean)))
    // Every way each line can be split, from whole to MAX_PARTS.
    const options = words.map((w, i) => {
        if (w === null || w.length === 0) return [{ breaks: [], width: unsplittable[i] ?? 0 }]
        const found: Split[] = []
        for (let parts = 1; parts <= MAX_PARTS; parts++) {
            const split = evenSplit(w, parts, measure)
            if (split) found.push(split)
        }
        return found
    })

    const whole = options.map((o) => o[0])
    const wholeFont = fontFor(Math.max(...whole.map((s) => s.width)), lines.length, aspect)

    // Try each line width as the cap the block is set to: every line takes the
    // fewest parts that fit under it.
    const caps = [...new Set(options.flat().map((s) => s.width))].sort((a, b) => a - b)
    let best: { font: number; plan: Split[] } | null = null
    for (const cap of caps) {
        const plan: Split[] = []
        for (const o of options) {
            const fit = o.find((s) => s.width <= cap)
            if (!fit) break
            plan.push(fit)
        }
        if (plan.length < options.length) continue
        const rows = plan.reduce((n, s) => n + s.breaks.length + 1, 0)
        const font = fontFor(Math.max(...plan.map((s) => s.width)), rows, aspect)
        if (!best || font > best.font) best = { font, plan }
    }

    if (!best || best.font < wholeFont * MIN_GAIN) return null
    if (best.plan.every((s) => s.breaks.length === 0)) return null
    return best.plan.map((s) => s.breaks)
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'])

interface Line {
    nodes: Node[]
    text: string
}

/** A body's lines: runs of inline content between <br>s and block edges. */
function linesOf(root: Node): Line[] {
    const lines: Line[] = []
    let current: Node[] = []
    const flush = () => {
        const text = current.map((n) => n.textContent ?? '').join('')
        if (text.trim()) lines.push({ nodes: current, text })
        current = []
    }
    const walk = (parent: Node) => {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeName === 'BR') flush()
            else if (BLOCK.has(node.nodeName)) {
                flush()
                walk(node)
                flush()
            } else current.push(node)
        }
    }
    walk(root)
    flush()
    return lines
}

const cache = new Map<string, string>()

/**
 * The body HTML with long sung lines broken (as <br>) where `planLyricBreaks`
 * says. Lines carrying markup are kept whole. Unchanged when nothing gains.
 */
export function balanceLyricHtml(
    html: string,
    opts: { font: string; aspect: number; uppercase?: boolean; measure?: MeasureText },
): string {
    if (typeof document === 'undefined' || !html) return html
    const aspect = Math.round(opts.aspect * 20) / 20
    const key = `${opts.font}|${aspect}|${opts.uppercase ? 1 : 0}|${html}`
    const hit = opts.measure ? undefined : cache.get(key)
    if (hit !== undefined) return hit

    const measure = opts.measure ?? canvasMeasure(opts.font, opts.uppercase)
    let out = html
    if (measure) {

        const root = document.createElement('div')
        root.innerHTML = html
        const lines = linesOf(root)
        // Only a line that's a single run of text can be split safely.
        const plain = lines.map((l) => (l.nodes.length === 1 && l.nodes[0].nodeType === Node.TEXT_NODE ? l.text : null))
        const plan = planLyricBreaks(plain, measure, aspect, lines.map((l) => measure(l.text)))
        if (plan) {
            plan.forEach((breaks, i) => {
                if (breaks.length === 0) return
                const node = lines[i].nodes[0] as Text
                const words = lines[i].text.trim().split(/\s+/)
                const bounds = [0, ...breaks, words.length]
                const parts = bounds.slice(0, -1).map((start, j) => words.slice(start, bounds[j + 1]).join(' '))
                const frag = document.createDocumentFragment()
                parts.forEach((part, j) => {
                    if (j > 0) frag.appendChild(document.createElement('br'))
                    frag.appendChild(document.createTextNode(part))
                })
                node.replaceWith(frag)
            })
            out = root.innerHTML
        }
    }
    // Kept only once the font is in: measured in a fallback, the split would
    // stand after the real face arrived.
    if (!opts.measure && fontLoaded(opts.font)) {
        if (cache.size > 500) cache.clear()
        cache.set(key, out)
    }
    return out
}

let canvas: HTMLCanvasElement | null = null

function fontLoaded(font: string): boolean {
    try {
        return document.fonts?.check(`500 100px ${font}`) ?? true
    } catch {
        return true
    }
}

/** Widths in the slide's font, from a canvas; null where there's no canvas. */
function canvasMeasure(font: string, uppercase?: boolean): MeasureText | null {
    let ctx: CanvasRenderingContext2D | null = null
    try {
        canvas ??= document.createElement('canvas')
        ctx = canvas.getContext('2d')
    } catch {
        return null
    }
    if (!ctx) return null
    const c = ctx
    c.font = `500 100px ${font}`
    return (text) => c.measureText(uppercase ? text.toUpperCase() : text).width / 100
}
