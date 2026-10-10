/**
 * Text build-ins: a lower third's title arriving letter by letter, word by
 * word, or line by line.
 *
 * Each preset is data in After Effects' terms: what to count (characters,
 * words, lines), a Range selector whose start or offset is keyframed across the
 * build-in, and how much a fully selected unit is faded or moved. A selection
 * of 1 is a unit's "before" state (hidden, offset); the animation carries every
 * unit to 0. The maths is `keyframe.ts` and `textSelectors.ts`.
 */

import { eased, evaluateNumber, key, type Keyframe } from './keyframe'
import { DEFAULT_RANGE, rangeValue, type BasedOn, type Range } from './textSelectors'

export type TextBuildInPreset = 'typewriter' | 'word-rise' | 'letter-fade' | 'slide-in'

/** Stored on a slide's (or template's) style. */
export interface TextAnimation {
    preset: TextBuildInPreset
    /** Seconds; the preset's own length when unset. */
    duration?: number
    /** Seconds before it starts. */
    delay?: number
}

interface PresetSpec {
    label: string
    description: string
    basedOn: BasedOn
    range: Range
    /** Which range parameter moves, from → to across the build-in. */
    animate: 'start' | 'offset'
    from: number
    to: number
    eased: boolean
    duration: number
    /** At selection 1: opacity change (-1 = invisible), and offset in em. */
    opacity: number
    x: number
    y: number
}

export const TEXT_BUILD_INS: Record<TextBuildInPreset, PresetSpec> = {
    typewriter: {
        label: 'Typewriter',
        description: 'Letters appear one at a time',
        basedOn: 'characters',
        range: { ...DEFAULT_RANGE, smoothness: 0 },
        animate: 'start',
        from: 0,
        to: 1,
        eased: false,
        duration: 1.2,
        opacity: -1,
        x: 0,
        y: 0,
    },
    'word-rise': {
        label: 'Word rise',
        description: 'Words float up into place',
        basedOn: 'words',
        range: { ...DEFAULT_RANGE, shape: 'rampUp' },
        animate: 'offset',
        from: -1,
        to: 1,
        eased: true,
        duration: 0.9,
        opacity: -1,
        x: 0,
        y: 0.6,
    },
    'letter-fade': {
        label: 'Letter fade',
        description: 'A soft fade sweeps across',
        basedOn: 'charactersExcludingSpaces',
        range: { ...DEFAULT_RANGE, shape: 'rampUp' },
        animate: 'offset',
        from: -1,
        to: 1,
        eased: false,
        duration: 1.0,
        opacity: -1,
        x: 0,
        y: 0,
    },
    'slide-in': {
        label: 'Slide in',
        description: 'Each line slides in from the left',
        basedOn: 'lines',
        range: { ...DEFAULT_RANGE, smoothness: 1 },
        animate: 'start',
        from: 0,
        to: 1,
        eased: true,
        duration: 0.7,
        opacity: -1,
        x: -1.5,
        y: 0,
    },
}

export function isTextBuildInPreset(value: unknown): value is TextBuildInPreset {
    return typeof value === 'string' && value in TEXT_BUILD_INS
}

export function buildInDuration(animation: TextAnimation): number {
    return Math.max(0.05, animation.duration ?? TEXT_BUILD_INS[animation.preset].duration)
}

function keys(spec: PresetSpec, duration: number): Keyframe[] {
    const a = key(0, spec.from)
    const b = key(duration, spec.to)
    return spec.eased ? [eased(a), eased(b)] : [a, b]
}

/** How selected unit `i` of `n` is at `t` seconds into the build-in (1 = before, 0 = arrived). */
export function selectionAt(animation: TextAnimation, t: number, i: number, n: number): number {
    const spec = TEXT_BUILD_INS[animation.preset]
    const duration = buildInDuration(animation)
    const moving = evaluateNumber(keys(spec, duration), t)
    const range = { ...spec.range, [spec.animate]: moving }
    return Math.min(1, Math.max(0, rangeValue(range, i, n)))
}

/** The inline style for a unit at selection `s`. */
export function unitStyle(preset: TextBuildInPreset, s: number): { opacity: string; transform: string } {
    const spec = TEXT_BUILD_INS[preset]
    const opacity = Math.min(1, Math.max(0, 1 + spec.opacity * s))
    const moved = spec.x !== 0 || spec.y !== 0
    return {
        opacity: opacity >= 1 ? '' : String(opacity),
        transform: moved && s > 0 ? `translate(${spec.x * s}em, ${spec.y * s}em)` : '',
    }
}

/** Whether a preset moves units, which needs them laid out as inline-blocks. */
export function presetMoves(preset: TextBuildInPreset): boolean {
    const spec = TEXT_BUILD_INS[preset]
    return spec.x !== 0 || spec.y !== 0
}

const WORD = /\S+/g

/**
 * Wrap the text of `html` in one span per unit, each starting in its "before"
 * state so nothing flashes up before the first frame. Lines can't be known from
 * markup, so `lines` wraps words and the driver groups them by where they land.
 *
 * Tags are kept as they are; only text nodes are split. Uses the browser's
 * parser, so it runs where the output renders.
 */
export function wrapUnits(html: string, preset: TextBuildInPreset): string {
    if (typeof DOMParser === 'undefined') return html
    const spec = TEXT_BUILD_INS[preset]
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const before = unitStyle(preset, 1)
    const display = presetMoves(preset) ? 'display:inline-block;' : ''
    const style = `${display}${before.opacity ? `opacity:${before.opacity};` : ''}${before.transform ? `transform:${before.transform};` : ''}`

    const texts: Text[] = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)

    let index = 0
    const unit = (text: string) => {
        const span = doc.createElement('span')
        span.setAttribute('data-u', String(index++))
        span.setAttribute('style', style)
        span.textContent = text
        return span
    }

    for (const node of texts) {
        const text = node.data
        if (!text) continue
        const out = doc.createDocumentFragment()
        if (spec.basedOn === 'characters' || spec.basedOn === 'charactersExcludingSpaces') {
            for (const ch of Array.from(text)) {
                if (/\s/.test(ch) && spec.basedOn === 'charactersExcludingSpaces') out.append(ch)
                else out.append(unit(ch))
            }
        } else {
            let last = 0
            for (const match of text.matchAll(WORD)) {
                if (match.index > last) out.append(text.slice(last, match.index))
                out.append(unit(match[0]))
                last = match.index + match[0].length
            }
            if (last < text.length) out.append(text.slice(last))
        }
        node.replaceWith(out)
    }
    return doc.body.innerHTML
}
