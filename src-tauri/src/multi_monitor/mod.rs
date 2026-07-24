/**
 * Native Multi-Monitor Window Management for Tauri
 * 
 * This module provides robust multi-monitor support using Tauri's native window API,
 * eliminating the need for browser Presentation API permissions and providing
 * true fullscreen without browser chrome.
 */

mod types;
mod commands;
mod state;
mod window_manager;

pub use commands::*;
pub use state::MultiMonitorState;
// Exposed so the app lifecycle (main.rs) can tear down the live output
// window when the main window closes.
pub use state::LIVE_WINDOW_LABEL;
