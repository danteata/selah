## Selah 0.1.18

The transcript no longer goes quiet halfway through a worship set, and Selah now tells you when your microphone has stopped instead of showing you a silent room.

### The transcript survives the whole song
- **Selah keeps transcribing once the band fills out.** The speech detector was answering the question it was built to answer — *is this speech?* — and the back half of a worship song isn't. On one five-minute track it found phrases every few seconds until 2:37, then three times in the remaining two and a half minutes, and the transcript died with them while the level meter still showed strong signal. Audio that is plainly audible but that the detector won't call speech is now transcribed anyway after eight seconds. On a nine-minute recording this took coverage from 21% to 87% and removed every gap over eight seconds, including one that ran 133 seconds.
- **Phrases are no longer clipped into fragments too short to read.** A single breath between sung lines used to close a segment, and what was left came back empty a third of the time — that's where the stray "Hey." and "Really?" entries in transcripts came from. Segments are now cut on a longer silence, and windows overlap so a phrase straddling a boundary isn't split across two attempts and mangled in both. Distinct words recovered rose from 173 to 189 over the same audio.
- **The text Selah keeps is the text the model actually settled on.** When a transcription revises something it already said, the finished result was being assembled from a running draft that can only be added to — so a correction to an earlier word never made it through. Every finished segment could carry a stale opening, in sermons as well as songs.
- **A transcription that returns nothing no longer stops the transcript.** Nor does a segment getting attached to the wrong stream.

### Songs go up, and stay in step
- **Lyrics are matched by sound, not spelling.** "Hallelujah" heard as "hallelooya" now finds the song.
- **Selah follows a leader who jumps into the middle of a section.** It used to look only at the first line of each section when searching outside the expected range, on the assumption that an unplanned jump lands at the top of one. Worship doesn't oblige — leaders drop into the middle of a verse, double back, vamp. Worse than missing those jumps, with the real line invisible the closest remaining guess was sometimes an unrelated line that scraped over the threshold and went on screen. That's the flicker where a clearly-sung line sat in another slide and Selah wouldn't pick it up.
- **A returning chorus isn't dropped as a repeat**, and a song added to your library mid-service can now be detected — the search index used to be built once at the start of the session.
- **Songs stored as plain lyrics work properly.** They were being skipped by auto-detect entirely; now they're found, and they build one slide per verse instead of collapsing the whole song onto a single slide with nothing to advance through.
- **A single filler line can't identify a song on its own.**

### Scripture detection knows when you're singing
- **Selah stops hunting for verses in lyrics while it's following a song.** Worship lyrics are scripture-adjacent by design, so the verse matcher kept finding them — from sung lines alone during one song it surfaced Psalms 121:1, Isaiah 15:9 and Philippians 4:1. "I will look to the hills, from whence cometh my help" genuinely is an allusion to Psalm 121, which is exactly why it scored well and exactly why putting it on screen mid-song is wrong. The congregation is singing, not being read to. It was expensive, too: a nine-minute song ran a full search on every window and could exhaust the day's AI quota on audio guaranteed to contain no reading. When preaching starts, verse detection resumes on its own — there's no mode to remember to leave.

### Your sound desk's vocal feed
- **You can now pick a single input channel from a multi-channel interface.** If you're on a Focusrite, MOTU or similar, your desk can send an isolated vocal aux on one channel while the front-of-house mix sits on another — and Selah used to average every channel together, mixing the band straight back into the feed chosen to exclude it. There's now an "Input channel" dropdown in Sermon Listener settings, which appears only when the selected device has more than one input. Measured against the full mix on the same nine minutes, a vocal feed cut timer-forced segments from 46 to one and raised distinct words per unit of audio by 67%. If your desk can send one, it's the single biggest improvement available to you.

### Selah tells you when something has stopped
- **A microphone that drops mid-service now says so, and reconnects itself.** When an interface is unplugged, a Bluetooth mic drops, or a USB hub sleeps, the audio stream dies — and Selah used to carry on as though nothing had happened, reporting a healthy but permanently silent room for the rest of the service. It now notices, reconnects on its own with a few increasingly patient attempts, and shows you a banner throughout: that it's trying, that it worked, or that it has given up and needs your attention.
- **The projector output resizes itself when your displays change.** A projector that slept and woke, an HDMI cable reseated, or a resolution changed at the desk used to leave the output window laid out for a screen arrangement that no longer existed, with no fix short of closing and reopening it. Selah now watches for display changes and re-fits the output — following the same projector even if it comes back in a different position. If a display disappears entirely, the window is left alone rather than being relocated onto your laptop where the congregation can't see it.
- **One panel failing no longer takes the page down with it.** A fault in the sermon listener used to blank the whole Dashboard, or the whole live output. It's now contained to the panel, and on the projector it disappears quietly rather than showing the congregation an error.
- **The settings panel opens without a stutter.** Listing audio devices was blocking the interface while it queried each one.

### Model downloads
- **A stalled download no longer hangs forever.** With no timeouts anywhere, a dropped connection or a captive portal left the progress bar frozen at some percentage with no error and no way forward. Downloads now notice when they've stopped and retry up to four times, resuming from where they left off rather than starting a several-hundred-megabyte file again. Cancelling takes effect immediately.

### Under the hood
- **Memory no longer creeps up across a long service on Linux.** Every phrase transcribed allocated buffers the system never took back, so a ninety-minute service slowly accumulated hundreds of megabytes it would never touch again.
- Selah recovers from an internal speech-detector fault instead of going deaf for the rest of the session.
