## Selah 0.1.22

Keep a recording of the service, so a transcript spoiled by a bad microphone can be redone properly afterwards.

### Sermon recordings, and second chances at a transcript

- **Selah can now keep the audio of each service.** Off until you turn it on, under Settings → Sermon Listener. A transcript can come out poor for reasons nobody notices at the time — the wrong microphone was selected, the band bled into the vocal feed, the model struggled with an accent — and text alone cannot be fixed afterwards. The audio can.
- **Re-transcribe a past service with a better model.** During a service Selah uses a model fast enough to keep up. Afterwards, when nobody is waiting, you can run the same recording through a slower and more accurate one and get a much better transcript. The old and new versions are shown together so you can decide which to keep.
- **Play, star, export or delete any recording** from Settings → Sermon Listener → Manage recordings. Starring means "never delete this automatically".
- **Recordings are cleaned up on a schedule you choose** — 30 days, 3 months, a year, the 10 most recent, or never. A service is roughly 90 MB, so a year of Sundays runs to several gigabytes; the default keeps 3 months. Starred recordings are always kept.
- **A recording survives Selah closing unexpectedly.** Audio files store their own length, and that length is only written when a recording finishes normally. A service interrupted by a crash or a force-quit would previously produce a file every player treated as empty, even though the audio was all there. Selah now repairs those automatically.

**Before you turn this on:** this records everyone the microphone can hear, for the whole service — prayer, testimonies, conversation near the desk. The audio stays on that computer and is never uploaded, and deleting a recording deletes the file immediately. Please make sure your church is comfortable being recorded before switching it on.

### The microphone list now tells the truth

- **If your chosen microphone is unplugged mid-service, Selah says so.** It already switched to the default microphone and carried on, but Settings went on displaying the device that had gone — so anyone checking during a service was told the sound desk feed was live when the laptop's own microphone was actually recording. Selah now clears the stale selection and tells you which device disappeared.
- This only happens when Selah can confirm the device is genuinely gone. A brief audio-system glitch no longer risks discarding a microphone choice you made deliberately.

### Smaller things

- **The `fn` (Globe) key can no longer be silently ignored when setting a shortcut.** Most keyboards never send it to the computer at all, so a shortcut using it would work on one Mac and nowhere else. Selah now explains that instead of appearing to ignore the keypress.
- **Guidance on Bluetooth headset microphones** has been added to the Sermon Listener documentation: on macOS, recording through one degrades whatever is playing through the same headset. It reads like a Selah fault and is not.

### Worth knowing

- **Sermon recording is new and has not been used in a real service.** It is off by default and covered by automated tests rather than a Sunday. Try it on a weekday before relying on it for something you cannot repeat.
- **The microphone change applies whether or not you use recording.** If your saved microphone is ever cleared when you did not expect it, that is this feature — please say so.
