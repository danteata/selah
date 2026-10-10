/**
 * Keyframed values with After Effects' temporal semantics.
 *
 * Between two keys a value moves linearly, along a Bezier ease, or holds. A
 * Bezier ease is given per side as a *speed* (value units per second) and an
 * *influence* (fraction of the segment's duration, 0..1), the numbers After
 * Effects' Keyframe Velocity dialog shows, so an animation designed there can be
 * copied over number for number.
 *
 * Ported from effectcraft `crates/keyframe/src/lib.rs` (temporal half only:
 * motion paths, roving and time-reverse are left out). Its ease was checked
 * against live After Effects to 3e-11; the tests carry those samples over.
 * Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors,
 * MIT OR Apache-2.0 — see THIRD_PARTY_NOTICES.md.
 */

export type Interp = 'linear' | 'bezier' | 'hold'

/** One side's temporal ease: speed in units/s and influence 0..1. */
export interface Ease {
    speed: number
    influence: number
}

/** Easy Ease: zero speed, 33.33 % influence. */
export const EASY: Ease = { speed: 0, influence: 1 / 3 }

const DEFAULT_EASE: Ease = { speed: 0, influence: 1 / 6 }

/** A value: a number, or a fixed-length list of numbers (a position, a colour). */
export type KeyValue = number | readonly number[]

export interface Keyframe {
    /** Seconds. */
    time: number
    value: KeyValue
    inInterp: Interp
    outInterp: Interp
    /** Per dimension, or one entry for all. */
    inEase: Ease[]
    outEase: Ease[]
    /** Auto-Bezier: the ease follows the slope between the neighbouring keys. */
    autoBezier: boolean
}

export function key(time: number, value: KeyValue): Keyframe {
    return { time, value, inInterp: 'linear', outInterp: 'linear', inEase: [], outEase: [], autoBezier: false }
}

export function hold(k: Keyframe): Keyframe {
    return { ...k, inInterp: 'hold', outInterp: 'hold' }
}

/** Easy Ease on both sides. */
export function eased(k: Keyframe): Keyframe {
    const n = Math.max(1, components(k.value).length)
    return {
        ...k,
        inInterp: 'bezier',
        outInterp: 'bezier',
        inEase: Array.from({ length: n }, () => ({ ...EASY })),
        outEase: Array.from({ length: n }, () => ({ ...EASY })),
    }
}

function components(v: KeyValue): readonly number[] {
    return typeof v === 'number' ? [v] : v
}

function withComponents(like: KeyValue, c: readonly number[]): KeyValue {
    return typeof like === 'number' ? c[0] ?? 0 : [...c]
}

/** Cubic Bezier in 1D. */
export function bez(p0: number, p1: number, p2: number, p3: number, u: number): number {
    const v = 1 - u
    return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3
}

export function bezD(p0: number, p1: number, p2: number, p3: number, u: number): number {
    const v = 1 - u
    return 3 * v * v * (p1 - p0) + 6 * v * u * (p2 - p1) + 3 * u * u * (p3 - p2)
}

/** Solve `bez(x0..x3, u) = x` for u in 0..1 (x curve monotone). */
export function solveU(x0: number, x1: number, x2: number, x3: number, x: number): number {
    if (x <= x0) return 0
    if (x >= x3) return 1
    if (x1 === x3 && x2 === x0) {
        // Full influence on both sides has a flat time derivative at the midpoint.
        // Its exact inverse avoids cancellation and residual-only Newton convergence there.
        const progress = (x - x0) / (x3 - x0)
        return 0.5 + Math.cbrt((progress - 0.5) * 0.25)
    }
    let u = (x - x0) / (x3 - x0)
    for (let i = 0; i < 8; i++) {
        const f = bez(x0, x1, x2, x3, u) - x
        const d = bezD(x0, x1, x2, x3, u)
        if (Math.abs(d) < 1e-12) break
        if (Math.abs(f / d) < 1e-12) return u
        const n = u - f / d
        if (!(n >= 0 && n <= 1)) break
        u = n
    }
    let lo = 0
    let hi = 1
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) * 0.5
        if (bez(x0, x1, x2, x3, mid) < x) lo = mid
        else hi = mid
    }
    return (lo + hi) * 0.5
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Progress 0..1 through a Bezier segment whose value goes from 0 to 1, with
 * normalised out/in speeds (speed × duration / Δvalue) and influences.
 */
export function easeProgress(outSpeedN: number, outInf: number, inSpeedN: number, inInf: number, x: number): number {
    // The time handles may cross. AE keeps both influences; rescaling them changes the ease.
    const i0 = clamp01(outInf)
    const i1 = clamp01(inInf)
    const u = solveU(0, i0, 1 - i1, 1, x)
    return bez(0, outSpeedN * i0, 1 - inSpeedN * i1, 1, u)
}

/** Effective ease of key `i` for dimension `d` (auto-Bezier keys get the neighbour slope). */
function effectiveEase(keys: readonly Keyframe[], i: number, d: number, out: boolean): Ease {
    const k = keys[i]
    const list = out ? k.outEase : k.inEase
    if (k.autoBezier && i > 0 && i + 1 < keys.length) {
        const dt = keys[i + 1].time - keys[i - 1].time
        const a = components(keys[i - 1].value)
        const c = components(keys[i + 1].value)
        return { speed: ((c[d] ?? 0) - (a[d] ?? 0)) / Math.max(dt, 1e-12), influence: 1 / 6 }
    }
    return list[d] ?? list[0] ?? DEFAULT_EASE
}

/** Evaluate keyframes at `t` seconds. Undefined only for an empty list. */
export function evaluate(keys: readonly Keyframe[], t: number): KeyValue | undefined {
    const first = keys[0]
    if (!first) return undefined
    if (keys.length === 1 || t <= first.time) return first.value
    const last = keys[keys.length - 1]
    if (t >= last.time) return last.value
    // The last key at or before `t`.
    let i = 0
    while (i + 1 < keys.length && keys[i + 1].time <= t) i++
    return segmentValue(keys, i, t)
}

/** Evaluate a single-number animation. */
export function evaluateNumber(keys: readonly Keyframe[], t: number): number {
    const v = evaluate(keys, t)
    return v === undefined ? 0 : components(v)[0] ?? 0
}

/** Value inside segment `i` → `i + 1` at `t` seconds. */
export function segmentValue(keys: readonly Keyframe[], i: number, t: number): KeyValue {
    const a = keys[i]
    const b = keys[i + 1]
    if (a.outInterp === 'hold') return a.value
    const dur = Math.max(b.time - a.time, 1e-12)
    const x = clamp01((t - a.time) / dur)
    const linOut = a.outInterp === 'linear'
    // A Hold in-side only matters for the segment it ends, which the out side above decides:
    // it shapes the incoming segment like a linear side.
    const linIn = b.inInterp !== 'bezier'
    const ca = components(a.value)
    const cb = components(b.value)
    if (linOut && linIn) {
        return withComponents(a.value, ca.map((v, d) => v + ((cb[d] ?? v) - v) * x))
    }
    const out: number[] = []
    for (let d = 0; d < ca.length; d++) {
        const dv = (cb[d] ?? ca[d]) - ca[d]
        const eo = linOut ? { speed: dv / dur, influence: 1 / 3 } : effectiveEase(keys, i, d, true)
        const ei = linIn ? { speed: dv / dur, influence: 1 / 3 } : effectiveEase(keys, i + 1, d, false)
        // Bezier in (time, value) space directly: P1 = (i0, v0 + s0*i0*dur), P2 = (1-i1, v1 - s1*i1*dur).
        const i0 = clamp01(eo.influence)
        const i1 = clamp01(ei.influence)
        const u = solveU(0, i0, 1 - i1, 1, x)
        out.push(bez(ca[d], ca[d] + eo.speed * i0 * dur, (cb[d] ?? ca[d]) - ei.speed * i1 * dur, cb[d] ?? ca[d], u))
    }
    return withComponents(a.value, out)
}

/** Velocity (units/s per dimension) at `t` by central difference. */
export function velocity(keys: readonly Keyframe[], t: number): number[] {
    const h = 0.001
    const a = evaluate(keys, t - h)
    const b = evaluate(keys, t + h)
    if (a === undefined || b === undefined) return []
    const cb = components(b)
    return components(a).map((x, d) => ((cb[d] ?? x) - x) / (2 * h))
}

/**
 * Insert a key, keeping the list sorted, or replace the key at the same time
 * (keeping its interpolation, so only the value changes). Returns its index.
 */
export function setKey(keys: Keyframe[], k: Keyframe): number {
    const at = keys.findIndex((existing) => existing.time === k.time)
    if (at >= 0) {
        const old = keys[at]
        keys[at] = {
            ...k,
            inInterp: old.inInterp,
            outInterp: old.outInterp,
            inEase: old.inEase,
            outEase: old.outEase,
            autoBezier: old.autoBezier,
        }
        return at
    }
    let i = 0
    while (i < keys.length && keys[i].time < k.time) i++
    keys.splice(i, 0, k)
    return i
}
