/**
 * Type definitions for multi-monitor window management
 */

use serde::{Deserialize, Serialize};

/// Information about a single display/monitor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    /// Unique identifier for the monitor
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// X position in virtual screen coordinates
    pub position_x: i32,
    /// Y position in virtual screen coordinates
    pub position_y: i32,
    /// Scale factor (1.0 = normal, 2.0 = HiDPI)
    pub scale_factor: f64,
    /// Whether this is the primary monitor
    pub is_primary: bool,
    /// Refresh rate in Hz (if available)
    pub refresh_rate: Option<u32>,
}

/// State of the live output window
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LiveWindowState {
    /// No live window is open
    Closed,
    /// Live window is open but not fullscreen
    Open,
    /// Live window is in fullscreen mode
    Fullscreen,
}

/// Configuration for the live output window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveWindowConfig {
    /// Monitor ID to display on
    pub monitor_id: Option<String>,
    /// Whether to start in fullscreen mode
    pub fullscreen: bool,
    /// Whether to show the window decorations
    pub decorations: bool,
    /// Whether the window should always be on top
    pub always_on_top: bool,
    /// Initial slide ID to display
    pub initial_slide_id: Option<String>,
}

impl Default for LiveWindowConfig {
    fn default() -> Self {
        Self {
            monitor_id: None,
            fullscreen: true,
            decorations: false,
            always_on_top: true,
            initial_slide_id: None,
        }
    }
}

/// Persisted window state for restoration on app restart
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    /// Last used monitor ID for live output
    pub live_monitor_id: Option<String>,
    /// Whether live window was fullscreen
    pub live_fullscreen: bool,
    /// Main window position X
    pub main_position_x: Option<i32>,
    /// Main window position Y
    pub main_position_y: Option<i32>,
    /// Main window width
    pub main_width: Option<u32>,
    /// Main window height
    pub main_height: Option<u32>,
    /// Main window maximized state
    pub main_maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            live_monitor_id: None,
            live_fullscreen: true,
            main_position_x: None,
            main_position_y: None,
            main_width: None,
            main_height: None,
            main_maximized: false,
        }
    }
}

/// Event payload sent to the frontend when monitor configuration changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorEventPayload {
    /// The type of event
    pub event_type: String,
    /// The affected monitor (if applicable)
    pub monitor: Option<MonitorInfo>,
    /// All current monitors
    pub monitors: Vec<MonitorInfo>,
}

/// Error types for multi-monitor operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiMonitorError {
    pub code: String,
    pub message: String,
}

impl From<std::io::Error> for MultiMonitorError {
    fn from(err: std::io::Error) -> Self {
        Self {
            code: "IO_ERROR".to_string(),
            message: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for MultiMonitorError {
    fn from(err: serde_json::Error) -> Self {
        Self {
            code: "SERDE_ERROR".to_string(),
            message: err.to_string(),
        }
    }
}

impl std::fmt::Display for MultiMonitorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}
