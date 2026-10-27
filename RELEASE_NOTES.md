## Selah 0.1.44

Searching the Bible by phrase works on Windows again, and Selah's built-in Bible versions and motion templates are there when it's offline.

### Bible

- **Search by phrase on Windows.** Typing words from a verse, such as "God so loved the world", found nothing on Windows; only a reference like John 3:16 worked. The search index that finds verses by meaning had been left out of the Windows installer since 0.1.29. It's included again, and if it's ever missing, the panel still finds verses by the words you type.
- **Bible versions in Settings while offline.** Settings → Bible Versions kept showing loading placeholders, with no default version, when Selah couldn't reach its online service. It now lists the versions that come with Selah.

### Templates

- **The motion templates are always there.** Galaxy, Aurora, Warm Glow, Embers, Silk and Light Rays came from the online service, so offline they disappeared from the templates panel and the default template pickers. Selah now carries them itself.
- A default template that isn't available on this computer now says so, instead of "Using: null".
