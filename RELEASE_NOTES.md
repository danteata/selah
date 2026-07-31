## Selah 0.1.15

Three fixes, one of them important if your Convex deployment ever stops responding.

### Selah starts without Convex
- The app now opens when the Convex deployment is unavailable — including when it has been disabled for exceeding its plan. It was failing to render at all, which is the opposite of what an offline-first app should do: local data, bundled Bibles and dictionaries, your slides and both outputs all work without a connection. Anything that writes to the cloud still won't until it's back.

### macOS screen recording
- macOS no longer asks to record your screen over and over. Selah was checking for the permission every two seconds while waiting for the live output window, and each check is what raised the dialog — so a permission macOS didn't recognise produced an endless prompt. It now asks once and explains what to do.
- NDI no longer requests system audio unless you ask for it, so the prompt covers the screen alone. Audio was only ever captured on macOS, and a lyrics or graphics feed rarely needs it.
- If the permission is enabled in System Settings and Selah still can't use it, remove Selah from the list and add it again. macOS ties that permission to a specific build, and Selah's macOS builds aren't yet signed, so a new version doesn't inherit it.

### Alternate output
- Your alternate output settings survive a restart — destination, resolution, alpha, content source, layout and design. You no longer have to set it up again each time. You still switch it on yourself, deliberately, since the output itself doesn't restart with the app.
