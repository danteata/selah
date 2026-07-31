## Selah 0.1.16

NDI works out of the box on Windows and Linux.

### The NDI runtime ships with Selah
- **No more "NDI runtime not found", and no NDI Tools install needed** on Windows and Linux. The runtime library is now included in the app.
- Until now only NDI *support* shipped. Since 0.1.12 the feature has been in every build, but the runtime it loads still had to be installed separately — which is what that error meant. It's now in the box.
- Selah prefers its own copy over one installed on the machine, so an older NDI Tools install can't quietly replace the version this release was tested with. If you deliberately point the system library path at your own build, that still wins.
- Adds about 26 MB on Linux and 28 MB on Windows.

**macOS still needs NDI Tools** from ndi.video/tools for the main output — its library isn't bundled yet, and the message you get says so instead of implying it's optional. The alternate output over NDI needs nothing installed on any platform, because it renders its own frames.
