## Selah 0.1.20

Two faults that could leave you with no working transcription and no explanation why — one on Mac, one on any machine with an interface that is slow to wake.

### Selah notices a microphone that never starts
- **A microphone that opens but never sends any audio is now detected and reconnected.** 0.1.18 taught Selah to spot a microphone that *drops* mid-service. This is the other half: a device that appears to start correctly and then delivers nothing at all. A Bluetooth headset still negotiating, a USB interface still powering up, or a device the computer thinks is there but isn't — all of them let Selah open the microphone successfully, so nothing anywhere reported a problem. The result was a "listening" indicator in front of a silent room, indistinguishable from a service where nobody had spoken yet. Selah now waits five seconds for the first audio to actually arrive; if it doesn't, it treats the microphone as failed, reconnects with the same patient retries as a dropped device, and shows you the same banner. Five seconds is deliberately generous — a cold interface can legitimately take a second or two to wake, and Selah shouldn't give up on one that is merely slow.

### On Mac, quitting is clean
- **Selah could crash as it closed on macOS.** The graphics acceleration used for transcription keeps a registry of the memory it has reserved, and checks that registry as it shuts down. Because Selah keeps a transcription model loaded for a while after you stop listening — so that starting again is instant — that check could still be running as the application went away, and fail. It was harmless to your data, and it happened as Selah was closing rather than during a service, but it looked exactly like a crash and left nothing useful in the log to explain it. The registry it depended on is a speed optimisation with no effect on transcription quality, and is now switched off.

### Under the hood
- Both fixes were adapted from [Handy](https://github.com/cjpais/Handy), which runs the same transcription engine as Selah and hit the same two problems first.
