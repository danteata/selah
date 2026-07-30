/**
 * NDI Output Module
 * 
 * Provides NDI (Network Device Interface) output for streaming
 * the live display and audio to other devices on the network.
 * 
 * The NDI library is loaded at runtime (see `ndi_lib`), so this ships in every
 * build: availability is decided by whether the runtime is installed on the
 * machine, not by how Selah was compiled. The `ndi` feature remains only so a
 * build can leave NDI out entirely.
 */

mod types;
mod commands;

pub use commands::*;

#[cfg(feature = "ndi")]
pub(crate) mod ndi_lib;

#[cfg(feature = "ndi")]
mod sender;

#[cfg(all(feature = "ndi", target_os = "macos"))]
mod capture;

#[cfg(all(feature = "ndi", target_os = "windows"))]
mod capture_windows;

#[cfg(all(feature = "ndi", target_os = "linux"))]
mod capture_linux;

#[cfg(feature = "ndi")]
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::RwLock;
use tauri::AppHandle;

#[cfg(feature = "ndi")]
use sender::NdiSender;

pub const NDI_SOURCE_NAME: &str = "Selah Live Output";

static NDI_RUNTIME_AVAILABLE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiOutputState {
    pub is_available: bool,
    pub is_running: bool,
    pub source_name: String,
    pub frames_sent: u64,
    pub error: Option<String>,
}

impl Default for NdiOutputState {
    fn default() -> Self {
        Self {
            is_available: false,
            is_running: false,
            source_name: NDI_SOURCE_NAME.to_string(),
            frames_sent: 0,
            error: None,
        }
    }
}

pub struct NdiManager {
    app: RwLock<Option<AppHandle>>,
    state: RwLock<NdiOutputState>,
    #[cfg(feature = "ndi")]
    sender: Arc<NdiSender>,
    #[cfg(all(feature = "ndi", any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub capture_stop: Arc<AtomicBool>,
}

impl NdiManager {
    pub fn new() -> Self {
        let available = Self::check_availability();
        NDI_RUNTIME_AVAILABLE.store(available, Ordering::SeqCst);

        let mut default_state = NdiOutputState::default();
        default_state.is_available = available;

        Self {
            app: RwLock::new(None),
            state: RwLock::new(default_state),
            #[cfg(feature = "ndi")]
            sender: Arc::new(NdiSender::new()),
            #[cfg(all(feature = "ndi", any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            capture_stop: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn init(&self, app: AppHandle) {
        *self.app.write() = Some(app);
    }

    #[allow(dead_code)]
    pub fn get_app(&self) -> Option<AppHandle> {
        self.app.read().clone()
    }

    pub fn get_state(&self) -> NdiOutputState {
        self.state.read().clone()
    }

    /// Whether the NDI runtime was found and initialised.
    pub fn is_available(&self) -> bool {
        NDI_RUNTIME_AVAILABLE.load(Ordering::SeqCst)
    }

    /// Whether this build has NDI support compiled in at all.
    ///
    /// The `ndi` feature is on by default now that the runtime is loaded through
    /// `ndi_lib` at run time rather than linked at build time — a build machine
    /// no longer needs the SDK. It stays a feature so a build can leave NDI out;
    /// without it `is_available` is a `false` stub that can never become true,
    /// however the operator's machine is set up.
    ///
    /// The UI needs these apart: "your build can't do this" and "install the
    /// runtime" are different instructions, and telling someone with NDI Tools
    /// already installed to go install NDI Tools is worse than saying nothing.
    pub fn is_supported(&self) -> bool {
        cfg!(feature = "ndi")
    }

    // Called from commands.rs, but only inside `#[cfg(feature = "ndi")]`
    // command bodies, so without the feature it reads as dead code.
    #[allow(dead_code)]
    pub fn update_state(&self, f: impl FnOnce(&mut NdiOutputState)) {
        let mut state = self.state.write();
        f(&mut state);
    }

    #[cfg(feature = "ndi")]
    fn check_availability() -> bool {
        // Loads the NDI runtime if it's installed. Cached after the first call,
        // and a failure here is just "no NDI on this machine" — it can't affect
        // the rest of the app.
        ndi_lib::NdiLib::get().is_some()
    }

    #[cfg(not(feature = "ndi"))]
    fn check_availability() -> bool {
        false
    }
}

impl Default for NdiManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ndi_output_state_default() {
        let state = NdiOutputState::default();
        assert!(!state.is_available);
        assert!(!state.is_running);
        assert_eq!(state.source_name, "Selah Live Output");
        assert_eq!(state.frames_sent, 0);
        assert!(state.error.is_none());
    }

    #[test]
    fn test_ndi_output_state_serialization_roundtrip() {
        let state = NdiOutputState::default();
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: NdiOutputState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.is_available, state.is_available);
        assert_eq!(deserialized.is_running, state.is_running);
        assert_eq!(deserialized.source_name, state.source_name);
        assert_eq!(deserialized.frames_sent, state.frames_sent);
        assert_eq!(deserialized.error, state.error);
    }

    #[test]
    fn test_ndi_output_state_camelcase() {
        let state = NdiOutputState::default();
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("isAvailable"), "is_available should serialize as isAvailable");
        assert!(json.contains("isRunning"), "is_running should serialize as isRunning");
        assert!(json.contains("sourceName"), "source_name should serialize as sourceName");
        assert!(json.contains("framesSent"), "frames_sent should serialize as framesSent");
    }

    #[test]
    fn test_ndi_source_name_constant() {
        assert_eq!(NDI_SOURCE_NAME, "Selah Live Output");
    }

    #[test]
    fn test_ndi_output_state_with_error() {
        let mut state = NdiOutputState::default();
        state.is_running = true;
        state.error = Some("test error".to_string());
        state.frames_sent = 42;

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: NdiOutputState = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_running);
        assert_eq!(deserialized.error, Some("test error".to_string()));
        assert_eq!(deserialized.frames_sent, 42);
    }
}