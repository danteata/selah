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
// LIVE_WINDOW_LABEL is used internally by window_manager
