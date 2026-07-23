fn main() {
    #[cfg(all(target_os = "macos", feature = "ndi"))]
    {
        let ndi_lib = "/Library/NDI SDK for Apple/lib/macOS";
        println!("cargo:rustc-link-arg=-Wl,-rpath,{ndi_lib}");
    }

    // Windows: stage the transcribe-cpp shared-library DLLs so the installer
    // can ship them next to Selah.exe.
    //
    // On Windows `transcribe-cpp` is built with `dynamic-backends` (=> `shared`),
    // so the native core is a runtime `transcribe.dll` plus the ggml backend /
    // compute-module DLLs, loaded from the executable's own directory (Windows
    // has no rpath). transcribe-cpp-sys already copies these next to cargo's
    // build artifacts so `cargo run`/tests work — but the Tauri NSIS/MSI bundler
    // only packages the exe + declared `resources`, so without staging them here
    // the installed app dies at launch with "transcribe.dll was not found".
    //
    // The sys crate exposes their location via `DEP_TRANSCRIBE_CPP_RUNTIME_DIR`
    // (bin/ on Windows) and `DEP_TRANSCRIBE_CPP_MODULE_DIR` (the dynamic-backend
    // modules). Both are set only in the shared posture, so this whole block is a
    // no-op on the static macOS build. We copy every DLL into `windows-runtime/`,
    // which tauri.windows.conf.json maps flat into the bundle root (next to the
    // exe). See that config's `resources` map.
    #[cfg(target_os = "windows")]
    {
        use std::path::PathBuf;

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let dest = PathBuf::from(&manifest_dir).join("windows-runtime");
        // Recreate clean so a DLL renamed/removed upstream never lingers stale.
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).expect("create windows-runtime staging dir");

        let mut copied = 0usize;
        for var in [
            "DEP_TRANSCRIBE_CPP_RUNTIME_DIR",
            "DEP_TRANSCRIBE_CPP_MODULE_DIR",
        ] {
            println!("cargo:rerun-if-env-changed={var}");
            let Some(dir) = std::env::var_os(var) else {
                continue;
            };
            let dir = PathBuf::from(dir);
            println!("cargo:rerun-if-changed={}", dir.display());
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("dll") {
                    continue;
                }
                if let Some(name) = path.file_name() {
                    // read_dir over both vars can yield the same file (Windows
                    // keeps modules in bin/ too); copying twice is harmless.
                    if std::fs::copy(&path, dest.join(name)).is_ok() {
                        copied += 1;
                    }
                }
            }
        }
        if copied == 0 {
            println!(
                "cargo:warning=selah build.rs: staged no transcribe-cpp DLLs for the \
                 Windows bundle (DEP_TRANSCRIBE_CPP_RUNTIME_DIR unset or empty) — the \
                 installed app will fail at launch with 'transcribe.dll was not found'"
            );
        }
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
