## Selah 0.1.11

Six fixes from a week of use: the wrong verse going live when you type fast, the theme flipping to light on its own, and a proper start-up screen.

### Bible search
- Typing a reference and pressing Enter before the results appear now shows the verse you typed. Previously it could present something unrelated — a different book, chapter and verse — and then fill the search box with that reference, so it looked like Selah was completing references you'd never typed. It was picking one of the meaning-based matches still on screen from the partial reference.
- Typing a reference into an empty panel and pressing Enter now presents it straight away, instead of needing a second Enter.
- Arrowing to a neighbouring verse and pressing Enter still presents that verse, and searching by meaning still works the same way.

### Appearance
- The app no longer switches itself from dark to light. It happened after a network blip, when signing back in reloaded part of the app and the theme was reset by whichever piece of code got there last. Your choice is now honoured in one place and can't be overwritten.
- Verse numbers are no longer cut off at the top in the live preview. The larger the preview panel, the more of the number you lost.

### Starting up
- Launching now shows the Selah name on your chosen background instead of a blank white page with a small spinner — including in dark mode, where the white flash was hard to miss.

### Settings
- Dragging Bible versions into your preferred order works. Only the up/down arrows did before; the arrows are still there for keyboard use.

### Quieter logs
- The app no longer fills its log with authentication errors while reconnecting after a network change. Nothing was broken by them, but they made real problems harder to spot.

