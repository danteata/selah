## Selah 0.1.13

NDI actually sends a picture now — on Windows and Linux as well as macOS — and there's a second output you can run alongside your main one.

### NDI output
- **It works.** 0.1.12 announced "Selah Live Output" on the network and then sent nothing at all: the only screen capture in the app was macOS-only, so Windows created the source and stopped there. Windows now captures through Windows.Graphics.Capture and Linux through XComposite, so a receiver sees your slides.
- On macOS, Selah asks for the Screen Recording permission it always needed. Without it the capture waited forever for a window it wasn't allowed to see, which looked exactly like a working feed of a black slide.
- Nothing can claim to be sending when it isn't. The badge in Program Output reads "NDI — NO FRAMES" until frames are really going out, and turning NDI on now explains any refusal instead of failing silently — including the one most people hit: NDI mirrors the live output window, so that window has to be open. The message comes with a button that opens it.

### Alternate output
A second output alongside the main one, in Settings › Display.

- Send it to any display, or out as its own NDI source — both are just destinations of the same output.
- Choose its resolution and frame rate, and whether it keeps an alpha channel so a switcher can key it over camera video.
- Its content either follows your main output or is entirely its own, so lyrics can stay on the projector while something else goes to the stream.
- Send anything to it with the Alt button, which now sits beside Add and Live in the Bible, dictionary, songs and hymns panels.
- Over NDI it draws text — lyrics, scripture, announcements, lower thirds — with bold, italics and colour preserved. Image and video backgrounds need the display destination, which renders exactly what the projector does.

### Search by meaning
- Searching the Bible by meaning works offline in the desktop app. The bundled index never reached the installed app, so every search went over the network and stopped working without a connection.
- Bible settings no longer offers "Enable Search" on versions the shared index already covers.

### Keyboard
- The songs, hymns and dictionary panels now behave like the Bible panel: the best result is highlighted the moment results appear, Enter presents it, Shift+Enter queues it, and the arrow keys walk the list.
- The arrow keys no longer stop working after you click a result, or when the panel redraws.

### Fixes
- Update prompts appear when you come back to the machine, not only at launch.
- The pricing page matches what the app enforces.
