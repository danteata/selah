## Selah 0.1.17

Lyrics now go up before the congregation reaches them, and the motion background moves with the music instead of trailing it.

### Lyrics arrive ahead of the singers
- **The next lines are on screen before the congregation gets to them.** Selah now follows the live, partial transcript — the text that appears while someone is still singing, a second or two before the finished version — and learns how long a line takes, so it can put the next section up on time instead of waiting to hear the last line of the current one.
- This is the case that used to fail: a two-line chorus went by faster than the transcript could describe it, so the projector was always a beat behind. Selah now leads immediately when the transcript is already later than the section has left to run.
- **A repeated chorus is no longer mistaken for the first one.** If your arrangement is Verse 1, Chorus, Verse 2, Chorus, clicking the chorus during the *second* one used to send the tracker back to the first — and from there it advanced to Verse 2 instead of what actually follows. The operator's position chips highlighted both choruses at once for the same reason.
- **A song imported mid-service can now be detected.** The search index was built once when the session started, so anything added afterwards stayed invisible to auto-detect until you restarted.

### The motion background keeps time
- **The pulse lands on the beat instead of just after it.** Selah now measures how long audio takes to reach the screen and, once it has locked onto a steady tempo, fires the pulse that much early. The punch is instant and only the fade is smoothed; before, the rise was smoothed too, which put every hit about a tenth of a second late.
- Beat detection was watching the wrong thing. What it treated as "bass" covered everything below 3.6 kHz — most of the vocal range — so it followed general loudness rather than the kick. The bands are now real frequency ranges, which also gives the drifting particles something to sparkle to.
- On Windows and Linux two thirds of the audio was never examined, so which beats registered came down to timing luck, and a gap in audio delivery could invent beats that weren't in the music. Both are fixed, and the visuals now behave the same on every platform.
- On a 120 Hz screen the text's nudge cancelled itself out, so it always leaned the same way.

### Editing a song no longer puts it on the projector
- **Pressing Enter in a song's lyrics starts a new line.** Opening a song from the search results and pressing Enter used to send that song straight to the live output and swallow the newline — the search results' keyboard shortcut was catching keys typed into the editor on top of them. The arrow keys had the same problem, moving the highlighted result instead of the cursor.

### Templates
- **"Applies to" does what it says.** Setting a template to Sermon or Prayer quietly saved it as applying to *every* slide type, so the narrowest choice became the widest. Neither was ever a slide type, so both are gone from that list along with Announcements, and Definitions — which was missing — has been added.
- **You can filter templates by the slide type they work with.** The Templates panel only had a category filter, so a template you had scoped to Songs couldn't be found that way, and the Prayer *category* looked like it should have done the job. Both filters now work and combine, and a template set to "Any Type" appears under every one of them.
- Default Templates in Settings now lists only the slide types it actually applies to. Sermon, Announcements, Prayer and Countdown were accepting a choice and ignoring it; Definitions was honoured but had no setting. "Scripture" is now "Bible Verses", matching the rest of the app.
- Category colours agree with themselves — Sermon showed amber while you picked it and orange once saved.
