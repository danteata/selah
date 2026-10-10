/**
 * Text selector maths: how much each character, word or line is affected by
 * an animation.
 *
 * A selection value is a fraction: 1 means fully affected (a build-in's
 * "hidden" or "offset" state), 0 untouched; negative values invert. Follows
 * After Effects' Range Selector — Start / End / Offset over `n` units, a Shape,
 * Ease High / Low and Amount — so a text animation designed there carries over.
 *
 * Ported from effectcraft `crates/text/src/selectors.rs` (the Range selector
 * and modes; its Wiggly selector and Randomize Order aren't used here).
 * Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors,
 * MIT OR Apache-2.0 — see THIRD_PARTY_NOTICES.md.
 */

export type Shape = 'square' | 'rampUp' | 'rampDown' | 'triangle' | 'round' | 'smooth'

/** What a selector counts. */
export type BasedOn = 'characters' | 'charactersExcludingSpaces' | 'words' | 'lines'

/** How a selector combines with the selectors above it. */
export type Mode = 'add' | 'subtract' | 'intersect' | 'min' | 'max' | 'difference'

/** Range selector parameters, as fractions of the unit count (not percent). */
export interface Range {
    start: number
    end: number
    offset: number
    /** -1..1. */
    amount: number
    shape: Shape
    /** 0..1, Square only: the soft edge's width in units. */
    smoothness: number
    /** -1..1. */
    easeHigh: number
    easeLow: number
}

export const DEFAULT_RANGE: Range = {
    start: 0,
    end: 1,
    offset: 0,
    amount: 1,
    shape: 'square',
    smoothness: 1,
    easeHigh: 0,
    easeLow: 0,
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Selection before the first selector: nothing for add / max / difference,
 *  everything for subtract / intersect / min (so a lone subtract inverts). */
export function modeInitial(mode: Mode): number {
    return mode === 'subtract' || mode === 'intersect' || mode === 'min' ? 1 : 0
}

/** Combine the selection so far with this selector's value. */
export function modeCombine(mode: Mode, acc: number, v: number): number {
    const r = mode === 'add' ? acc + v
        : mode === 'subtract' ? acc - v
            : mode === 'intersect' ? acc * v
                : mode === 'min' ? Math.min(acc, v)
                    : mode === 'max' ? Math.max(acc, v)
                        : Math.abs(acc - v)
    return clamp(r, -1, 1)
}

/** Shape profile over the range (`f` = 0 at Start, 1 at End). */
export function shapeValue(shape: Shape, f: number): number {
    switch (shape) {
        case 'square':
            return f >= 0 && f <= 1 ? 1 : 0
        // Ramps hold their end values outside the range (cascades animate Offset across it).
        case 'rampUp':
            return clamp(f, 0, 1)
        case 'rampDown':
            return 1 - clamp(f, 0, 1)
    }
    if (!(f >= 0 && f <= 1)) return 0
    switch (shape) {
        case 'triangle':
            return 1 - Math.abs(2 * f - 1)
        case 'round':
            return Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2))
        case 'smooth': {
            const t = 1 - Math.abs(2 * f - 1)
            return t * t * (3 - 2 * t)
        }
    }
}

/**
 * Ease High / Low remap of a selection value (0..1): positive values slow the
 * change near the fully selected (high) or unselected (low) end, negative values
 * make it more abrupt. Monotonic for -1..1.
 */
export function ease(v: number, high: number, low: number): number {
    if (high === 0 && low === 0) return v
    const t = clamp(v, 0, 1)
    const p1 = (1 - clamp(low, -1, 1)) / 3
    const p2 = 1 - (1 - clamp(high, -1, 1)) / 3
    const u = 1 - t
    return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t
}

/** Selection of unit `i` of `n` (0-based) by a range selector. */
export function rangeValue(r: Range, i: number, n: number): number {
    const count = Math.max(1, n)
    const s = Math.min(r.start, r.end) + r.offset
    const e = Math.max(r.start, r.end) + r.offset
    const unit = 1 / count
    const c = (i + 0.5) * unit
    let v: number
    if (r.shape === 'square') {
        const w = clamp(r.smoothness, 0, 1) * unit
        const edge = (d: number) => (w > 1e-12 ? clamp(d / w + 0.5, 0, 1) : d >= 0 ? 1 : 0)
        v = e - s <= 1e-12 ? 0 : Math.min(edge(c - s), edge(e - c))
    } else if (e - s <= 1e-12) {
        // Degenerate range: ramps step at the point, others select nothing.
        v = r.shape === 'rampUp' ? Number(c >= s) : r.shape === 'rampDown' ? Number(c < s) : 0
    } else {
        v = ease(shapeValue(r.shape, (c - s) / (e - s)), r.easeHigh, r.easeLow)
    }
    return v * r.amount
}
