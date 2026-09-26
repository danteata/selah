## Selah 0.1.23

What you see on the operator's screen is now what the room sees, and a lot of small ways to lose work or get the wrong thing on the projector are gone.

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
