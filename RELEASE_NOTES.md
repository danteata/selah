## Selah 0.1.21

Speak instead of typing — and voice search now works with no internet at all.

### Dictation: hold a key, speak, and the words appear where you were typing

- **New in Settings → Shortcuts.** Turn on Dictation, pick a hotkey, and hold it while you speak. When you let go, the text lands in whatever Selah box the cursor was in — the announcement you are writing onto a slide, sermon notes, a search field. It is off until you turn it on.
- **Nothing leaves your computer.** It runs on the same offline transcription Selah already installs for the Sermon Listener, so there is no account to create, no subscription, and no audio sent anywhere. It works with the internet unplugged.
- **Hold-to-talk or toggle.** Hold-to-talk records only while the key is down, which is the safer one mid-service — the microphone cannot be left open by accident. Toggle starts on one press and stops on the next, which suits longer stretches of dictation.
- **A small indicator shows it is listening**, with a level meter so you can see your voice registering. It sits at the bottom of whichever screen Selah is on and ignores clicks, so it will not get in the way of anything behind it.
- **If the hotkey you choose is already taken** by another program, Selah says so and names the reason rather than silently doing nothing.
- Dictation and the Sermon Listener share one microphone and one transcription model, so dictation is unavailable while the Listener is running, and says so.

### Voice search works offline

- **The microphone button in Bible, Songs, Library and Dictionary searches now uses Selah's own offline transcription** on the desktop app, instead of the browser's speech service. Previously that button needed a working internet connection, needed Chrome or Safari specifically, and on Mac and Windows needed a second system permission separate from the microphone — a lot of ways for it to simply not work, in a building where the Wi-Fi is often the least reliable thing present.
- **If the Sermon Listener is running**, voice search falls back to the old browser method automatically, because both cannot use the microphone at once. It keeps working either way.
- **Spoken punctuation is trimmed.** Saying a reference now searches for `John 3:16` rather than `John 3:16.`, which previously failed to match.

### Signing in no longer breaks an account's free trial

- **A sign-in fault that could quietly cost an account its 14-day trial has been fixed.** An old bug could leave a single person recorded twice, after which the trial was never started for them and nothing said why — the app looked like it had signed in normally. Affected accounts now repair themselves the next time they sign in, and the code that starts the trial no longer gives up when it finds a duplicate.

### Worth knowing

- **Dictation has not yet been used in a real service.** It is new, it is off by default, and it has been checked by automated tests rather than by a Sunday. If you plan to rely on it, try it on a weekday first.
- **The voice search change applies as soon as you update**, without you turning anything on. If it behaves worse than before for you, please say so — the previous browser-based method is still there and can be made the default again.
- Downloading a smaller, faster transcription model for dictation is optional and lives under Settings → Sermon Listener. Dictation uses whatever the Sermon Listener uses unless you pick something else.
