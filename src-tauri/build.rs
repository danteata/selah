fn main() {
    #[cfg(all(target_os = "macos", feature = "ndi"))]
    {
        let ndi_lib = "/Library/NDI SDK for Apple/lib/macOS";
        println!("cargo:rustc-link-arg=-Wl,-rpath,{ndi_lib}");
    }

    stage_linux_transcribe_runtime();

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

    // Must run after the block above, which recreates `windows-runtime/` clean.
    stage_onnxruntime_dll();

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

/// Windows: copy the dynamically-linked ONNX Runtime's `onnxruntime.dll` into the
/// `windows-runtime/` staging dir so `tauri.windows.conf.json` bundles it beside
/// `Selah.exe` (Windows resolves DLLs from the executable's own directory).
///
/// No-op unless `ORT_PREFER_DYNAMIC_LINK` + `ORT_LIB_LOCATION` are set for a
/// Windows target — i.e. the CI dynamic-link path added alongside the removal of
/// the `ort-directml` feature (see the Windows dependency table in Cargo.toml for
/// why we no longer statically embed pyke's /arch:AVX2 build). A local `cargo
/// build` with no env set skips this and keeps whatever ORT `ort-sys` picked.
fn stage_onnxruntime_dll() {
    // CARGO_CFG_TARGET_OS, not #[cfg(target_os)] — see the note in
    // stage_linux_transcribe_runtime: a build script is compiled for the HOST.
    use std::path::PathBuf;

    println!("cargo:rerun-if-env-changed=ORT_LIB_LOCATION");
    println!("cargo:rerun-if-env-changed=ORT_PREFER_DYNAMIC_LINK");

    if std::env::var_os("ORT_PREFER_DYNAMIC_LINK").is_none() {
        return;
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Some(lib_location) = std::env::var_os("ORT_LIB_LOCATION") else {
        return;
    };

    let src = PathBuf::from(&lib_location).join("onnxruntime.dll");
    if !src.exists() {
        // Hard failure, not a warning: ORT_PREFER_DYNAMIC_LINK means the exe has
        // a NEEDED onnxruntime.dll with nothing to satisfy it, so shipping this
        // bundle would produce an app that cannot start.
        panic!(
            "ORT_PREFER_DYNAMIC_LINK is set but {} does not exist; a dynamic ORT \
             build must supply onnxruntime.dll to bundle",
            src.display()
        );
    }

    // The Windows block in main() already created (and cleaned) this dir, but
    // create it defensively so this function is self-contained.
    let dest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-runtime");
    std::fs::create_dir_all(&dest_dir).expect("create windows-runtime staging dir");
    std::fs::copy(&src, dest_dir.join("onnxruntime.dll"))
        .unwrap_or_else(|e| panic!("copy {}: {e}", src.display()));
    println!("cargo:warning=selah build.rs: staged onnxruntime.dll for Windows bundling");
}

/// Linux: stage the transcribe-cpp shared libraries so the deb/rpm/AppImage can
/// ship them, and give the executable an rpath that finds them.
///
/// Linux builds transcribe-cpp with `dynamic-backends` (=> `shared`), exactly
/// like Windows, so `libtranscribe.so.0` is a NEEDED dependency of the binary
/// plus a set of ggml backend modules loaded at runtime. transcribe-cpp-sys
/// copies them next to cargo's build artifacts so `cargo run`/tests work, and
/// nothing carried them any further: the AppImage bundle died with
/// `ERROR: Could not find dependency: libtranscribe.so.0` (which is how every
/// Linux release from v0.1.5 on failed), and the deb/rpm — which resolve no
/// dependencies and so "built fine" — packaged a binary that would die at launch
/// with `libtranscribe.so.0: cannot open shared object file`. Linux has never
/// actually shipped an asset, so this is the missing half of the Windows fix
/// above rather than a regression.
///
/// Tauri installs `bundle.resources` to `/usr/lib/<productName>/` on Linux
/// (crates/tauri-bundler/src/bundle/linux/debian.rs) with the binary at
/// `/usr/bin/<binary>`, and the AppImage mirrors that layout inside the AppDir —
/// so one `$ORIGIN`-relative rpath covers all three bundle formats.
fn stage_linux_transcribe_runtime() {
    // CARGO_CFG_TARGET_OS, not #[cfg(target_os)]: a build script is compiled for
    // the HOST, so a cfg here would silently skip staging (and the rpath) when
    // Linux is cross-compiled, producing a bundle that only fails at launch.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }

    use std::path::PathBuf;

    // DT_RPATH, not DT_RUNPATH (that's what --disable-new-dtags buys). RUNPATH
    // applies only to the executable's OWN direct dependencies, so
    // libtranscribe.so.0 would be found but the ggml backend modules IT pulls in
    // would not. DT_RPATH is honoured transitively down the whole chain.
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/Selah/linux-runtime");
    println!("cargo:rustc-link-arg=-Wl,--disable-new-dtags");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let dest = PathBuf::from(&manifest_dir).join("linux-runtime");
    // Recreate clean so a library renamed/removed upstream never lingers stale.
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).expect("create linux-runtime staging dir");
    // tauri-build FAILS the whole build on a resource glob that matches nothing
    // ("glob pattern linux-runtime/**/* path not found or didn't match any
    // files"), so the directory must never be empty — including when this crate
    // is built without native-transcription and there is nothing to stage.
    // .gitkeep is committed for the same reason on macOS and Windows, where this
    // function returns early.
    let _ = std::fs::write(dest.join(".gitkeep"), b"");

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
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // Match on the name, not the extension: the files that matter are
            // soname-versioned (libtranscribe.so.0), so `extension()` is "0".
            if !name.contains(".so") {
                continue;
            }
            // fs::copy follows symlinks, so a `libtranscribe.so -> .so.0` pair
            // lands as two real files. That costs a few MB and keeps both names
            // resolvable without relying on the bundler preserving symlinks.
            if std::fs::copy(&path, dest.join(name)).is_ok() {
                copied += 1;
            }
        }
    }

    if copied == 0 {
        println!(
            "cargo:warning=selah build.rs: staged no transcribe-cpp shared libraries for \
             the Linux bundle (DEP_TRANSCRIBE_CPP_RUNTIME_DIR unset or empty) — the \
             AppImage bundle will fail with 'Could not find dependency: \
             libtranscribe.so.0' and the deb/rpm will fail at launch"
        );
    }
}
