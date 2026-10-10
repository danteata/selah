## Selah 0.1.38

PowerPoint import, an NDI feed that doesn't need a projector screen, new slide and lower-third animations, and the sermon listener keeping up on laptops.

### Import PowerPoint decks (Pro, desktop app)

- **Bring in the slides you already have.** Choose **Import PowerPoint** in quick actions or the command bar and pick a `.pptx` file. The text arrives as editable slides with its formatting, background colours and pictures, and speaker notes. Selah tells you what it left out, such as charts and video, before you add the slides to your schedule.
- Password-protected decks and old `.ppt` files can't be read; save them as `.pptx` in PowerPoint first.

### NDI without a projector screen

- **Send your service over NDI with no live output window.** In Settings, set the alternate output to **NDI**, choose **Follow main output** and turn **Alpha channel** off. Selah draws the program itself, with backgrounds, motion backgrounds, videos, photos, countdowns and slide fades, and keeps sending even when its window is minimised.
- **The NDI feeds are smoother.** Each feed runs at a steady frame rate, 30 or 60 per second as you set it. Sending frames no longer makes the app stutter. Hover over the alternate output's badge to see frames sent and any dropped.

### New animations

- **Word morph between lyric slides.** In Settings › Display, set **Slide Transition** to **Word morph**. Words two slides share glide to their new place while the rest fades, so a returning chorus rearranges instead of blinking.
- **Lower thirds can build in.** Pick **Typewriter**, **Word rise**, **Letter fade** or **Slide in** in the lower-third editor or a lower-third template.

### The sermon listener keeps up

- **On laptops with Intel graphics, transcription runs on the processor**, which turned out to be faster there than the graphics chip: fast enough to keep up with a service on models that used to fall behind.
- **A transcript that falls behind skips ahead** instead of showing words from minutes ago. Stopping the listener now stops its transcription too, so a new session no longer starts with the last sermon.
- **A live transcription that can't keep up hands over** to transcribing each sentence in one go, instead of stopping with "No transcription model is loaded".

### Smaller things

- **Every slide font now shows on every computer**, offline too. Fonts like Montserrat, Poppins and Playfair Display were offered in the editor but only appeared on computers that already had them installed.
- **System audio works on Linux** (PulseAudio and PipeWire).
- **System audio on Windows and Mac drops less.** It now rides out a busy moment instead of losing audio, and keeps the end of the last word when you stop.
- **Slides you removed from the live deck stay removed** when you add a song or slides from the library.
