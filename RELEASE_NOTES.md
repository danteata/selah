## Selah 0.1.10

Fixes updating on Windows, and Selah now tells you when an update is ready instead of waiting to be asked.

### Updating
- Windows updates no longer fail with "Error opening file for writing: selah.exe". The installer was starting to copy files before Windows had finished releasing the running program; it now waits for it properly.
- A new version now announces itself with a button in the top bar, next to the layout switcher. Previously the only way to find out was to open Settings and check manually, so it was easy to stay on an old version for months.
- Clicking it shows what's in the release and what updating costs — Selah closes and reopens, so anything on the live output goes dark — and then installs only if you say so. Nothing installs on its own any more. Earlier versions could download and restart by themselves shortly after launch, which was possible mid-service.
- "Skip this version" hides the prompt for that release only; the next one asks again.
- If you run the installer by hand while Selah is open, it now asks before closing it rather than failing partway through.

