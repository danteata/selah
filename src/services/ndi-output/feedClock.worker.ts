/// <reference lib="webworker" />
/**
 * The canvas feed's frame clock. Timers in a hidden or minimised window are
 * throttled to about one a second (and requestAnimationFrame stops), which
 * would freeze a motion background on the NDI feed the moment the operator
 * minimises Selah. A dedicated worker's timers aren't, so the ticks come from
 * here and the window only draws when told.
 *
 * Message in: `{ fps }` to start (or change rate), `{ fps: 0 }` to stop.
 * Message out: a tick, with the worker's timestamp.
 */

let timer: ReturnType<typeof setInterval> | null = null

self.onmessage = (event: MessageEvent<{ fps: number }>) => {
    if (timer !== null) clearInterval(timer)
    timer = null
    const fps = event.data?.fps ?? 0
    if (fps > 0) timer = setInterval(() => self.postMessage(performance.now()), 1000 / fps)
}
