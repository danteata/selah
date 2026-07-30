/**
 * TipTap HTML → styled runs that canvas can draw.
 *
 * The graphics channel renders to a canvas so its frames can carry alpha, which
 * means no CSS engine lays the text out for us. The alternative approaches both
 * had a disqualifying catch: an SVG `foreignObject` drawn through an `<img>`
 * risks tainting the canvas — and `getImageData` is exactly how these pixels
 * reach NDI, so tainting kills the feed rather than degrading it — while
 * html2canvas is a dependency reimplementing CSS to screenshot a hidden DOM node.
 *
 * A lower third is a name and a role, so the formatting that actually matters is
 * bold, italic and colour. Those map straight onto `ctx.font` and
 * `ctx.fillStyle`, need no fonts embedded (canvas uses the document's own), and
 * behave identically on WebKit and Chromium.
 *
 * The editor's marks are Bold, Italic, TextStyle + Color and Highlight
 * (`TipTapEditor.tsx`), so those are what this understands.
 */

export interface TextRun {
    text: string
    bold: boolean
    italic: boolean
    /** CSS colour from a Color mark, or null to use the layout's default. */
    color: string | null
}

interface RunStyle {
    bold: boolean
    italic: boolean
    color: string | null
}

const BASE_STYLE: RunStyle = { bold: false, italic: false, color: null }

/** Collapse whitespace the way HTML rendering does. */
function normalizeSpace(text: string): string {
    return text.replace(/\s+/g, ' ')
}

function styleFromElement(element: Element, inherited: RunStyle): RunStyle {
    const tag = element.tagName.toLowerCase()
    const style = element.getAttribute('style') ?? ''

    const weight = /font-weight\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
    const bold =
        inherited.bold ||
        tag === 'b' ||
        tag === 'strong' ||
        weight === 'bold' ||
        weight === 'bolder' ||
        (!!weight && Number(weight) >= 600)

    const fontStyle = /font-style\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
    const italic = inherited.italic || tag === 'i' || tag === 'em' || fontStyle === 'italic'

    // `color:` set by the Color mark. Highlight renders as <mark>; on a keyed
    // graphic a background highlight would be a filled box behind the words,
    // which the bar already provides — so only the text colour is carried.
    const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
    const color = colorMatch || inherited.color

    return { bold, italic, color }
}

/**
 * Flatten HTML into runs. Block boundaries become spaces, matching the single
 * line of text a lower third shows.
 */
export function parseTextRuns(html: string): TextRun[] {
    if (!html) return []

    if (typeof DOMParser === 'undefined') {
        // No DOM (a non-browser context): fall back to unstyled text rather than
        // dropping the content entirely.
        const text = normalizeSpace(html.replace(/<[^>]*>/g, ' ')).trim()
        return text ? [{ text, ...BASE_STYLE }] : []
    }

    const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const runs: TextRun[] = []

    const walk = (node: Node, inherited: RunStyle) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3 /* text */) {
                const text = normalizeSpace(child.textContent ?? '')
                if (text) runs.push({ text, ...inherited })
                continue
            }
            if (child.nodeType !== 1 /* element */) continue

            const element = child as Element
            const tag = element.tagName.toLowerCase()
            if (tag === 'br') {
                runs.push({ text: ' ', ...inherited })
                continue
            }

            walk(element, styleFromElement(element, inherited))

            // A block element ends with a space so words don't run together.
            if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                runs.push({ text: ' ', ...inherited })
            }
        }
    }

    walk(document.body, BASE_STYLE)
    return mergeRuns(runs)
}

/** Join neighbouring runs that share a style, and trim the ends. */
export function mergeRuns(runs: TextRun[]): TextRun[] {
    const merged: TextRun[] = []

    for (const run of runs) {
        const previous = merged[merged.length - 1]
        if (
            previous &&
            previous.bold === run.bold &&
            previous.italic === run.italic &&
            previous.color === run.color
        ) {
            previous.text += run.text
        } else {
            merged.push({ ...run })
        }
    }

    if (merged.length > 0) {
        merged[0].text = merged[0].text.replace(/^\s+/, '')
        const last = merged[merged.length - 1]
        last.text = last.text.replace(/\s+$/, '')
    }

    return merged.filter((run) => run.text.length > 0)
}

/** The plain text of a set of runs — for titles, logs and tests. */
export function runsToText(runs: TextRun[]): string {
    return runs.map((run) => run.text).join('').trim()
}

/** `ctx.font` for a run at a given size. */
export function fontForRun(run: TextRun, fontPx: number, fontFamily: string, baseWeight: string): string {
    const weight = run.bold ? '700' : baseWeight
    const style = run.italic ? 'italic ' : ''
    return `${style}${weight} ${Math.round(fontPx)}px ${fontFamily}`
}
