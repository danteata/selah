fn main() {
    #[cfg(all(target_os = "macos", feature = "ndi"))]
    {
        let ndi_lib = "/Library/NDI SDK for Apple/lib/macOS";
        println!("cargo:rustc-link-arg=-Wl,-rpath,{ndi_lib}");
    }

    // Embed a custom Windows app manifest (PerMonitorV2 DPI awareness,
    // asInvoker trust level, Common-Controls 6 for visual styles).
    //
    // NOTE: mic/camera access for WebView2's getUserMedia() on Windows is
    // NOT controlled by this manifest. <capabilities>/<devicecapability>
    // are AppX/MSIX package-manifest elements (sandboxed UWP apps only);
    // they aren't valid in this classic Win32 SxS assembly manifest and
    // Windows refuses to load the exe if they're present here ("element
    // capabilities ... not supported by this version of Windows"). A
    // regular desktop process isn't AppContainer-sandboxed, so device
    // access instead goes through Windows' Privacy Settings consent
    // model and/or handling WebView2's `CoreWebView2.PermissionRequested`
    // event in Rust — if `NotAllowedError` shows up on Windows, look
    // there, not here.
    //
    // We use `try_build` so a non-Windows build host still produces a
    // valid build script — `WindowsAttributes` is cfg-gated by
    // tauri-build internally. The manifest is also cfg-gated to
    // `windows` so a Mac/Linux dev never needs it on disk to compile,
    // but the `include_str!` below is fine because the file is checked
    // into the repo regardless.
    //
    // app.manifest must stay PURE XML with no comments and no XML
    // declaration, and every character must be ASCII. tauri-build's
    // Windows resource embedding round-trips the manifest text through
    // an RC string literal: it collapses all newlines to spaces (so a
    // multi-line `<!-- ... -->` comment becomes one line containing
    // "--", which XML forbids anywhere but the closing delimiter) and
    // can mangle non-ASCII bytes. Any of that produces a corrupted
    // RT_MANIFEST resource that fails to launch at runtime with
    // `os error 14001` / "Invalid Xml syntax" — a generic error that
    // gives no indication the manifest itself is the culprit.
    let mut windows_attrs = tauri_build::WindowsAttributes::new();
    windows_attrs = windows_attrs.app_manifest(include_str!("app.manifest"));

    let attrs = tauri_build::Attributes::new().windows_attributes(windows_attrs);
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
