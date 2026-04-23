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