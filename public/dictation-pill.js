/*
 * Dictation pill behaviour.
 *
 * An external file rather than an inline <script>: the app CSP allows
 * `script-src 'self'` with no `'unsafe-inline'`, so an inline block would need
 * a nonce this static page has no way to obtain.
 *
 * Two event streams, both already broadcast by the app:
 *
 *   dictation://state  — emitted by `useDictation` when the session changes.
 *   audio-features     — the capture loop's throttled feature frames, the same
 *                        ones the visualiser and the level meter use. Reused
 *                        rather than plumbed: the pill needs a level, and one
 *                        is already going past.
 */
(function () {
    'use strict'

    var BAR_COUNT = 5
    /** Height in px at rest and at full level. */
    var BAR_MIN = 4
    var BAR_MAX = 18

    /**
     * Fraction of the gap to the target closed per frame. Speech RMS is spiky;
     * following it exactly reads as a flicker rather than a level. Rising is
     * quicker than falling so the meter feels responsive to a syllable but does
     * not slam shut between words.
     */
    var ATTACK = 0.5
    var RELEASE = 0.12

    /**
     * Frames stop arriving when capture stops, and the last one is rarely zero.
     * Without a decay the meter freezes mid-level and reads as "still
     * listening" after the microphone has gone.
     */
    var STALL_MS = 400

    var meter = document.getElementById('meter')
    var label = document.getElementById('label')
    var bars = []

    for (var i = 0; i < BAR_COUNT; i++) {
        var bar = document.createElement('span')
        bar.className = 'bar'
        meter.appendChild(bar)
        bars.push(bar)
    }

    var target = 0
    var current = 0
    var lastFrameAt = 0

    /**
     * RMS for speech sits low in 0..1 — a normal voice rarely passes ~0.2 — so
     * a linear mapping leaves the meter nearly flat. The square root opens up
     * the bottom of the range, which is the part that actually varies.
     */
    function levelFromRms(rms) {
        if (typeof rms !== 'number' || !isFinite(rms) || rms <= 0) return 0
        return Math.min(1, Math.sqrt(rms) * 2.2)
    }

    function render() {
        if (lastFrameAt && Date.now() - lastFrameAt > STALL_MS) target = 0

        var rate = target > current ? ATTACK : RELEASE
        current += (target - current) * rate
        if (current < 0.002) current = 0

        for (var i = 0; i < BAR_COUNT; i++) {
            // Middle bars react to a lower level than the outer ones, which is
            // what makes it look like a meter rather than five copies of the
            // same bar.
            var weight = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / BAR_COUNT
            var scaled = Math.min(1, current * (0.55 + weight))
            bars[i].style.height = (BAR_MIN + (BAR_MAX - BAR_MIN) * scaled).toFixed(1) + 'px'
            if (scaled > 0.08) bars[i].classList.add('lit')
            else bars[i].classList.remove('lit')
        }

        requestAnimationFrame(render)
    }

    requestAnimationFrame(render)

    function setState(state) {
        if (state !== 'listening' && state !== 'transcribing') return
        document.body.setAttribute('data-state', state)
        label.textContent = state === 'transcribing' ? 'Transcribing…' : 'Listening…'
        if (state === 'transcribing') {
            target = 0
            current = 0
        }
    }

    /**
     * `withGlobalTauri` puts the API on `window.__TAURI__`, but the page can
     * parse before the injection lands. Poll briefly rather than failing
     * silently — a pill with no subscriptions still shows, it just never
     * updates, which is the confusing kind of broken.
     */
    function whenTauriReady(callback) {
        var attempts = 0
        ;(function poll() {
            var api = window.__TAURI__
            if (api && api.event && typeof api.event.listen === 'function') {
                callback(api)
                return
            }
            if (++attempts > 50) {
                console.warn('[dictation-pill] Tauri event API never arrived; the pill is static')
                return
            }
            setTimeout(poll, 40)
        })()
    }

    whenTauriReady(function (api) {
        api.event.listen('dictation://state', function (event) {
            if (event && event.payload) setState(event.payload.state)
        })

        api.event.listen('audio-features', function (event) {
            var payload = event && event.payload
            if (!payload) return
            // A keep-alive frame carries no real level; treating its zero as a
            // reading makes the meter drop out on every upstream hiccup.
            if (payload.silent === true) return
            lastFrameAt = Date.now()
            target = levelFromRms(payload.rms)
        })
    })
})()
