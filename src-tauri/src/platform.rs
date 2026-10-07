//! Small host-platform probes that inform runtime decisions.

/// Disable ggml's Metal residency sets before the transcription engine ever
/// initialises its Metal device.
///
/// ggml-metal pins its buffers into a `MTLResidencySet` and asserts on the set
/// during teardown. Selah's engine can still be loaded when the process is
/// going down — `TranscriptionManager` lives in Tauri state and its idle
/// watcher holds a model until the unload timeout elapses — so the engine
/// routinely outlives Tauri's shutdown sequence and the assertion fires as a
/// crash on quit. The operator sees the app "close weirdly"; nothing in the
/// log says why, because the process is already past the point where our
/// logging is running.
///
/// Handy hit the same thing on the same crate and version (transcribe-cpp
/// 0.1.3, `metal` feature) and disables residency outright — their issue
/// #1902. Residency sets are a page-residency optimisation, not a correctness
/// feature, so losing them costs a little first-run latency and nothing else.
///
/// ggml reads `GGML_METAL_NO_RESIDENCY` by *presence*, not value, so opting
/// back in means removing the variable rather than setting it to 0. Set
/// `SELAH_METAL_RESIDENCY=1` to do that and get upstream behaviour back.
///
/// Must run before the first Metal device is created — called at the top of
/// `run()`, alongside [`crate::memory::init_allocator`], for the same reason.
pub fn init_metal_backend() {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: called from `run()` before any other thread is spawned, so
        // there is no concurrent getenv/setenv to race with.
        unsafe {
            if std::env::var("SELAH_METAL_RESIDENCY").as_deref() == Ok("1") {
                std::env::remove_var("GGML_METAL_NO_RESIDENCY");
            } else {
                std::env::set_var("GGML_METAL_NO_RESIDENCY", "1");
            }
        }
    }
}

/// Keep third-party Vulkan implicit layers out of this process.
///
/// Overlay and capture tools — OBS's game-capture hook, the Steam overlay,
/// RTSS, Overwolf — register system-wide Vulkan *implicit* layers that the
/// loader injects into every Vulkan app. One of them colliding with
/// ggml-vulkan's compute dispatch crashed Handy with an access violation inside
/// the GPU driver the moment a model loaded, with nothing in the log (Handy
/// #2049). Selah runs the same ggml Vulkan backend on Windows, and OBS is on
/// nearly every church AV machine, so the failure would read as Selah vanishing
/// mid-service. The layers do nothing for compute, and disabling them keeps
/// full GPU acceleration.
///
/// An operator's own `VK_LOADER_LAYERS_DISABLE` wins, and
/// `SELAH_KEEP_VULKAN_IMPLICIT_LAYERS=1` opts out entirely. Must run before the
/// Vulkan loader is first touched — called at the top of `run()`.
pub fn init_vulkan_layers() {
    #[cfg(target_os = "windows")]
    {
        let keep = std::env::var("SELAH_KEEP_VULKAN_IMPLICIT_LAYERS").as_deref() == Ok("1");
        if !keep && std::env::var_os("VK_LOADER_LAYERS_DISABLE").is_none() {
            // SAFETY: called from `run()` before any other thread is spawned, so
            // there is no concurrent getenv/setenv to race with.
            unsafe { std::env::set_var("VK_LOADER_LAYERS_DISABLE", "~implicit~") };
        }
    }
}

/// Turn off WebView2's built-in browser shortcuts for one window.
///
/// WebView2 handles F5 / Ctrl+R (reload), Ctrl+F, F6, F12 and friends itself,
/// before page script can see or `preventDefault()` them. In Selah a stray F5
/// reloads the whole app — or a live output on the projector — in the middle
/// of a service. None of those shortcuts serve an app, so every window drops
/// them (Handy did the same for its F6 white-window reports, #1940). DevTools
/// stays reachable from the context menu; only the F12 shortcut goes.
///
/// No-op off Windows, where WKWebView and WebKitGTK have no such layer.
pub fn disable_browser_accelerators<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        let result = window.with_webview(|webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows_core::Interface;

            let applied = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false));
            if let Err(e) = applied {
                tracing::warn!("[webview] could not disable browser accelerator keys: {e}");
            }
        });
        if let Err(e) = result {
            tracing::warn!("[webview] could not reach the webview to disable accelerators: {e}");
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

/// Whether this is an x86_64 Windows process running under emulation on an
/// ARM64 host (Windows-on-ARM's x64 emulation layer).
///
/// Selah ships no `aarch64-pc-windows-msvc` target, so every Windows-on-ARM user
/// runs the x86_64 build — which is compiled with transcribe-cpp's `vulkan`
/// feature. Under emulation the Vulkan backend enumerates a device that then
/// misbehaves or fails outright, so the transcription engine forces strict CPU
/// when this returns true (see `transcription::engine`).
///
/// The result is cached: the answer cannot change within a process, and the
/// probe involves a dynamic symbol lookup.
pub fn is_windows_x64_emulated_on_arm64() -> bool {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        use std::sync::OnceLock;

        static DETECTED: OnceLock<bool> = OnceLock::new();
        *DETECTED.get_or_init(|| {
            // IMAGE_FILE_MACHINE_ARM64. Hard-coded rather than pulled from the
            // `windows` crate so this stays a single well-known constant.
            const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;
            native_windows_machine() == Some(IMAGE_FILE_MACHINE_ARM64)
        })
    }

    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        false
    }
}

/// The host's native machine architecture via `IsWow64Process2`, or `None` if
/// the query is unavailable or fails.
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn native_windows_machine() -> Option<u16> {
    // NB: `BOOL` is in `Win32::Foundation` on `windows` 0.58 (it only moves to
    // `windows::core` in 0.59+, which is where Handy's copy imports it from).
    use windows::core::{s, w};
    use windows::Win32::Foundation::{BOOL, HANDLE};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows::Win32::System::Threading::GetCurrentProcess;

    type IsWow64Process2 = unsafe extern "system" fn(HANDLE, *mut u16, *mut u16) -> BOOL;

    // Resolve IsWow64Process2 dynamically so merely starting Selah never raises
    // the app's minimum Windows version. Windows-on-ARM builds all provide the
    // API; a missing symbol or a failed query returns None, which preserves the
    // normal (non-emulated) x64 behaviour.
    unsafe {
        let kernel32 = GetModuleHandleW(w!("kernel32.dll")).ok()?;
        let address = GetProcAddress(kernel32, s!("IsWow64Process2"))?;
        // SAFETY: GetProcAddress returned the documented IsWow64Process2 symbol,
        // and function pointers share a representation on supported Windows.
        let is_wow64_process2: IsWow64Process2 = std::mem::transmute(address);
        let mut process_machine = 0u16;
        let mut native_machine = 0u16;
        is_wow64_process2(
            GetCurrentProcess(),
            &mut process_machine,
            &mut native_machine,
        )
        .as_bool()
        .then_some(native_machine)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// On every platform Selah actually builds for today the answer is false;
    /// this mainly pins the non-Windows cfg arm so the helper is callable
    /// unconditionally.
    #[test]
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    fn non_windows_hosts_are_never_emulated() {
        assert!(!is_windows_x64_emulated_on_arm64());
    }

    /// The probe must be stable within a process (it is cached).
    #[test]
    fn result_is_stable() {
        assert_eq!(
            is_windows_x64_emulated_on_arm64(),
            is_windows_x64_emulated_on_arm64()
        );
    }
}
