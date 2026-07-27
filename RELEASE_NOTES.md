## Selah 0.1.8

Two crashes fixed on Windows, a fully refreshed set of transcription models, and live transcription now works the moment you install.

### Windows
- Selah no longer crashes on launch on older processors. Anything from before roughly 2013 — and plenty of budget machines since — could fail to start at all, before the window ever appeared. If Selah wouldn't open on a machine in your booth, try this release.
- On Windows-on-ARM laptops, Selah now uses the processor for transcription instead of a graphics driver that misreports what it can do.

### Transcription models
- Every model has been replaced with a newer, faster and more accurate version, and there are new ones to choose from. They now download from a public, verified source, and Selah checks each download's fingerprint before using it, so a partial or corrupted file is caught rather than producing gibberish.
- The accuracy and speed bars in the model picker are now measured figures rather than estimates. Several models were previously rated well below or above what they actually deliver, so the comparison is worth a fresh look.
- The best English option is noticeably more accurate than anything previously available, and there is now a model trained for overlapping speakers — useful when the congregation responds while the preacher is still talking.
- New: a model that labels who was speaking, for reviewing a recording after the service.
- Models you had already downloaded keep working and stay selectable. They're marked "superseded" and sorted to the bottom, and new installs aren't offered them.

### Live transcription out of the box
- Selah now ships with a model that transcribes as the preacher speaks, so live text works on a fresh install with nothing to download first. Previously the bundled model couldn't do this, and text only appeared once each sentence finished.
- If the model you had selected is missing — deleted, or never downloaded on this machine — Selah falls back to the bundled one instead of refusing to start the session.

### Verse timing
- Detected verses now record when they were said, so a verse can be traced back to the moment it was cited in the recording. The timing data was being calculated and discarded before.

### Sermon listener
- Custom words no longer swallow the word that follows them. A name like "ChargeBee" spoken as "Charge B" could take the next word with it and drop it from the transcript.
- Words in languages that use letters outside plain English — Twi, or accented Spanish — are left as spoken instead of being "corrected" into an unrelated English word.

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
