/**
 * CSS gradients on a canvas.
 *
 * Templates store their backgrounds as CSS — `linear-gradient(135deg, #667eea
 * 0%, #764ba2 100%)` — which the DOM output paints for free. The canvas feeds
 * have to draw the same thing, so this reads the common forms: linear gradients
 * with an angle or a `to <side>` direction, radial gradients drawn as a circle
 * from the centre, and colour stops with or without positions.
 */

export interface GradientStop {
    color: string
    /** 0..1, or null for "spread evenly", as CSS does. */
    offset: number | null
}

export type CssGradient =
    | { kind: 'linear'; angleDeg: number; stops: GradientStop[] }
    | { kind: 'radial'; stops: GradientStop[] }

interface GradientContext {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void }
    createRadialGradient?(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void }
    fillStyle: string | object
    fillRect(x: number, y: number, w: number, h: number): void
}

const SIDES: Record<string, number> = {
    'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
    'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
    'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315,
}

/** Split on commas that aren't inside parentheses: `rgb(1, 2, 3)` stays whole. */
function splitTopLevel(text: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '(') depth++
        else if (ch === ')') depth--
        else if (ch === ',' && depth === 0) {
            parts.push(text.slice(start, i).trim())
            start = i + 1
        }
    }
    parts.push(text.slice(start).trim())
    return parts.filter(Boolean)
}

function parseStop(part: string): GradientStop {
    // A trailing percentage is the position; everything before it is the colour.
    const match = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(part)
    if (match) return { color: match[1].trim(), offset: Number(match[2]) / 100 }
    return { color: part.trim(), offset: null }
}

function parseAngle(part: string): number | null {
    const lower = part.toLowerCase().replace(/\s+/g, ' ')
    if (lower in SIDES) return SIDES[lower]
    const deg = /^(-?\d+(?:\.\d+)?)deg$/.exec(lower)
    if (deg) return Number(deg[1])
    const turn = /^(-?\d+(?:\.\d+)?)turn$/.exec(lower)
    if (turn) return Number(turn[1]) * 360
    const rad = /^(-?\d+(?:\.\d+)?)rad$/.exec(lower)
    if (rad) return (Number(rad[1]) * 180) / Math.PI
    return null
}

/** Read a CSS gradient, or null when `css` isn't one this understands. */
export function parseCssGradient(css: string): CssGradient | null {
    const match = /^\s*(linear|radial)-gradient\((.*)\)\s*$/is.exec(css)
    if (!match) return null
    const parts = splitTopLevel(match[2])
    if (match[1].toLowerCase() === 'linear') {
        const angle = parts.length > 0 ? parseAngle(parts[0]) : null
        const stops = (angle === null ? parts : parts.slice(1)).map(parseStop)
        return stops.length >= 2 ? { kind: 'linear', angleDeg: angle ?? 180, stops } : null
    }
    // Radial: drop a leading shape/position clause (`circle at center`).
    const first = parts[0] ?? ''
    const shaped = /^(circle|ellipse|closest|farthest|at\s)/i.test(first)
    const stops = (shaped ? parts.slice(1) : parts).map(parseStop)
    return stops.length >= 2 ? { kind: 'radial', stops } : null
}

/** Stop offsets with the gaps filled in, as CSS spreads unpositioned stops. */
export function resolveStops(stops: GradientStop[]): { color: string; offset: number }[] {
    const offsets = stops.map((s) => s.offset)
    if (offsets[0] === null) offsets[0] = 0
    if (offsets[offsets.length - 1] === null) offsets[offsets.length - 1] = 1
    for (let i = 1; i < offsets.length; i++) {
        if (offsets[i] !== null) continue
        let j = i
        while (offsets[j] === null) j++
        const from = offsets[i - 1] as number
        const to = offsets[j] as number
        for (let k = i; k < j; k++) offsets[k] = from + ((to - from) * (k - i + 1)) / (j - i + 1)
    }
    return stops.map((s, i) => ({ color: s.color, offset: Math.min(1, Math.max(0, offsets[i] as number)) }))
}

/** Fill a `width` × `height` rectangle with `gradient`, laid out as CSS would. */
export function paintCssGradient(ctx: GradientContext, gradient: CssGradient, width: number, height: number): void {
    let fill: { addColorStop(offset: number, color: string): void }
    if (gradient.kind === 'linear') {
        // CSS: 0deg points up and angles turn clockwise; the gradient line runs
        // through the centre, long enough that the corners get the end colours.
        const theta = (gradient.angleDeg * Math.PI) / 180
        const dx = Math.sin(theta)
        const dy = -Math.cos(theta)
        const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2
        const cx = width / 2
        const cy = height / 2
        fill = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
    } else if (ctx.createRadialGradient) {
        // farthest-corner, the CSS default, as a circle.
        const r = Math.hypot(width, height) / 2
        fill = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r)
    } else {
        return
    }
    for (const stop of resolveStops(gradient.stops)) {
        try {
            fill.addColorStop(stop.offset, stop.color)
        } catch {
            // A colour the canvas can't parse (a CSS variable): skip that stop.
        }
    }
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, width, height)
}
