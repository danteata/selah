## Selah 0.1.42

The sermon listener keeps going on slower computers, the main NDI output shows the slide again, and phones work properly as remote controls: on their side, as contributors and when signing in on a new device. Built-in templates are now all motion backgrounds, and the desk now announces itself on the Wi-Fi for the new Android app (preview).

### Sermon listener

- **No more silent sermons on slower computers.** On a computer transcribing on its processor, a live stream that couldn't keep up held the model, so nothing at all was transcribed and the listener stopped with "The live stream has held the transcription model". A stream that falls behind is now dropped within a second or two of speech, and that model then transcribes each sentence in one pass on this computer, remembered across restarts.
- **One dropped sentence no longer stops listening.** If the model is briefly busy, that sentence is skipped and the listener carries on. Only if it keeps happening does it stop, with a suggestion to choose a smaller model.
- **Tip:** on a computer without a separate graphics card, **Parakeet Tiny (English)** (Settings → Sermon Listener) is the fastest choice.

### NDI

- **The main NDI output shows the slide again.** Receivers that respect transparency showed it as a dark, empty picture, while the alternate output was fine. It's now sent as a solid picture.

### Selah on a phone

- **Turn your phone sideways.** The live slide fills the left of the screen, with what's next and the controls on the right. Before, a phone on its side got the desk layout, squeezed into a few centimetres with nothing able to scroll.
- **A Live tab.** The first tab is now **Live**, with a red dot while something's on the screen. Putting a verse or song up from Bible or Music brings you back to it.
- **Songs a helper puts up reach everyone.** A contributor's song used to send only its first slide to the session; the rest stayed on their phone. Now the whole song joins the operator's deck, so every section can be stepped through, on every device and after a reload.
- **No "no session" flash on opening.** The phone shows "Joining the service…" until it has the session, instead of "Idle, start a session, nothing queued" and then jumping.
- **Clearer and quieter:** "Verse 1 · 2 of 5" sits beside LIVE where it fits; no "Live slide updated" pop-up at every change; Add isn't offered for slides already on the deck; the Bible list marks the verse that is actually on the screen as LIVE; and the trial banner is for admins only.

### Android app (preview)

- **Selah as an Android app.** The same Selah you use in a phone's browser, as an app. For now it's installed by hand from a file; it isn't in the Play Store yet.
- **It finds the desk on the Wi-Fi.** The desk app now announces itself on the local network for your church, and the Android app lists it under **More → On this Wi-Fi**. This is the first step towards phones talking to the desk directly, without going through the internet. Church guest networks that keep devices apart will show nothing, and everything carries on as before.
- **Voice search works in the app**, using Android's own speech recognition.

### Signing in

- **Signing in on a new phone or computer works.** When a code was needed to confirm a new device, the sign-in page did nothing at all. It now asks for the emailed code. "Resend" on sign-up sends a new code too.

### Live sessions

- **Change who can drive the screen mid-service.** The operator can switch the session between Strict, Review and Open from the session badge, on the desk or a phone.
- **The service order opens itself.** A computer with no schedule chosen opens the running session's, and a new schedule opens as soon as it's created.

### Templates and media

- **Motion backgrounds for everything built in.** The stock-photo templates are gone (one photo had been removed from its site and showed as broken), new slides and new templates start on a motion background, and saved defaults that were still the old photos move to motion. Backgrounds you chose stay.
- **Templates and Media open faster.** Cards animate or play only when you hover over or pick them, and media files are read once rather than every time the panel opens.
- **Media that won't play says why:** the file is on another computer, or this computer can't play its format.
- A template card with several defaults no longer covers its own name.
