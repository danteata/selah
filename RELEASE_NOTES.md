## Selah 0.1.23

What you see on the operator's screen is now what the room sees, and a lot of small ways to lose work or get the wrong thing on the projector are gone.

0.1.22 never reached you: its desktop build failed. Everything it contained, including sermon recordings, is in this release too and is described at the end.

### The projector and your preview finally agree

- **The Program Output monitor, Next Up and the phone view now draw slides exactly the way the projector does.** They used to have their own copies of the layout, and the copies had drifted. The monitor left out a countdown's title and "Time's up", ignored window padding and the song title, and drew verse references at about a third of their real size. The phone preview showed no text at all over a video background. It is one drawing now, scaled to fit.
- **The monitor shows "Clear" the way the room sees it:** the background stays and the text goes.
- **A countdown keeps one clock.** The operator and the projector used to count separately and drift apart, and reopening the output window started the countdown again from the full time. Pause and Resume now live on the operator's monitor and pause both screens together.
- **Motion backgrounds no longer restart, or flash black, on each slide of a song.**
- **Pausing or muting a YouTube or Vimeo video no longer restarts it,** and Restart works every time, not just the first.
- **If a video can't play, the operator is told** instead of the projector quietly showing nothing.

### Live sessions with several operators

- **Changes from one operator no longer delete another's slides.** A slide was deleted whenever an operator's copy of the schedule simply didn't have it yet.
- **Edits made while offline are sent once you're back online,** instead of being quietly dropped.
- **A brief network drop no longer reloads the whole studio** and closes whatever you had open.
- **When a save fails, Selah says so.**

### Sermon Listener

- **The listener no longer switches itself off during a long service.** It also recovers when the speech engine or the verse matcher stalls, rather than sitting silently.
- **"Read it from the NKJV" and similar spoken requests** now catch more ways of saying a version's name.
- **Spoken text is no longer written to the app's logs.**

### Less lost work

- **Modals and editors no longer close when a drag ends outside them,** such as selecting lyrics and letting go over the backdrop.
- **Every dialog now works from the keyboard.** Tab stays inside, Escape closes only the dialog on top, and focus goes back where it was.
- **Deleting and resetting ask with Selah's own dialog** instead of the browser's pop-up.
- **Shortcuts no longer fire twice, or while you're typing.**

### Smaller things

- **Settings fits a small or short window.** "More Versions" in the version picker opens it straight on the Bible page.
- **The Lines Per Slide setting shows its saved value.** It always showed 4.
- **Long song and hymn libraries scroll and filter faster.**
- **Password managers can fill in the sign-in and sign-up forms.**
- **The studio loads faster.**

### Billing

- **A payment notification that arrives twice is applied once.** Discounted plans switch to full price on time, and a late "payment failed" can't undo a newer success.
- **The page you land on after checkout says what actually happened.** It used to say "Payment received" even after a declined card.

### Worth knowing

- **This release changes a lot of how slides are drawn.** On a 1920-pixel-wide projector they should look exactly as before. On other screen sizes, padding and margins now scale with the screen instead of staying the same number of pixels. If anything on your projector looks different, please say so.
- **Your team's permissions are checked more strictly.** Someone who could see or change another church's schedules because of an old gap no longer can. If a team member loses access to something they should have, please tell us.

### Also in this release: everything from 0.1.22

Keep a recording of the service, so a transcript spoiled by a bad microphone can be redone properly afterwards.

#### Sermon recordings, and second chances at a transcript

- **Selah can now keep the audio of each service.** Off until you turn it on, under Settings → Sermon Listener. A transcript can come out poor for reasons nobody notices at the time — the wrong microphone was selected, the band bled into the vocal feed, the model struggled with an accent — and text alone cannot be fixed afterwards. The audio can.
- **Re-transcribe a past service with a better model.** During a service Selah uses a model fast enough to keep up. Afterwards, when nobody is waiting, you can run the same recording through a slower and more accurate one and get a much better transcript. The old and new versions are shown together so you can decide which to keep.
- **Play, star, export or delete any recording** from Settings → Sermon Listener → Manage recordings. Starring means "never delete this automatically".
- **Recordings are cleaned up on a schedule you choose** — 30 days, 3 months, a year, the 10 most recent, or never. A service is roughly 90 MB, so a year of Sundays runs to several gigabytes; the default keeps 3 months. Starred recordings are always kept.
- **A recording survives Selah closing unexpectedly.** Audio files store their own length, and that length is only written when a recording finishes normally. A service interrupted by a crash or a force-quit would previously produce a file every player treated as empty, even though the audio was all there. Selah now repairs those automatically.

**Before you turn this on:** this records everyone the microphone can hear, for the whole service — prayer, testimonies, conversation near the desk. The audio stays on that computer and is never uploaded, and deleting a recording deletes the file immediately. Please make sure your church is comfortable being recorded before switching it on.

#### The microphone list now tells the truth

- **If your chosen microphone is unplugged mid-service, Selah says so.** It already switched to the default microphone and carried on, but Settings went on displaying the device that had gone — so anyone checking during a service was told the sound desk feed was live when the laptop's own microphone was actually recording. Selah now clears the stale selection and tells you which device disappeared.
- This only happens when Selah can confirm the device is genuinely gone. A brief audio-system glitch no longer risks discarding a microphone choice you made deliberately.

#### Smaller things

- **The `fn` (Globe) key can no longer be silently ignored when setting a shortcut.** Most keyboards never send it to the computer at all, so a shortcut using it would work on one Mac and nowhere else. Selah now explains that instead of appearing to ignore the keypress.
- **Guidance on Bluetooth headset microphones** has been added to the Sermon Listener documentation: on macOS, recording through one degrades whatever is playing through the same headset. It reads like a Selah fault and is not.

#### Worth knowing

- **Sermon recording is new and has not been used in a real service.** It is off by default and covered by automated tests rather than a Sunday. Try it on a weekday before relying on it for something you cannot repeat.
- **The microphone change applies whether or not you use recording.** If your saved microphone is ever cleared when you did not expect it, that is this feature — please say so.
