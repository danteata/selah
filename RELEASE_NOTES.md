## Selah 0.1.12

NDI output actually works in the installed app, the desktop app searches scripture by meaning without a connection, and the update prompt notices a release published while you're running.

### NDI output
- Sending your program feed to vMix, OBS or a switcher over NDI works in the release build. The feature was compiled out of every installer, so the option appeared in Live Output but nothing was ever sent.
- The NDI runtime is now loaded when you turn the output on rather than required at launch. Selah starts normally on machines that don't have NDI, and finds it as soon as it is installed — no reinstall of Selah needed.
- When the runtime genuinely isn't installed the message says so, instead of claiming NDI is missing on a machine where NDI Tools is already set up.

### Search by meaning
- Searching the Bible by meaning works offline in the desktop app. The bundled index never reached the installed app, so every search went over the network and stopped working without a connection.
- Bible settings no longer offers "Enable Search" on versions the shared index already covers. Those versions read "Smart search ready" — nothing to enable, nothing to wait through. Building a version's own index is still available as a small optional link.

### Updates
- Selah now checks for a new version when you come back to the machine, as well as at launch and every few hours. A release published while the app sat open went unnoticed before, which is why 0.1.11 only appeared after opening Settings.

### Wording
- The pricing page matches what the app enforces: Free is one user account, Pro is up to 5 team members. It previously offered 2 seats on Free and "unlimited" on Pro, which would have hit a wall at five.
- Plainer copy across the app and the website, with the marketing register and the statements of the obvious removed.
