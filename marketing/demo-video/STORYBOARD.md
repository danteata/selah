---
format: 1920x1080
duration: 90s
message: "Selah runs a church's screens for the whole service: lyrics, the verse the pastor just said, countdowns and announcements, from one laptop, even without internet."
arc: Demo Loop (question → product intro → demo cycles through one service → trust → CTA)
audience: "Pastors, church media volunteers and worship leaders who have never seen Selah"
mode: collaborative
sketches: skipped (user away; the plan is reviewed on the built draft)
music: none
---

## Video direction

- palette: ground is `cream` (#08090C, near-black) on every frame; `ink` (#FFFFFF) for statements; `green` (#14B8A6) and `green-lite` (#5EEAD4) for emphasis, live states and the one key word per statement; `pink` (#FCD34D, gold) is scarce voltage, used only for the recognised reference in frame 5 and the CTA's one word; `cream-2` (#12151B) for device frames and card surfaces. The mint-to-gold gradient from the landing hero (#5EEAD4 to #FCD34D) appears only twice: the word "verse" in frame 6 and the CTA line.
- type: display ramp (Crimson Pro 600, sentence case) for every statement; body (DM Sans) for secondary lines and tile labels; label (JetBrains Mono, tracked uppercase) for small chrome such as "LIVE", times and step markers. No em dashes on screen.
- product screens: real captures only, never rebuilt. Studio shots sit in a rounded `cream-2` device frame with a hairline border and a soft shadow; projector shots are shown full-bleed or as a 16:9 "screen in the room" panel. Crop studio shots so the top-right account avatar is never visible.
- motion grammar: long-tail settles (power3; expo on fast arrivals), no bounce anywhere. Silent film, so every reveal is paced to the on-screen words: a statement's second line arrives only after the first has been read (about 1.2 to 1.6 s per line). Nothing is on screen at t=0 that the viewer has not been cued to read. Product frames develop: the device eases in, then a zoom-to-target lands on the one region the statement names.
- rhythm: frames 1, 7 and 9 are type-only breathers; frame 6 is the deliberate held climax (verse lands, then stillness); frame 5 is the longest and busiest. Frame 10 ends on a held lockup.
- negative list: no bokeh, no purple-blue "AI" gradients beyond the user's own nebula inside real screens, no floating decorative shapes, no cursor, no browser chrome, no lazy breathing, no slow drift in the back half of a frame. Neither failure mode: no front-loaded-then-frozen slides, no screensaver of independently floating parts.
- captions: none (silent). Keep all content in the top 83% anyway.


## Frame 1 — Sunday, 9:55

- scene: Type alone on near-black. The clock, the stakes, the one volunteer.
- voiceover: ""
- onscreen: "Sunday, 9:55." / "Songs. Scripture. Notices." / "One volunteer at the laptop."
- duration: 6s
- transition_in: cut
- status: animated
- src: compositions/frames/01-sunday.html
- type: hook
- persuasion: Pain validation (the Sunday-morning scramble every media volunteer knows)
- beat: tension
- blueprint: kinetic-type-beats
- asset_candidates:

- blueprint: kinetic-type-beats (Reproduce)
- focal:
- roles:
- sfx:

Scene 1 (0.0–1.6s): "Sunday, 9:55." alone, dead-center in the display ramp, `ink` on `cream`; the time "9:55" in `green`. Per-word staggered reveal → dynamic-content-sequencing. Centered, ~45% width.
Scene 2 (1.6–3.6s): hard-cut word-swap → discrete-text-sequence: the line is replaced by "Songs. Scripture. Notices.", each word landing on its own beat, left to right.
Scene 3 (3.6–6.0s): hard-cut to "One volunteer at the laptop." in the display ramp, "One volunteer" in `green-lite`; settles and holds still. The tension of frame 1 is the held line.

narrativeRole: open inside the viewer's own Sunday, before any product.
keyMessage: this is your morning, and it is a lot for one person.

## Frame 2 — Selah runs the screens

- scene: The Selah studio, the whole service order loaded, eases in under the promise.
- voiceover: ""
- onscreen: "Selah runs the screens" / "for the whole service."
- duration: 7s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-intro.html
- type: product_intro
- persuasion: Friction reduction (one place instead of the scramble)
- beat: relief
- blueprint: device-surface-showcase
- asset_candidates: assets/studio-service-order.png — the Selah studio with Sunday's service order (countdown, two hymns) in the queue

- blueprint: device-surface-showcase (Adapt)
- focal: assets/studio-service-order.png
- roles: studio-service-order = cutout (device frame)
- sfx:

Adapt: keep the floating-window hero; one screen instead of a cycling flow.
Scene 1 (0.0–1.8s): the statement's first line "Selah runs the screens" in the display ramp, upper third, centered; the studio device frame rises from below the fold into the lower 60% on a long-tail settle → spring-pop-entrance (smooth register).
Scene 2 (1.8–4.2s): "for the whole service." arrives on the second line, "whole service" in `green`. The device reaches its resting position, ~70% of frame width, 3 depth layers (ground, soft shadow, device).
Scene 3 (4.2–7.0s): zoom-to-target → coordinate-target-zoom onto the slide queue column (countdown live, Amazing Grace expanded), the statement fading to 60% as the queue becomes the read; hold.

narrativeRole: name the product and land the promise by beat 2.
keyMessage: one app runs everything the congregation sees.

## Frame 3 — Starts on time

- scene: The projector shows "Service starts in" counting down; the operator's monitor shows the same clock with Pause.
- voiceover: ""
- onscreen: "Starts on time." / "Pause it here, it pauses there."
- duration: 8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-countdown.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: control
- blueprint: device-surface-showcase
- asset_candidates: assets/projector-countdown.png — the projector output showing the pre-service countdown; assets/studio-countdown-live.png — the studio with the countdown live and its Pause button

- blueprint: device-surface-showcase (Adapt)
- focal: assets/projector-countdown.png
- roles: projector-countdown = cutout (the room's screen) · studio-countdown-live = supporting (operator's view)
- sfx:

Adapt: two surfaces instead of a flow: the room's screen and the operator's screen, shown to agree.
Scene 1 (0.0–2.0s): projector-countdown fills a 16:9 panel at ~62% width, left-of-center, rule-of-thirds; label chrome "THE ROOM" above it in `green`. "Starts on time." in the display ramp to its right.
Scene 2 (2.0–5.0s): studio-countdown-live slides in as a smaller device frame lower-right, overlapping the panel's corner (layered depth), cropped to the Program Output monitor with its Pause button; label chrome "YOUR LAPTOP". Keyword glow → asr-keyword-glow on the Pause button region.
Scene 3 (5.0–8.0s): "Pause it here, it pauses there." arrives under the first line; both surfaces hold still.

narrativeRole: first moment of the service, first feature where it is used.
keyMessage: the operator and the room share one clock.

## Frame 4 — Worship

- scene: A hymn verse fills the projector; the queue shows the hymn's verses; the next verse is ready.
- voiceover: ""
- onscreen: "Every verse, a slide." / "Next is already waiting."
- duration: 10s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-worship.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation (verse slides → never scrambling mid-song)
- beat: ease
- blueprint: camera-journey
- asset_candidates: assets/studio-song-live.png — the studio with a hymn verse live, queue and Next Up visible; assets/projector-lyrics.png — the projector showing a hymn verse

- blueprint: camera-journey (Adapt)
- focal: assets/projector-lyrics.png
- roles: projector-lyrics = background (full-bleed, dim ~35% during Scene 1) · studio-song-live = cutout (device frame)
- sfx:

Adapt: sub-shape (A) action roundtrip across the two real surfaces; the "action" is the verse going live.
Scene 1 (0.0–3.0s): projector-lyrics full-bleed, dimmed; "Every verse, a slide." in the display ramp, upper third.
Scene 2 (3.0–6.5s): the lyrics undim to full as the line clears; the camera travels (viewport-change) down-right into studio-song-live in a device frame, landing on the queue's verse cards (Amazing Grace verse 1 LIVE, verse 2 below).
Scene 3 (6.5–10.0s): zoom-to-target onto the Next Up monitor showing verse 2; "Next is already waiting." arrives in the upper third; hold.

narrativeRole: the longest stretch of any service, handled without effort.
keyMessage: songs are ready before they are needed.

## Frame 5 — The pastor says it

- scene: The pastor's words type out as a live transcript, word by word; "John chapter three, verse sixteen" lights up the moment Selah recognises it; the studio's Sermon Listener shows the same line.
- voiceover: ""
- onscreen: transcript "Open your Bibles with me to John chapter three, verse sixteen." / "Caught it the moment he said it."
- duration: 14s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/05-live-words.html
- type: feature_showcase
- persuasion: Show-don't-tell proof (the signature moment, played in real time)
- beat: curiosity → awe
- blueprint: typewriter-reveal
- asset_candidates: assets/studio-listener-detect.png — the Sermon Listener with the transcript and "John 3:16" detected and sent live

- blueprint: typewriter-reveal (Adapt)
- focal: mk-callout-highlight (registry component, customised: the transcript line, emphasis driven by the typing frontier)
- roles: studio-listener-detect = supporting (arrives in Scene 3)
- sfx:

Adapt: keep the live caret typing a line as a human would; instead of collapsing into a brand payoff, the recognised reference lights up and the product proves it caught it.
Scene 1 (0.0–1.0s): label chrome "SERMON LISTENER · LISTENING" top-left in `green` with a small live dot; empty stage.
Scene 2 (1.0–7.5s): the transcript types word by word behind a caret at speaking pace, in the display ramp, left-aligned, top two-thirds: "Good morning church. Open your Bibles with me to John chapter three, verse sixteen." → discrete-text-sequence + context-sensitive-cursor. Words already spoken sit in `ink` at 70%; the frontier word is full `ink`.
Scene 3 (7.5–10.0s): the moment "sixteen" lands, "John chapter three, verse sixteen" glows and turns `pink` (gold) → asr-keyword-glow, and a label chip "JOHN 3:16 · DETECTED" pops beside it (smooth settle). The rest of the line dims to 40%.
Scene 4 (10.0–14.0s): studio-listener-detect rises in a device frame from the lower edge, zoom-to-target onto the Sermon Listener panel and the John 3:16 card marked LIVE; "Caught it the moment he said it." in the body ramp above it; hold.

narrativeRole: the product's signature, the reason to watch.
keyMessage: Selah hears the reference as it is spoken.

## Frame 6 — On the screen already

- scene: John 3:16 fills the projector, reference beneath it.
- voiceover: ""
- onscreen: "On the screen" / "before he has turned the page."
- duration: 8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-verse.html
- type: benefit_highlight
- persuasion: Negative contrast (no typing, no searching, no delay)
- beat: awe + relief
- blueprint: kinetic-type-beats
- asset_candidates: assets/projector-john-3-16.png — the projector showing John 3:16 with its reference

- blueprint: kinetic-type-beats (Adapt)
- focal: assets/projector-john-3-16.png
- roles: projector-john-3-16 = cutout (full-bleed hero)
- sfx:

Adapt: the statement builds over a real screen instead of a flat ground; keep the full-screen beats onto a payoff.
Scene 1 (0.0–2.5s): projector-john-3-16 arrives full-bleed with an inverse zoom-through (arriving at) from frame 5's gold reference; it is the room's view.
Scene 2 (2.5–5.0s): the screen settles into a 16:9 panel at ~72% width, centered, as "On the screen" types in above it in the display ramp.
Scene 3 (5.0–8.0s): "before he has turned the page." completes the line, "turned the page" in the mint-to-gold gradient; everything holds still: the climax breather.

narrativeRole: pay off frame 5 on the screen the congregation sees.
keyMessage: the verse is up before anyone waits for it.

## Frame 7 — No internet, no problem

- scene: Type only. The desktop app keeps working when the church Wi-Fi does not.
- voiceover: ""
- onscreen: "Church Wi-Fi down?" / "The desktop app keeps going."
- duration: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-offline.html
- type: benefit_highlight
- persuasion: Risk reversal
- beat: peace of mind
- blueprint: kinetic-type-beats
- asset_candidates:

- blueprint: kinetic-type-beats (Reproduce)
- focal:
- roles:
- sfx:

Scene 1 (0.0–2.4s): "Church Wi-Fi down?" dead-center, display ramp; a small Wi-Fi glyph above it draws on and then its arcs go out one by one → svg-path-draw.
Scene 2 (2.4–6.0s): hard-cut word-swap to "The desktop app keeps going." with "keeps going" in `green`; the Wi-Fi glyph is gone. Holds.

narrativeRole: remove the fear that stops churches trusting software on a Sunday.
keyMessage: it works offline on the desktop app.

## Frame 8 — A second pair of hands

- scene: A live session starts in the studio; a second volunteer follows along and helps from a phone.
- voiceover: ""
- onscreen: "Bring the team in." / "Help from a phone, live."
- duration: 10s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/08-team.html
- type: feature_showcase
- persuasion: Belonging (the volunteer is no longer alone)
- beat: belonging
- blueprint: device-surface-showcase
- asset_candidates: assets/studio-live-session.png — the studio with a live session running; assets/phone-studio.png — the phone view of the same service

- blueprint: device-surface-showcase (Adapt)
- focal: assets/phone-studio.png
- roles: phone-studio = cutout (phone frame) · studio-live-session = supporting (device frame behind)
- sfx:

Adapt: laptop and phone together instead of one device cycling.
Scene 1 (0.0–3.0s): studio-live-session in a device frame, left 60%, cropped to the top bar's SESSION, Operator and End controls and the Program Output; "Bring the team in." in the display ramp, upper right.
Scene 2 (3.0–6.5s): phone-studio slides up into a phone frame on the right, overlapping the laptop's edge (layered depth), showing the same countdown live; keyword glow on the phone's session bar.
Scene 3 (6.5–10.0s): "Help from a phone, live." arrives under the first line; hold.

narrativeRole: close the loop opened in frame 1 (one volunteer) with a team.
keyMessage: several people can run one service together.

## Frame 9 — Everything the room sees

- scene: The features assemble as a grid of labelled tiles.
- voiceover: ""
- onscreen: "Songs and hymns" · "Bible on screen" · "Countdowns" · "Live announcements" · "Media and video" · "Projector output"
- duration: 8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-everything.html
- type: benefit_highlight
- persuasion: Value stacking
- beat: confidence
- blueprint: grid-card-assemble
- asset_candidates:

- blueprint: grid-card-assemble (Reproduce)
- focal:
- roles:
- sfx:

Scene 1 (0.0–1.5s): "Everything the room sees." in the display ramp, upper third, centered.
Scene 2 (1.5–5.5s): six tiles self-assemble in a staggered cascade into a 3×2 grid below it, `cream-2` surfaces with hairline borders, each a label in the body ramp with a small line icon: Songs and hymns · Bible on screen · Countdowns · Live announcements · Media and video · Projector output.
Scene 3 (5.5–8.0s): the grid holds; the "Bible on screen" tile carries a thin `green` border as the one emphasis.

narrativeRole: widen from one service to everything Selah covers, using the landing page's own feature names.
keyMessage: one app for the whole service.

## Frame 10 — Get your church started

- scene: The Selah wordmark resolves; the trial offer from the landing page under it.
- voiceover: ""
- onscreen: "Selah" / "Preach the sermon. Selah finds the verse." / "Get your church started" · "14-day free trial · No credit card"
- duration: 7s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/10-cta.html
- type: cta
- persuasion: Risk reversal (free trial, no card)
- beat: motivation
- blueprint: logo-assemble-lockup
- asset_candidates: assets/logo-5fe61dd0.svg — the Selah mark, the open-book icon the landing page pairs with the Crimson Pro "Selah" wordmark

- blueprint: logo-assemble-lockup (Adapt)
- focal: assets/logo-5fe61dd0.svg
- roles: logo-5fe61dd0 = cutout (the mark)
- sfx:

Adapt: the open-book mark draws itself on (SVG self-draw) inside the landing page's teal rounded tile, then the Crimson Pro wordmark "Selah" settles beside it.
Scene 1 (0.0–2.5s): the mark draws on → svg-path-draw, the tile fills `green`, "Selah" settles to its right; centered lockup.
Scene 2 (2.5–4.5s): "Preach the sermon. Selah finds the verse." below in the display ramp, "finds the verse" in the mint-to-gold gradient.
Scene 3 (4.5–7.0s): "Get your church started" in a `green` pill, and "14-day free trial · No credit card" in label chrome under it; hold to the end. This is the video's only real exit.

narrativeRole: tell the viewer the one next step.
keyMessage: try it free this week.
