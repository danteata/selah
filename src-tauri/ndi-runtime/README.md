# Bundled NDI runtime

The NDI runtime library, shipped inside the app so NDI output works without the
operator installing NDI Tools. `ndi_output::ndi_lib` looks here first — see
`bundled_runtime_dirs`.

One directory per platform, because the bundle configs are per platform: shipping
the whole folder would put a 28 MB Windows DLL inside the macOS .dmg and a 26 MB
Linux .so inside the Windows installer.

| Platform | File | Size |
|---|---|---|
| Linux | `linux/libndi.so.6.3.2` | 26 MB |
| Windows | `windows/Processing.NDI.Lib.x64.dll` | 28.5 MB |
| macOS | `macos/libndi.dylib` | not yet added |

Each platform's licence text ships beside its library, which the NDI SDK's
redistribution terms require. NDI® is a registered trademark of Vizrt NDI AB.

These binaries are NOT built from source here — they come from the NDI SDK /
Runtime install. Replacing them means copying a newer library in and checking the
loader still recognises the file name (`matches_library_name`).
