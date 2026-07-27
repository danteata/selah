## Selah 0.1.7

This release is all about the sermon listener: the slide queue no longer fills up with repeats, and the verse the preacher actually announced now stays on screen instead of losing it to a similar-sounding verse elsewhere in Scripture.

### Slide queue
- One entry per passage instead of one per mention. A passage the preacher returns to reuses its slide rather than queueing a new copy each time.
- A passage read in stages ("Proverbs 24" … "three through four") ends up as a single slide covering the full range, not one slide per width.
- Switching Bible version rewrites the slide for that passage instead of adding a second copy of it.

### The verse on screen
- Announcing a passage before anything is on screen now displays it. Previously the very first "Psalm 27 verse 1" of a session put nothing on the output at all.
- Announced references appear in Detected Verses, so the list is a record of what was actually referenced.
- A reference announced a minute ago can no longer be picked up again as if it were new and take over the live output mid-reading.
- While you're reading an announced passage, a similar-sounding verse from elsewhere in Scripture stays in Detected Verses for you to choose instead of putting itself on screen. Scripture restates itself, and those matches are honestly earned but rarely what's being read.
- Reading straight through an announced chapter keeps following the reading verse by verse.

### Detection accuracy
- Reading an announced passage aloud now corroborates it rather than being discarded — the announcement itself counts as the reference signal.
- The first thing said in a session is no longer dropped, and detection no longer trails the speaker by an utterance.
