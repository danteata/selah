fn main() {
    #[cfg(all(target_os = "macos", feature = "ndi"))]
    {
        let ndi_lib = "/Library/NDI SDK for Apple/lib/macOS";
        println!("cargo:rustc-link-arg=-Wl,-rpath,{ndi_lib}");
    }

    // Embed a custom Windows app manifest (microphone + webcam device
    // capabilities, PerMonitorV2 DPI awareness, asInvoker trust level).
    //
    // Without the microphone capability, WebView2 refuses
    // `navigator.mediaDevices.getUserMedia({ audio: true })` immediately
    // with `NotAllowedError` — the user never sees a permission prompt and
    // our voice search / desktop-whisper pipeline can never start. The
    // manifest is the only place to declare this on Windows; there's no
    // Tauri capability for it because the WebView2 process is a child of
    // selah.exe, not the Tauri runtime itself.
    //
    // We use `try_build` so a non-Windows build host still produces a
    // valid build script — `WindowsAttributes` is cfg-gated by
    // tauri-build internally. The manifest is also cfg-gated to
    // `windows` so a Mac/Linux dev never needs it on disk to compile,
    // but the `include_str!` below is fine because the file is checked
    // into the repo regardless.
    let mut windows_attrs = tauri_build::WindowsAttributes::new();
    windows_attrs = windows_attrs.app_manifest(include_str!("app.manifest"));

    let attrs = tauri_build::Attributes::new().windows_attributes(windows_attrs);
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
