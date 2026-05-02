/**
 * NDI Output Module
 * 
 * Provides NDI (Network Device Interface) output for streaming
 * the live display and audio to other devices on the network.
 * 
 * When compiled with the `ndi` feature, availability is determined
 * at runtime by attempting to initialize the NDI SDK.
 * When compiled without, NDI is always reported as unavailable.
 */

mod types;
mod commands;

pub use commands::*;

#[cfg(feature = "ndi")]
mod sender;

#[cfg(all(feature = "ndi", target_os = "macos"))]
mod capture;

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
    #[cfg(all(feature = "ndi", target_os = "macos"))]
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
            #[cfg(all(feature = "ndi", target_os = "macos"))]
            capture_stop: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn init(&self, app: AppHandle) {
        *self.app.write() = Some(app);
    }

    pub fn get_app(&self) -> Option<AppHandle> {
        self.app.read().clone()
    }

    pub fn get_state(&self) -> NdiOutputState {
        self.state.read().clone()
    }

    pub fn is_available(&self) -> bool {
        NDI_RUNTIME_AVAILABLE.load(Ordering::SeqCst)
    }

    pub fn update_state(&self, f: impl FnOnce(&mut NdiOutputState)) {
        let mut state = self.state.write();
        f(&mut state);
    }

    #[cfg(feature = "ndi")]
    fn check_availability() -> bool {
        // Try to initialize the NDI runtime — this will fail
        // if the NDI SDK libraries are not installed on the system.
        match grafton_ndi::NDI::new() {
            Ok(_) => true,
            Err(e) => {
                eprintln!("NDI SDK not available: {:?}", e);
                false
            }
        }
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