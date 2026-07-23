/**
 * State management for multi-monitor window management
 */

use parking_lot::RwLock;
use tauri::AppHandle;

use super::types::*;

/// The name of the live output window
pub const LIVE_WINDOW_LABEL: &str = "live-output";

/// State for multi-monitor management
pub struct MultiMonitorState {
    /// The application handle
    pub(crate) app: RwLock<Option<AppHandle>>,
    /// Current window state for persistence
    pub(crate) window_state: RwLock<WindowState>,
    /// Current live window state
    pub(crate) live_window_state: RwLock<LiveWindowState>,
    /// Current monitor ID for live output
    pub(crate) current_live_monitor: RwLock<Option<String>>,
}

impl MultiMonitorState {
    /// Create a new multi-monitor state
    pub fn new() -> Self {
        Self {
            app: RwLock::new(None),
            window_state: RwLock::new(WindowState::default()),
            live_window_state: RwLock::new(LiveWindowState::Closed),
            current_live_monitor: RwLock::new(None),
        }
    }

    /// Initialize with app handle
    pub fn init(&self, app: AppHandle) {
        *self.app.write() = Some(app);
    }

    /// Get the app handle
    pub fn get_app(&self) -> Option<AppHandle> {
        self.app.read().clone()
    }

    /// Get current window state
    pub fn get_window_state(&self) -> WindowState {
        self.window_state.read().clone()
    }

    /// Update window state
    pub fn update_window_state<F>(&self, f: F)
    where
        F: FnOnce(&mut WindowState),
    {
        let mut state = self.window_state.write();
        f(&mut state);
    }

    /// Get live window state
    pub fn get_live_window_state(&self) -> LiveWindowState {
        self.live_window_state.read().clone()
    }

    /// Set live window state
    pub fn set_live_window_state(&self, state: LiveWindowState) {
        *self.live_window_state.write() = state;
    }

    /// Get current live monitor ID
    pub fn get_current_live_monitor(&self) -> Option<String> {
        self.current_live_monitor.read().clone()
    }

    /// Set current live monitor ID
    pub fn set_current_live_monitor(&self, monitor_id: Option<String>) {
        *self.current_live_monitor.write() = monitor_id;
    }

    /// Check if live window is open
    pub fn is_live_window_open(&self) -> bool {
        !matches!(self.live_window_state.read().clone(), LiveWindowState::Closed)
    }

    /// Load window state from storage
    pub fn load_state(&self, state: WindowState) {
        *self.window_state.write() = state;
    }

    /// Save window state to storage (returns the state to be saved)
    #[allow(dead_code)]
    pub fn save_state(&self) -> WindowState {
        let state = self.window_state.read().clone();
        
        // Update with current live monitor if set
        if let Some(monitor_id) = self.current_live_monitor.read().clone() {
            let mut state_mut = self.window_state.write();
            state_mut.live_monitor_id = Some(monitor_id);
        }
        
        state
    }
}

impl Default for MultiMonitorState {
    fn default() -> Self {
        Self::new()
    }
}
