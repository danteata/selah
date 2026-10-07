/**
 * Motion backgrounds Selah draws itself, in code.
 *
 * Every church gets them with nothing to download, upload or license: video
 * packs from sites like Church Media Drop are licensed to each church that
 * downloads them and may not be redistributed, so Selah can't ship those. These
 * are drawn on a canvas each frame, so they look the same on every device and
 * cost nothing to store or sync.
 *
 * A slide uses one with `backgroundType: 'motion'` and `background:
 * 'motion:<id>'`. Each entry also has a still `poster` (a CSS background) for
 * places that shouldn't animate — a long queue of cards, for one.
 *
 * Drawing is deterministic from a seed so the projector, the preview and a
 * remote viewer show the same scene, and is written for a 1080p projector on
 * an ordinary laptop: a few hundred primitives a frame, no filters.
 */

export interface MotionScene {
    /** Fraction of the display resolution to draw at; the browser scales the
     *  canvas up. Soft scenes (glows, curtains) look the same at a third of
     *  the pixels and cost a ninth. Default 1. */
    renderScale?: number
    /** Called once per size; returns per-frame state. */
    setup(width: number, height: number, random: () => number): unknown
    /** Draw frame `t` (seconds). */
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, state: unknown): void
}

export interface MotionBackground {
    id: string
    name: string
    description: string
    /** A CSS background that stands in for it when not animating. */
    poster: string
    scene: MotionScene
    /** No longer offered for new templates; still drawn for templates that
     *  already use it. */
    retired?: boolean
}

/** Deterministic random numbers, so every instance draws the same scene. */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let x = s
        x = Math.imul(x ^ (x >>> 15), x | 1)
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color.replace('ALPHA', String(alpha)))
    g.addColorStop(1, color.replace('ALPHA', '0'))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

interface Star { x: number; y: number; r: number; phase: number; speed: number; depth: number }

const galaxy: MotionScene = {
    setup(w, h, random) {
        const stars: Star[] = Array.from({ length: Math.round((w * h) / 4500) }, () => ({
            x: random() * w,
            y: random() * h,
            r: random() < 0.08 ? 1.4 + random() * 1.4 : 0.4 + random() * 0.9,
            phase: random() * Math.PI * 2,
            speed: 0.5 + random() * 1.5,
            depth: 0.2 + random() * 0.8,
        }))
        // The nebula is soft: drawn at a quarter size and scaled up, it looks
        // the same at a sixteenth of the cost.
        const nebula = typeof document !== 'undefined' ? document.createElement('canvas') : null
        if (nebula) {
            nebula.width = Math.max(1, Math.round(w / 4))
            nebula.height = Math.max(1, Math.round(h / 4))
        }
        return { stars, nebula, nebulaCtx: nebula?.getContext('2d') ?? null }
    },
    draw(ctx, w, h, t, state) {
        const { stars, nebula, nebulaCtx } = state as { stars: Star[]; nebula: HTMLCanvasElement | null; nebulaCtx: CanvasRenderingContext2D | null }
        const sky = ctx.createLinearGradient(0, 0, w, h)
        sky.addColorStop(0, '#05030f')
        sky.addColorStop(0.5, '#0b0726')
        sky.addColorStop(1, '#02010a')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)

        // Nebula: soft clouds circling slowly about the centre.
        const target = nebulaCtx ?? ctx
        const nw = nebula && nebulaCtx ? nebula.width : w
        const nh = nebula && nebulaCtx ? nebula.height : h
        if (nebulaCtx) nebulaCtx.clearRect(0, 0, nw, nh)
        target.globalCompositeOperation = 'lighter'
        const clouds: Array<[number, number, number, string]> = [
            [0, 0.32, 0.55, 'rgba(120, 60, 220, ALPHA)'],
            [2.1, 0.28, 0.45, 'rgba(40, 110, 230, ALPHA)'],
            [4.2, 0.3, 0.4, 'rgba(220, 60, 160, ALPHA)'],
        ]
        for (const [offset, dist, size, color] of clouds) {
            const a = t * 0.03 + offset
            glow(target, nw / 2 + Math.cos(a) * nw * dist, nh / 2 + Math.sin(a) * nh * dist * 0.6, Math.max(nw, nh) * size, color, 0.32)
        }
        glow(target, nw / 2, nh / 2, Math.min(nw, nh) * 0.35, 'rgba(255, 220, 255, ALPHA)', 0.08)
        target.globalCompositeOperation = 'source-over'
        ctx.globalCompositeOperation = 'lighter'
        if (nebula && nebulaCtx) ctx.drawImage(nebula, 0, 0, w, h)

        // Stars drift slowly; nearer ones faster, each twinkling.
        for (const s of stars) {
            const x = (s.x + t * 6 * s.depth) % w
            const twinkle = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase)
            ctx.fillStyle = `rgba(255, 255, 255, ${(0.35 + 0.65 * s.depth) * twinkle})`
            ctx.beginPath()
            ctx.arc(x, s.y, s.r, 0, Math.PI * 2)
            ctx.fill()
            if (s.r > 1.4) glow(ctx, x, s.y, s.r * 6, 'rgba(180, 200, 255, ALPHA)', 0.25 * twinkle)
        }
        ctx.globalCompositeOperation = 'source-over'
    },
}

interface Orb { x: number; y: number; r: number; dx: number; dy: number; phase: number; color: string }

function orbScene(base: [string, string], colors: string[], count: number, alpha: number): MotionScene {
    return {
        renderScale: 0.4,
        setup(w, h, random) {
            const orbs: Orb[] = Array.from({ length: count }, (_, i) => ({
                x: random() * w,
                y: random() * h,
                r: Math.max(w, h) * (0.18 + random() * 0.22),
                dx: (random() - 0.5) * 0.06,
                dy: (random() - 0.5) * 0.05,
                phase: random() * Math.PI * 2,
                color: colors[i % colors.length],
            }))
            return { orbs }
        },
        draw(ctx, w, h, t, state) {
            const { orbs } = state as { orbs: Orb[] }
            const bg = ctx.createLinearGradient(0, 0, 0, h)
            bg.addColorStop(0, base[0])
            bg.addColorStop(1, base[1])
            ctx.fillStyle = bg
            ctx.fillRect(0, 0, w, h)
            ctx.globalCompositeOperation = 'lighter'
            for (const o of orbs) {
                const x = w / 2 + Math.sin(t * o.dx + o.phase) * w * 0.45 + (o.x - w / 2) * 0.3
                const y = h / 2 + Math.cos(t * o.dy + o.phase) * h * 0.4 + (o.y - h / 2) * 0.3
                const pulse = 0.75 + 0.25 * Math.sin(t * 0.4 + o.phase)
                glow(ctx, x, y, o.r * pulse, o.color, alpha)
            }
            ctx.globalCompositeOperation = 'source-over'
        },
    }
}

interface Mote { x: number; y: number; r: number; speed: number; sway: number; phase: number; alpha: number }

const embers: MotionScene = {
    setup(w, h, random) {
        const motes: Mote[] = Array.from({ length: Math.round((w * h) / 9000) }, () => ({
            x: random() * w,
            y: random() * h,
            r: 0.8 + random() * 2.6,
            speed: 6 + random() * 18,
            sway: 8 + random() * 24,
            phase: random() * Math.PI * 2,
            alpha: 0.25 + random() * 0.6,
        }))
        return { motes }
    },
    draw(ctx, w, h, t, state) {
        const { motes } = state as { motes: Mote[] }
        const bg = ctx.createRadialGradient(w / 2, h * 1.1, 0, w / 2, h * 1.1, Math.max(w, h))
        bg.addColorStop(0, '#3a1a0a')
        bg.addColorStop(0.5, '#160a06')
        bg.addColorStop(1, '#050303')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        for (const m of motes) {
            const y = h - ((h - m.y + t * m.speed) % (h + 40)) + 20
            const x = m.x + Math.sin(t * 0.5 + m.phase) * m.sway
            const flicker = 0.7 + 0.3 * Math.sin(t * 3 + m.phase)
            glow(ctx, x, y, m.r * 5, 'rgba(255, 170, 70, ALPHA)', m.alpha * flicker * 0.55)
            ctx.fillStyle = `rgba(255, 220, 160, ${m.alpha * flicker})`
            ctx.beginPath()
            ctx.arc(x, y, m.r * 0.6, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
    },
}

const waves: MotionScene = {
    setup() {
        return null
    },
    draw(ctx, w, h, t) {
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#020a1c')
        sky.addColorStop(0.55, '#06203d')
        sky.addColorStop(1, '#020812')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        // Moonlight on the water.
        glow(ctx, w * 0.5, h * 0.42, Math.max(w, h) * 0.4, 'rgba(110, 170, 255, ALPHA)', 0.14)

        const scale = h / 1080
        // Back to front: each swell darker and slower, its crest lit.
        const layers: Array<[number, number, number, number, [number, number, number]]> = [
            [0.5, 26, 0.0019, 0.22, [40, 110, 170]],
            [0.6, 34, 0.0026, -0.3, [28, 88, 145]],
            [0.7, 40, 0.0031, 0.38, [18, 66, 118]],
            [0.81, 46, 0.0037, -0.46, [10, 44, 86]],
        ]
        const step = Math.max(4, Math.round(w / 240))
        for (const [level, amp, freq, speed, [r, g, b]] of layers) {
            const top = h * level - amp * scale * 1.4
            const fill = ctx.createLinearGradient(0, top, 0, h)
            fill.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.85)`)
            fill.addColorStop(1, 'rgba(2, 8, 18, 0.95)')
            const crestY = (x: number) => h * level
                + Math.sin(x * freq + t * speed) * amp * scale
                + Math.sin(x * freq * 2.3 - t * speed * 0.7) * amp * 0.35 * scale
            ctx.fillStyle = fill
            ctx.beginPath()
            ctx.moveTo(0, h)
            for (let x = 0; x <= w + step; x += step) ctx.lineTo(x, crestY(x))
            ctx.lineTo(w, h)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = `rgba(${r + 90}, ${g + 110}, ${b + 100}, 0.35)`
            ctx.lineWidth = Math.max(1, 2 * scale)
            ctx.beginPath()
            for (let x = 0; x <= w + step; x += step) (x === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x, crestY(x))
            ctx.stroke()
        }
    },
}

interface Beam { angle: number; width: number; phase: number; swing: number; speed: number }
interface Dust { x: number; y: number; r: number; vx: number; vy: number; phase: number }

const rays: MotionScene = {
    renderScale: 0.5,
    setup(w, h, random) {
        const beams: Beam[] = Array.from({ length: 7 }, (_, i) => ({
            angle: 0.2 + i * 0.15 + random() * 0.06,
            width: 0.03 + random() * 0.045,
            phase: random() * Math.PI * 2,
            swing: 0.06 + random() * 0.08,
            speed: 0.18 + random() * 0.22,
        }))
        const dust: Dust[] = Array.from({ length: Math.round((w * h) / 2600) }, () => ({
            x: random() * w,
            y: random() * h,
            r: 0.5 + random() * 1.4,
            vx: 4 + random() * 10,
            vy: -2 + random() * 6,
            phase: random() * Math.PI * 2,
        }))
        return { beams, dust }
    },
    draw(ctx, w, h, t, state) {
        const { beams, dust } = state as { beams: Beam[]; dust: Dust[] }
        const bg = ctx.createLinearGradient(0, 0, w, h)
        bg.addColorStop(0, '#16285a')
        bg.addColorStop(0.55, '#080f28')
        bg.addColorStop(1, '#03050e')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        // Light from beyond the top-left corner, fanning across the frame;
        // each beam swings and brightens on its own rhythm.
        const ox = -w * 0.1
        const oy = -h * 0.22
        const len = Math.hypot(w, h) * 1.4
        const lit: Array<[number, number, number]> = []
        for (const b of beams) {
            const a = b.angle + Math.sin(t * b.speed + b.phase) * b.swing
            const strength = 0.045 + 0.05 * (0.5 + 0.5 * Math.sin(t * b.speed * 1.7 + b.phase * 2))
            lit.push([a, b.width * 2.2, strength])
            for (const [widen, fade] of [[1, 1], [1.9, 0.55], [2.9, 0.3]] as const) {
                const spread = b.width * widen
                const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len)
                g.addColorStop(0, `rgba(215, 228, 255, ${strength * fade * 1.6})`)
                g.addColorStop(0.65, `rgba(215, 228, 255, ${strength * fade * 0.35})`)
                g.addColorStop(1, 'rgba(215, 228, 255, 0)')
                ctx.fillStyle = g
                ctx.beginPath()
                ctx.moveTo(ox, oy)
                ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len)
                ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len)
                ctx.closePath()
                ctx.fill()
            }
        }
        // Dust drifting through the room, catching the light where a beam is.
        for (const d of dust) {
            const x = (d.x + t * d.vx) % w
            const y = (((d.y + t * d.vy + Math.sin(t * 0.6 + d.phase) * 6) % h) + h) % h
            const angle = Math.atan2(y - oy, x - ox)
            let light = 0.08
            for (const [a, half, strength] of lit) {
                const off = Math.abs(angle - a)
                if (off < half) light = Math.max(light, (1 - off / half) * strength * 14)
            }
            const twinkle = 0.6 + 0.4 * Math.sin(t * 2 + d.phase)
            ctx.fillStyle = `rgba(255, 245, 225, ${Math.min(0.9, light * twinkle)})`
            ctx.beginPath()
            ctx.arc(x, y, d.r, 0, Math.PI * 2)
            ctx.fill()
        }
        glow(ctx, 0, 0, Math.max(w, h) * 0.5, 'rgba(255, 238, 210, ALPHA)', 0.14 + 0.05 * Math.sin(t * 0.5))
        ctx.globalCompositeOperation = 'source-over'
    },
}

interface Ribbon { base: number; amp: number; freq: number; speed: number; phase: number; thickness: number; color: [number, number, number] }

/** Layered ribbons of colour flowing across the whole frame. */
const silk: MotionScene = {
    renderScale: 0.5,
    setup(_w, _h, random) {
        const palette: Array<[number, number, number]> = [
            [120, 70, 230], [70, 120, 240], [40, 180, 220], [190, 80, 210], [90, 60, 200],
        ]
        const ribbons: Ribbon[] = palette.map((color, i) => ({
            base: 0.3 + i * 0.1,
            amp: 0.08 + random() * 0.1,
            freq: 0.8 + random() * 1.2,
            speed: 0.15 + random() * 0.2,
            phase: random() * Math.PI * 2,
            thickness: 0.12 + random() * 0.14,
            color,
        }))
        return { ribbons }
    },
    draw(ctx, w, h, t, state) {
        const { ribbons } = state as { ribbons: Ribbon[] }
        const bg = ctx.createLinearGradient(0, 0, w, h)
        bg.addColorStop(0, '#0a0620')
        bg.addColorStop(1, '#03020c')
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const step = Math.max(4, Math.round(w / 160))
        for (const r of ribbons) {
            const [cr, cg, cb] = r.color
            const curve = (x: number, shift: number) => {
                const u = x / w
                return h * (r.base
                    + r.amp * Math.sin(u * r.freq * Math.PI * 2 + t * r.speed + r.phase + shift)
                    + r.amp * 0.4 * Math.sin(u * r.freq * 4.7 - t * r.speed * 1.3 + r.phase))
            }
            const twist = Math.sin(t * r.speed * 0.8 + r.phase) * 0.8
            // The ribbon is the band between two curves that drift apart and
            // together, so it seems to fold as it flows.
            ctx.beginPath()
            for (let x = 0; x <= w + step; x += step) ctx.lineTo(x, curve(x, 0))
            for (let x = w + step; x >= 0; x -= step) {
                const u = x / w
                const width = h * r.thickness * (0.35 + 0.65 * Math.abs(Math.sin(u * Math.PI * 1.3 + twist + t * 0.1)))
                ctx.lineTo(x, curve(x, 0.35) + width)
            }
            ctx.closePath()
            const top = h * (r.base - r.amp * 1.4)
            const g = ctx.createLinearGradient(0, top, 0, top + h * (r.thickness + r.amp * 2.8))
            g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0)`)
            g.addColorStop(0.45, `rgba(${cr}, ${cg}, ${cb}, 0.22)`)
            g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`)
            ctx.fillStyle = g
            ctx.fill()
            // A bright edge, as light catches the fold.
            ctx.strokeStyle = `rgba(${Math.min(255, cr + 80)}, ${Math.min(255, cg + 80)}, ${Math.min(255, cb + 40)}, 0.18)`
            ctx.lineWidth = Math.max(1, h / 500)
            ctx.beginPath()
            for (let x = 0; x <= w + step; x += step) ctx.lineTo(x, curve(x, 0))
            ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
    },
}

interface Curtain { base: number; color: [number, number, number]; freq: number; speed: number; phase: number; height: number }

const aurora: MotionScene = {
    renderScale: 0.35,
    setup(_w, _h, random) {
        const palette: Array<[number, number, number]> = [[60, 255, 170], [70, 200, 255], [170, 110, 255]]
        const curtains: Curtain[] = palette.map((color, i) => ({
            base: 0.3 + i * 0.08 + random() * 0.04,
            color,
            freq: 1.6 + random() * 1.4,
            speed: 0.05 + random() * 0.05,
            phase: random() * Math.PI * 2,
            height: 0.28 + random() * 0.14,
        }))
        return { curtains }
    },
    draw(ctx, w, h, t, state) {
        const { curtains } = state as { curtains: Curtain[] }
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#01040c')
        sky.addColorStop(0.7, '#03101e')
        sky.addColorStop(1, '#020a12')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const step = Math.max(3, Math.round(w / 320))
        for (const c of curtains) {
            const [r, g, b] = c.color
            for (let x = 0; x < w; x += step) {
                const u = x / w
                // The curtain's lower edge wanders; its brightness ripples along it.
                const edge = h * (c.base + 0.08 * Math.sin(u * c.freq * Math.PI * 2 + t * c.speed * 6 + c.phase)
                    + 0.03 * Math.sin(u * c.freq * 5.1 - t * c.speed * 9))
                const bright = 0.5 + 0.5 * Math.sin(u * 23 + t * 0.6 + c.phase) * Math.sin(u * 7 - t * 0.35)
                const alpha = 0.05 + 0.13 * bright * Math.sin(Math.PI * u)
                const top = edge - h * c.height
                const grad = ctx.createLinearGradient(0, top, 0, edge)
                grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
                grad.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, ${alpha})`)
                grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha * 0.2})`)
                ctx.fillStyle = grad
                ctx.fillRect(x, top, step + 1, edge - top)
            }
        }
        ctx.globalCompositeOperation = 'source-over'
    },
}

export const MOTION_BACKGROUNDS: MotionBackground[] = [
    {
        id: 'galaxy',
        name: 'Galaxy',
        description: 'Drifting stars and a slow-turning nebula',
        poster: 'radial-gradient(ellipse at 35% 40%, rgba(120,60,220,.55), transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(40,110,230,.45), transparent 50%), linear-gradient(135deg, #05030f, #0b0726 50%, #02010a)',
        scene: galaxy,
    },
    {
        id: 'aurora',
        name: 'Aurora',
        description: 'Curtains of green and violet light',
        poster: 'radial-gradient(ellipse 60% 25% at 40% 30%, rgba(60,255,170,.35), transparent 70%), radial-gradient(ellipse 50% 22% at 65% 40%, rgba(170,110,255,.3), transparent 70%), linear-gradient(#01040c, #03101e 70%, #020a12)',
        scene: aurora,
    },
    {
        id: 'warm-glow',
        name: 'Warm Glow',
        description: 'Gold and rose light leaks',
        poster: 'radial-gradient(ellipse at 30% 40%, rgba(255,160,60,.55), transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(240,80,120,.45), transparent 55%), linear-gradient(#1a0b06, #0a0405)',
        scene: orbScene(['#1a0b06', '#0a0405'], ['rgba(255, 160, 60, ALPHA)', 'rgba(240, 80, 120, ALPHA)', 'rgba(255, 210, 120, ALPHA)'], 5, 0.34),
    },
    {
        id: 'embers',
        name: 'Embers',
        description: 'Rising sparks over a dark fire',
        poster: 'radial-gradient(ellipse at 50% 110%, #3a1a0a, #160a06 50%, #050303)',
        scene: embers,
    },
    {
        id: 'ocean',
        name: 'Ocean',
        description: 'Slow waves under a blue sky',
        poster: 'linear-gradient(#020a1c, #06203d 55%, #0a2c4c 70%, #020812)',
        scene: waves,
        retired: true,
    },
    {
        id: 'silk',
        name: 'Silk',
        description: 'Ribbons of colour flowing across the screen',
        poster: 'radial-gradient(ellipse 80% 18% at 45% 45%, rgba(120,70,230,.35), transparent 70%), radial-gradient(ellipse 70% 16% at 55% 62%, rgba(40,180,220,.3), transparent 70%), linear-gradient(135deg, #0a0620, #03020c)',
        scene: silk,
    },
    {
        id: 'light-rays',
        name: 'Light Rays',
        description: 'Beams of light from above',
        poster: 'radial-gradient(ellipse at 0% 0%, rgba(255,238,210,.3), transparent 50%), linear-gradient(135deg, #13234a, #070d22 60%, #03050d)',
        scene: rays,
    },
]

const byId = new Map(MOTION_BACKGROUNDS.map((m) => [m.id, m]))

/** The ones to offer when choosing a background. */
export const OFFERED_MOTION_BACKGROUNDS = MOTION_BACKGROUNDS.filter((m) => !m.retired)

export const MOTION_PREFIX = 'motion:'

/** The motion background a slide's `background` names, if it names one. */
export function motionBackgroundFor(background: string | null | undefined): MotionBackground | null {
    if (!background || !background.startsWith(MOTION_PREFIX)) return null
    return byId.get(background.slice(MOTION_PREFIX.length)) ?? null
}
