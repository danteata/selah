//! Small host-platform probes that inform runtime decisions.

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
